"""Imaging reports router for HITL doctor review.

Provides REST API for the frontend to:
- Discover pending reviews (GET with status filter)
- Fetch report details (GET by ID)
- Submit doctor modifications (PUT by ID)
"""

import json
import os
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import httpx
from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from app.core.config.paths import get_paths
from app.gateway.services.case_db import (
    get_case_by_thread,
    get_report_by_id,
    get_reports_by_thread,
    sync_report_from_file,
    update_evidence_data,
    update_report,
)

router = APIRouter(
    prefix="/api/threads/{thread_id}/imaging-reports",
    tags=["imaging-reports"],
)


def _extract_densenet_probs(ai_result_raw: dict[str, Any]) -> dict[str, Any]:
    top_level_probs = ai_result_raw.get("densenet_probs")
    if isinstance(top_level_probs, dict):
        return top_level_probs

    summary_probs = ai_result_raw.get("summary", {}).get("disease_probabilities", {})
    return summary_probs if isinstance(summary_probs, dict) else {}


def _ensure_finding_ids(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for finding in findings:
        if not finding.get("id"):
            finding["id"] = uuid.uuid4().hex[:8]
    return findings

def _get_reports_dir(thread_id: str) -> Path:
    """Get the imaging-reports directory for a thread."""
    paths = get_paths()
    paths.ensure_thread_dirs(thread_id)
    reports_dir = paths.sandbox_user_data_dir(thread_id) / "imaging-reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    return reports_dir

class DoctorReviewSubmission(BaseModel):
    """Doctor's review submission."""
    doctor_result: dict[str, Any]

@router.get("")
def list_imaging_reports(
    thread_id: str,
    status: str | None = None,
):
    """List imaging reports, optionally filtered by status.

    [ADR-020] Only sync and return reports if the patient has a formal Case
    (i.e., has confirmed scheduling). Otherwise return empty to prevent
    sandbox data from leaking into the EMR database.

    Query params:
        status: Filter by report status (e.g., 'pending_review', 'reviewed')
    """
    # Gate: only allow access if patient has been formally registered
    if not get_case_by_thread(thread_id):
        return {"reports": [], "total": 0}

    reports_dir = _get_reports_dir(thread_id)
    
    # 1. Sync any stray JSON files into DB
    for report_file in sorted(reports_dir.glob("*.json")):
        sync_report_from_file(thread_id, report_file)
            
    # 2. Fetch from DB
    reports = get_reports_by_thread(thread_id, status)

    return {"reports": reports, "total": len(reports)}

@router.get("/{report_id}")
def get_imaging_report(thread_id: str, report_id: str):
    """Get a specific imaging report by ID."""
    # Gate: only allow access if patient has been formally registered
    if not get_case_by_thread(thread_id):
        raise HTTPException(status_code=404, detail="No registered case for this thread")

    reports_dir = _get_reports_dir(thread_id)
    report_file = reports_dir / f"{report_id}.json"

    if report_file.exists():
        sync_report_from_file(thread_id, report_file)

    report = get_report_by_id(report_id)
    if not report:
        raise HTTPException(status_code=404, detail=f"Report {report_id} not found")

    return report

@router.put("/{report_id}")
def submit_doctor_review(
    thread_id: str,
    report_id: str,
    submission: DoctorReviewSubmission,
):
    """Submit doctor's review for an imaging report.

    This changes the report status to 'reviewed', which unblocks the
    submit_for_review tool that is polling this file.
    """
    reports_dir = _get_reports_dir(thread_id)
    report_file = reports_dir / f"{report_id}.json"

    if not report_file.exists():
        raise HTTPException(status_code=404, detail=f"Report file {report_id}.json not found in sandbox")

    # 1. Sync file to ensure it exists in DB
    sync_report_from_file(thread_id, report_file)

    # 2. Update DB and log audit (Option A: Snapshot)
    updated_report = update_report(report_id, submission.doctor_result)
    if not updated_report:
        raise HTTPException(status_code=500, detail="Failed to update report in database")
    merged_doctor_result = updated_report.get("doctor_result") if isinstance(updated_report.get("doctor_result"), dict) else submission.doctor_result

    # [P1 Sync] Sync to cases table macro evidence array
    from app.gateway.services.case_db import update_case_evidence_from_report
    update_case_evidence_from_report(thread_id, report_id, merged_doctor_result)

    # 3. Write back to sandbox file to unblock the Agent Tool
    try:
        data = json.loads(report_file.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read report: {e}")

    # Support re-edit: increment version instead of rejecting already-reviewed reports
    data["version"] = data.get("version", 0) + 1
    data["status"] = "reviewed"
    data["doctor_result"] = merged_doctor_result

    report_file.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    logger.info(f"[HITL] Report {report_id} reviewed by doctor and synced to DB")
    return {"status": "ok", "report_id": report_id, "data": updated_report}

class GenerateDraftRequest(BaseModel):
    doctor_result: dict[str, Any]
    prompt: str | None = None

class AnalyzeCVRequest(BaseModel):
    image_url: str | None = None
    enable_sam: bool = False

@router.post("/analyze-cv")
async def stateless_analyze_cv(thread_id: str, payload: AnalyzeCVRequest | None = None):
    """
    [Phase 6 Stateless Endpoint] 
    Bypass LangGraph and run CV model (YOLO/DenseNet) directly on the uploaded image via MCP SSE.
    """
    report_id = f"cv_{uuid.uuid4().hex[:8]}"
    reports_dir = _get_reports_dir(thread_id)
    
    # 1. Resolve image path
    image_url = payload.image_url if payload else None
    
    # Check if this thread has an existing case with an imaging evidence item to default to
    if not image_url:
        existing_case = get_case_by_thread(thread_id)
        if existing_case and existing_case.evidence:
            for item in existing_case.evidence:
                if item.type == "imaging" and item.file_path:
                    image_url = item.file_path
                    break
    
    local_image_path = ""
    if image_url:
        decoded_url = unquote(image_url)
        
        if decoded_url.startswith(f"/api/threads/{thread_id}/artifacts/"):
            virtual_path = decoded_url.split(f"/api/threads/{thread_id}/artifacts/", 1)[1]
            try:
                host_path = get_paths().resolve_virtual_path(thread_id, virtual_path)
                if host_path.exists():
                    local_image_path = str(host_path.absolute())
            except ValueError as e:
                logger.warning(f"Failed to resolve artifact path {virtual_path}: {e}")
        elif decoded_url.startswith("/mnt/user-data/"):
            try:
                host_path = get_paths().resolve_virtual_path(thread_id, decoded_url)
                if host_path.exists():
                    local_image_path = str(host_path.absolute())
            except ValueError as e:
                logger.warning(f"Failed to resolve virtual path {decoded_url}: {e}")
        elif decoded_url.startswith("http"):
            # Download to a temporary sandbox path
            target_path = reports_dir / f"img_{report_id}.png"
            async with httpx.AsyncClient() as client:
                resp = await client.get(image_url) # Fetch original encoded URL
                resp.raise_for_status()
                target_path.write_bytes(resp.content)
                local_image_path = str(target_path.absolute())
        elif Path(decoded_url).exists():
            local_image_path = str(Path(decoded_url).absolute())
        
    if not local_image_path:
        raise HTTPException(status_code=400, detail=f"Valid image_url is required or image not found locally: {image_url}")

    # Check if a report already exists for this image (from parallel analyzer)
    image_filename = Path(local_image_path).name
    if reports_dir.exists():
        for report_file in reports_dir.glob("*.json"):
            try:
                report_data = json.loads(report_file.read_text(encoding="utf-8"))
                db_image_path = report_data.get("image_path", "")
                decoded_db_image_path = unquote(db_image_path)
                if db_image_path and Path(decoded_db_image_path).name == image_filename:
                    logger.info(f"[HITL] Using existing report found for {image_filename}")
                    
                    # Ensure it's synced to DB
                    from app.gateway.services.case_db import sync_report_from_file
                    synced_report = sync_report_from_file(thread_id, report_file)
                    
                    if synced_report:
                        return {"status": "ok", "report_id": synced_report["report_id"], "data": synced_report}
            except Exception as e:
                logger.warning(f"Failed to check existing report {report_file}: {e}")

    # 2. Call MCP Vision Service
    from app.gateway.services.mcp_vision_client import analyze_xray
    
    enable_sam = payload.enable_sam if payload else False
    logger.info(f"[HITL] Calling MCP Vision Service for {local_image_path}")
    
    try:
        ai_result_raw = await analyze_xray(local_image_path, enable_sam=enable_sam)
        
        # [CRITICAL FIX] Convert MCP format to frontend schema
        findings = _ensure_finding_ids(ai_result_raw.get("findings", []))
        colors = ["red", "amber", "purple", "teal"]
        try:
            from PIL import Image
            with Image.open(local_image_path) as img:
                img_w, img_h = img.size
            for i, f in enumerate(findings):
                # 1. Map bounding box [x1, y1, x2, y2] to {x, y, width, height} percentage
                if "bbox" in f and isinstance(f["bbox"], list) and len(f["bbox"]) == 4:
                    x1, y1, x2, y2 = f["bbox"]
                    f["bbox"] = {
                        "x": (x1 / img_w) * 100 if img_w else 0,
                        "y": (y1 / img_h) * 100 if img_h else 0,
                        "width": ((x2 - x1) / img_w) * 100 if img_w else 0,
                        "height": ((y2 - y1) / img_h) * 100 if img_h else 0
                    }
                
                # 2. Map 'disease' to 'name' (Required by UI)
                if "disease" in f and "name" not in f:
                    f["name"] = f["disease"]
                    
                # 3. Map 'confidence' 0..1 to 0..100 (UI expects percentage format)
                if "confidence" in f and f["confidence"] <= 1.0:
                    f["confidence"] = f["confidence"] * 100
                    
                # 4. Inject required frontend properties for rendering and logic
                f["source"] = "ai"
                f["modified"] = False
                f["color"] = colors[i % len(colors)]
                f["note"] = f.get("location_cn", "") or f.get("location", "")
                
        except Exception as e:
            logger.warning(f"Failed to normalize findings format: {e}")

        # Format to our system's expected ai_result structure
        formatted_ai_result = {
            "findings": findings,
            "summary": ai_result_raw.get("summary", {}),
            "densenet_probs": _extract_densenet_probs(ai_result_raw),
            "rejected": ai_result_raw.get("rejected", []),
            "pipeline": ai_result_raw.get("pipeline"),
            "disclaimer": ai_result_raw.get("disclaimer"),
            "model_version": ai_result_raw.get("pipeline"),
        }
    except Exception as e:
        logger.error(f"[HITL] MCP Call Failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Vision model analysis failed: {str(e)}")
        
    # 3. Save draft to sandbox
    generated_data = {
        "report_id": report_id,
        "thread_id": thread_id,
        "status": "pending_review",
        "version": 1,
        "image_path": image_url, # Keep original URL/path for frontend reference
        "ai_result": formatted_ai_result,
        "doctor_result": {}
    }
    
    report_file = reports_dir / f"{report_id}.json"
    report_file.write_text(json.dumps(generated_data, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info(f"[HITL] Analysis complete. Saved to {report_file.name}")

    # 4. Sync the structured data to the case evidence database
    try:
        case = get_case_by_thread(thread_id)
        if case:
            for item in case.evidence:
                # Match by exact URL or filename
                if item.file_path == image_url or (item.file_path and Path(unquote(item.file_path)).name == image_filename):
                    update_evidence_data(case.case_id, item.evidence_id, {
                        "structured_data": generated_data
                    })
                    break
    except Exception as e:
        logger.error(f"[HITL] Failed to sync generated report to case DB: {e}")

    return {"status": "ok", "report_id": report_id, "data": generated_data}

@router.post("/generate-draft")
async def generate_text_draft(thread_id: str, request: GenerateDraftRequest):
    """
    [Phase 6 Stateless / Gap③]
    Takes the doctor's reviewed JSON + optional instructions, calls SiliconFlow LLM
    to generate a readable radiology report. No memory, no LangGraph loop.
    """
    findings = request.doctor_result.get("findings", [])
    densenet_probs = request.doctor_result.get("densenet_probs", {})

    # 构造结构化的影像学描述素材
    finding_lines = []
    for f in findings:
        loc = f.get("location_cn", f.get("name", "未知区域"))
        disease = f.get("disease", f.get("name", "异常"))
        conf = f.get("confidence", 0)
        source = f.get("source", "ai")
        note = f.get("note", "")
        finding_lines.append(
            f"- {loc}: {disease} (置信度 {conf}%, 来源: {'AI' if source == 'ai' else '医生标注'})"
            + (f" 备注: {note}" if note else "")
        )

    prob_lines = []
    for disease_name, prob in sorted(densenet_probs.items(), key=lambda x: -x[1]):
        if prob > 0.05:  # 只展示概率 >5% 的
            prob_lines.append(f"- {disease_name}: {prob*100:.1f}%")

    user_prompt = f"""请根据以下影像检查结果，撰写一份规范的放射影像学报告。

## 影像发现 (Findings)
{chr(10).join(finding_lines) if finding_lines else "未检出明显异常"}

## DenseNet 疾病概率预测
{chr(10).join(prob_lines) if prob_lines else "无概率预测数据"}

{f"## 医生补充指示{chr(10)}{request.prompt}" if request.prompt else ""}

请按以下格式输出：
1. **影像学描述**：客观描述所见异常
2. **印象**：给出诊断意见
3. **建议**：后续检查或随诊建议

注意：保持专业、客观、简洁。"""

    system_prompt = """你是一名资深放射科医师助手。你的任务是根据 AI 影像分析结果和医生的审核标注，
生成规范的中文放射影像学报告。语言必须使用标准的医学术语，格式清晰易读。
不要添加与影像发现无关的内容。"""

    # 调用 SiliconFlow API
    api_key = os.environ.get("SILICONFLOW_API_KEY", "")
    if not api_key:
        # 尝试从 config.yaml 读取
        try:
            from app.core.config.app_config import get_app_config
            cfg = get_app_config()
            for m in getattr(cfg, "models", []):
                if hasattr(m, "api_key") and m.api_key:
                    api_key = m.api_key
                    break
        except Exception:
            pass

    if not api_key:
        raise HTTPException(status_code=500, detail="SILICONFLOW_API_KEY not configured")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                "https://api.siliconflow.cn/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "Qwen/Qwen3.5-35B-A3B",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "max_tokens": 2048,
                    "temperature": 0.3,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            report_text = data["choices"][0]["message"]["content"]

    except Exception as e:
        logger.error(f"[Gap③] LLM draft generation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"报告生成失败: {str(e)}")

    logger.info(f"[Gap③] Generated draft report for thread {thread_id}, {len(report_text)} chars")
    return {"status": "ok", "report_text": report_text}
