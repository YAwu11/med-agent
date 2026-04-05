"""Upload router for handling file uploads."""

import asyncio
import json
from datetime import datetime, timezone
from loguru import logger
import sys
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, BackgroundTasks
from pydantic import BaseModel

from app.core.config.app_config import get_app_config
from app.core.config.paths import get_paths
from app.core.sandbox.sandbox_provider import get_sandbox_provider
from app.core.uploads.manager import (
    PathTraversalError,
    delete_file_safe,
    enrich_file_listing,
    ensure_uploads_dir,
    get_uploads_dir,
    list_files_in_dir,
    normalize_filename,
    upload_artifact_url,
    upload_virtual_path,
)
from app.core.utils.file_conversion import CONVERTIBLE_EXTENSIONS, convert_file_to_markdown
from app.gateway.services.analyzer_registry import AnalysisResult
from app.gateway.services.parallel_analyzer import analyze_batch
from app.gateway.services.thread_events import publish_thread_event


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}
INTERNAL_UPLOAD_SIDECAR_SUFFIXES = (
    ".ocr.md",
    ".meta.json",
    ".local_ocr.md",
    ".qwen_cleaned.md",
    ".ocr_text.txt",
    ".raw_ocr.txt",
)

# 文件类型 → Evidence 类型映射（非图像文件根据扩展名推断）
_DOC_EXTS = {".pdf", ".doc", ".docx", ".txt", ".md", ".csv", ".xls", ".xlsx"}
BRAIN_MRI_REQUIRED_SEQUENCES = ("t1", "t1ce", "t2", "flair")

router = APIRouter(prefix="/api/threads/{thread_id}/uploads", tags=["uploads"])

class UploadResponse(BaseModel):
    """Response model for file upload."""

    success: bool
    files: list[dict[str, str]]
    message: str
    task_ids: list[str] = []


def _is_internal_upload_sidecar(filename: str, sibling_filenames: set[str]) -> bool:
    lower_name = filename.lower()
    if any(lower_name.endswith(suffix) for suffix in INTERNAL_UPLOAD_SIDECAR_SUFFIXES):
        return True

    if lower_name.endswith(".md"):
        stem = Path(filename).stem
        return any(
            other != filename and Path(other).stem == stem and not other.lower().endswith(".md")
            for other in sibling_filenames
        )

    return False


def _analysis_kind(result: AnalysisResult) -> str:
    if result.evidence_type == "lab" or result.category == "lab_report":
        return "ocr"
    if result.evidence_type == "imaging":
        return "imaging"
    return "description"


def _publish_upload_analysis_events(
    thread_id: str,
    uploaded_files: list[dict[str, str]],
    analysis_results: list[AnalysisResult],
    evidence_mapping: dict[str, str],
) -> None:
    uploaded_filenames = {file_info.get("filename", "") for file_info in uploaded_files}

    for result in analysis_results:
        if result.filename not in uploaded_filenames:
            continue

        upload_id = evidence_mapping.get(result.filename) or result.filename
        published_at = datetime.now(timezone.utc).isoformat()
        status = "failed" if result.error else "completed"
        publish_thread_event(
            thread_id,
            {
                "type": "upload_analyzed",
                "event_id": f"{upload_id}:{published_at}",
                "upload_id": upload_id,
                "filename": result.filename,
                "analysis_kind": _analysis_kind(result),
                "status": status,
                "category": result.category,
                "summary": result.ai_analysis_text or result.error or "",
            },
        )


def _publish_upload_received_event(thread_id: str, filename: str) -> None:
    published_at = datetime.now(timezone.utc).isoformat()
    publish_thread_event(
        thread_id,
        {
            "type": "upload_received",
            "event_id": f"{filename}:received:{published_at}",
            "upload_id": filename,
            "filename": filename,
            "status": "processing",
        },
    )


def _is_nifti_file(filename: str) -> bool:
    return filename.endswith(".nii.gz") or filename.endswith(".nii")


def _detect_brain_mri_sequence(filename: str | None) -> str | None:
    if not filename:
        return None

    lower_name = Path(filename).name.lower()
    if lower_name.endswith(".nii.gz"):
        stem = lower_name[:-7]
    else:
        stem = Path(lower_name).stem

    normalized = stem.replace("-", "_")
    if "flair" in normalized:
        return "flair"
    if "t1ce" in normalized or "t1c" in normalized:
        return "t1ce"
    if "t2" in normalized:
        return "t2"
    if "t1" in normalized:
        return "t1"
    return None


def _build_brain_mri_guidance(case, uploaded_files: list[dict[str, str]]) -> dict[str, object]:
    candidate_names: set[str] = set()

    for ev in getattr(case, "evidence", []):
        if not ev.file_path:
            continue
        candidate_name = Path(ev.file_path).name
        if _is_nifti_file(candidate_name):
            candidate_names.add(candidate_name)

    for file_info in uploaded_files:
        filename = file_info.get("filename", "")
        if _is_nifti_file(filename):
            candidate_names.add(filename)

    detected = [
        sequence
        for sequence in BRAIN_MRI_REQUIRED_SEQUENCES
        if any(_detect_brain_mri_sequence(name) == sequence for name in candidate_names)
    ]
    missing = [sequence for sequence in BRAIN_MRI_REQUIRED_SEQUENCES if sequence not in detected]

    return {
        "upload_mode": "guided_4_sequence",
        "required_sequences": list(BRAIN_MRI_REQUIRED_SEQUENCES),
        "detected_sequences": detected,
        "missing_sequences": missing,
        "ready_for_analysis": not missing,
    }

@router.post("", response_model=UploadResponse)
async def upload_files(
    thread_id: str,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
) -> UploadResponse:
    """Upload multiple files to a thread's uploads directory."""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    try:
        uploads_dir = ensure_uploads_dir(thread_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    sandbox_uploads = get_paths().sandbox_uploads_dir(thread_id)
    uploaded_files = []

    sandbox_provider = get_sandbox_provider()
    sandbox_id = sandbox_provider.acquire(thread_id)
    sandbox = sandbox_provider.get(sandbox_id)

    for file in files:
        if not file.filename:
            continue

        try:
            safe_filename = normalize_filename(file.filename)
        except ValueError:
            logger.warning(f"Skipping file with unsafe filename: {file.filename!r}")
            continue

        try:
            content = await file.read()
            file_path = uploads_dir / safe_filename
            file_path.write_bytes(content)

            virtual_path = upload_virtual_path(safe_filename)

            if sandbox_id != "local":
                sandbox.update_file(virtual_path, content)

            file_info = {
                "filename": safe_filename,
                "size": str(len(content)),
                "path": str(sandbox_uploads / safe_filename),
                "virtual_path": virtual_path,
                "artifact_url": upload_artifact_url(thread_id, safe_filename),
            }

            logger.info(f"Saved file: {safe_filename} ({len(content)} bytes) to {file_info['path']}")

            if Path(safe_filename).suffix.lower() in IMAGE_EXTS or _is_nifti_file(safe_filename):
                _publish_upload_received_event(thread_id, safe_filename)

            file_ext = file_path.suffix.lower()
            if file_ext in CONVERTIBLE_EXTENSIONS:
                md_path = await convert_file_to_markdown(file_path)
                if md_path:
                    md_virtual_path = upload_virtual_path(md_path.name)

                    if sandbox_id != "local":
                        sandbox.update_file(md_virtual_path, md_path.read_bytes())

                    file_info["markdown_file"] = md_path.name
                    file_info["markdown_path"] = str(sandbox_uploads / md_path.name)
                    file_info["markdown_virtual_path"] = md_virtual_path
                    file_info["markdown_artifact_url"] = upload_artifact_url(thread_id, md_path.name)

            uploaded_files.append(file_info)

        except Exception as e:
            logger.error(f"Failed to upload {file.filename}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to upload {file.filename}: {str(e)}")

    # ── P2: 并行视觉管道（受 vision.enabled 开关控制） ──
    vision_cfg = getattr(get_app_config(), "vision", None) or {}
    vision_enabled = vision_cfg.get("enabled", False)
    
    analysis_results = []
    
    if vision_enabled:
        # Collect images for parallel analysis
        pending_analysis = [
            {"filename": f["filename"], "host_path": str(uploads_dir / f["filename"])}
            for f in uploaded_files
            if Path(f["filename"]).suffix.lower() in IMAGE_EXTS
        ]
        
        if pending_analysis:
            logger.info(f"Starting parallel analysis for {len(pending_analysis)} images")
            analysis_results = await analyze_batch(pending_analysis, thread_id)
            
            # Enrich uploaded_files metadata from analysis results
            result_map = {r.filename: r for r in analysis_results if not r.error}
            for f in uploaded_files:
                res = result_map.get(f["filename"])
                if res:
                    f["image_type"] = res.category
                    f["image_confidence"] = str(res.confidence)
                    if res.enhanced_file_path:
                        f["enhanced_path"] = res.enhanced_file_path
                    # [Plan E] 将 OCR Markdown 结果直接返回给前端
                    if res.ai_analysis_text:
                        f["ai_analysis_text"] = res.ai_analysis_text
                    # For legacy compatibility in response structure
                    if res.structured_data and res.structured_data.get("mcp_status") == "completed":
                         f["mcp_analysis_status"] = "completed"
                         f["mcp_findings_count"] = str(res.structured_data.get("findings_count", 0))

    # [Gap①] 自动将上传结果回写到 Case 的 evidence 数组
    evidence_mapping = {}
    try:
        evidence_mapping = await _auto_sync_evidence(thread_id, uploaded_files, analysis_results)
    except Exception as sync_err:
        logger.warning(f"[Gap①] Evidence auto-sync failed (non-blocking): {sync_err}")

    if analysis_results:
        _publish_upload_analysis_events(thread_id, uploaded_files, analysis_results, evidence_mapping)

    # -------- 异步队列调度 --------
    task_ids = []
    for f in uploaded_files:
        filename = f.get("filename", "")
        if filename.endswith(".nii.gz") or filename.endswith(".nii"):
            from app.gateway.services.task_store import create_task
            from app.gateway.services.brain_nifti_pipeline import process_nifti_pipeline_async
            
            task_id = str(uuid.uuid4())
            create_task(task_id)
            task_ids.append(task_id)
            
            nifti_path = str(uploads_dir / filename)
            
            # [ADR-036 v2] 精确路由
            ev_id = evidence_mapping.get(filename)
            background_tasks.add_task(process_nifti_pipeline_async, task_id, nifti_path, thread_id, filename, ev_id)
            logger.info(f"Dispatching async task {task_id} for NIfTI file {filename} to ev_id {ev_id}")

    return UploadResponse(
        success=True,
        files=uploaded_files,
        message=f"Successfully uploaded {len(uploaded_files)} file(s)",
        task_ids=task_ids,
    )

async def _auto_sync_evidence(thread_id: str, uploaded_files: list[dict], analysis_results: list[AnalysisResult]) -> dict[str, str]:
    """[Gap①] 上传完成后，自动将分析结果回写到 Case 的 evidence 数组，并返回字典 mapping filename -> evidence_id。"""
    from app.gateway.services.case_db import get_case_by_thread, add_evidence
    from app.gateway.models.case import AddEvidenceRequest

    case = get_case_by_thread(thread_id)
    if not case:
        logger.debug(f"[Gap①] No case for thread {thread_id}, skipping evidence sync")
        return {}

    result_map = {r.filename: r for r in analysis_results if not r.error}
    evidence_mapping: dict[str, str] = {}

    for f in uploaded_files:
        filename = f.get("filename", "")
        file_ext = Path(filename).suffix.lower()
        artifact_url = f.get("artifact_url", f.get("path", ""))

        analysis = result_map.get(filename)
        
        # Merge properties from AnalysisResult if available
        pending_new_ev_id = uuid.uuid4().hex[:12]

        if analysis:
            ev_type = analysis.evidence_type
            evidence_title = analysis.evidence_title
            ai_analysis_text = analysis.ai_analysis_text
            structured = analysis.structured_data
            is_abnormal = analysis.is_abnormal
        else:
            ai_analysis_text = None
            structured = None
            is_abnormal = False
            # Check for existing sidecar manually if analysis skipped
            uploads_dir = Path(f.get("path", "")).parent if f.get("path") else None
            if uploads_dir:
                 ocr_sidecar = uploads_dir / f"{filename}.ocr.md"
                 if ocr_sidecar.exists():
                     ai_analysis_text = ocr_sidecar.read_text(encoding="utf-8")

            if file_ext in IMAGE_EXTS:
                ev_type = "imaging"
                evidence_title = "胸部X光片"
            elif _is_nifti_file(filename):
                ev_type = "imaging"
                evidence_title = "脑部核磁共振 (MRI NIfTI)"
                # [ADR-036] 写入占位 structured_data，使前端立刻渲染 BrainSpatialReview 的加载态
                structured = {
                    "pipeline": "brain_nifti_v1",
                    "status": "processing",
                    "modality": "brain_mri_3d",
                    "viewer_kind": "brain_spatial_review",
                    "report_id": pending_new_ev_id,
                }
            elif file_ext in _DOC_EXTS:
                ev_type = "note"
                evidence_title = filename
            else:
                ev_type = "note"
                evidence_title = filename
                
            if ai_analysis_text:
                from app.gateway.services.paddle_ocr import _extract_title_from_markdown
                extracted_title = _extract_title_from_markdown(ai_analysis_text)
                if extracted_title:
                    evidence_title = extracted_title

        # Upsert 逻辑：如果已存在相同 file_path 的证据项则更新，否则新增
        # 这样重复上传同一文件时，不会产生重复记录，且旧数据会被刷新
        existing_ev = None
        for ev in case.evidence:
            if ev.file_path and artifact_url and ev.file_path == artifact_url:
                existing_ev = ev
                break

        if existing_ev:
            from app.gateway.services.case_db import update_evidence_data
            existing_structured = existing_ev.structured_data if isinstance(existing_ev.structured_data, dict) else {}
            if _is_nifti_file(filename):
                brain_mri_guidance = _build_brain_mri_guidance(case, uploaded_files)
                structured = {
                    **existing_structured,
                    **(structured or {}),
                    "pipeline": "brain_nifti_v1",
                    "status": str((structured or {}).get("status") or existing_structured.get("status") or "processing"),
                    "modality": "brain_mri_3d",
                    "viewer_kind": "brain_spatial_review",
                    "report_id": str((structured or {}).get("report_id") or existing_structured.get("report_id") or existing_ev.evidence_id),
                    **brain_mri_guidance,
                }
            update_evidence_data(case.case_id, existing_ev.evidence_id, {
                "title": evidence_title,
                "ai_analysis": ai_analysis_text,
                "structured_data": structured,
                "is_abnormal": bool(is_abnormal),
            })
            evidence_mapping[filename] = existing_ev.evidence_id
            logger.info(f"[Gap①] Updated existing evidence: {filename} → {ev_type} for case {case.case_id}")
        else:
            # We generate our own ev ID here or use the newly generated one from add_evidence. 
            # To be safe and deterministic, let's inject a new one.
            new_ev_id = pending_new_ev_id
            if _is_nifti_file(filename):
                brain_mri_guidance = _build_brain_mri_guidance(case, uploaded_files)
                structured = {
                    **(structured or {}),
                    "pipeline": "brain_nifti_v1",
                    "status": str((structured or {}).get("status") or "processing"),
                    "modality": "brain_mri_3d",
                    "viewer_kind": "brain_spatial_review",
                    "report_id": str((structured or {}).get("report_id") or new_ev_id),
                    **brain_mri_guidance,
                }
            req = AddEvidenceRequest(
                evidence_id=new_ev_id,
                type=ev_type,
                title=evidence_title,
                source="patient_upload",
                file_path=artifact_url,
                ai_analysis=ai_analysis_text,
                structured_data=structured,
                is_abnormal=bool(is_abnormal),
            )
            add_evidence(case.case_id, req)
            evidence_mapping[filename] = new_ev_id
            logger.info(f"[Gap①] Auto-synced evidence: {filename} → {ev_type} for case {case.case_id}")

    return evidence_mapping

@router.get("/list", response_model=dict)
async def list_uploaded_files(thread_id: str) -> dict:
    """List all files in a thread's uploads directory."""
    try:
        uploads_dir = get_uploads_dir(thread_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    result = list_files_in_dir(uploads_dir)
    sibling_filenames = {file_info["filename"] for file_info in result["files"]}
    result["files"] = [
        f
        for f in result["files"]
        if not _is_internal_upload_sidecar(f["filename"], sibling_filenames)
    ]
    result["count"] = len(result["files"])
    enrich_file_listing(result, thread_id)

    # Gateway additionally includes the sandbox-relative path.
    sandbox_uploads = get_paths().sandbox_uploads_dir(thread_id)
    for f in result["files"]:
        f["path"] = str(sandbox_uploads / f["filename"])

    return result

@router.delete("/{filename}")
async def delete_uploaded_file(thread_id: str, filename: str) -> dict:
    """Delete a file from a thread's uploads directory."""
    try:
        uploads_dir = get_uploads_dir(thread_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        result = delete_file_safe(uploads_dir, filename, convertible_extensions=CONVERTIBLE_EXTENSIONS)
        for suffix in INTERNAL_UPLOAD_SIDECAR_SUFFIXES:
            (uploads_dir / f"{filename}{suffix}").unlink(missing_ok=True)
        return result
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")
    except PathTraversalError:
        raise HTTPException(status_code=400, detail="Invalid path")
    except Exception as e:
        logger.error(f"Failed to delete {filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete {filename}: {str(e)}")
