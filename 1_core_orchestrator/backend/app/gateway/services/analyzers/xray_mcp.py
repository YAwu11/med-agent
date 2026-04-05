"""Medical imaging analyzer using local GPU MCP Engine."""

import asyncio
import json
import uuid
from pathlib import Path

from loguru import logger

from app.core.config.paths import get_paths
from app.gateway.services.analyzer_registry import AnalysisResult
from app.gateway.services.vision_gateway import enhance_medical_imaging


async def _call_mcp_analyze(
    image_path: str,
    thread_id: str,
    original_filename: str,
    report_id: str | None = None,
) -> tuple[dict | None, str | None]:
    from app.gateway.services.mcp_vision_client import analyze_xray

    logger.info(f"[ADR-026] Auto MCP Analysis started: {original_filename}")

    try:
        result = await analyze_xray(image_path, enable_sam=False)
    except Exception as e:
        logger.error(f"[ADR-026] MCP Vision service call failed for {original_filename}: {e}")
        return None

    if not result:
        logger.warning(f"[ADR-026] MCP Engine returned empty result: {original_filename}")
        return None

    # Write analysis result to sandbox for manual review cache
    resolved_report_id = report_id or str(uuid.uuid4())[:8]
    paths = get_paths()
    reports_dir = paths.sandbox_user_data_dir(thread_id) / "imaging-reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    report_file = reports_dir / f"{resolved_report_id}.json"

    report_data = {
        "report_id": resolved_report_id,
        "thread_id": thread_id,
        "status": "pending_review",
        "image_path": image_path,
        "source_upload_filename": original_filename,
        "modality": "chest_xray_2d",
        "viewer_kind": "imaging_bbox_review",
        "ai_result": result,
        "doctor_result": None,
    }
    report_file.write_text(
        json.dumps(report_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    total_findings = result.get("summary", {}).get("total_findings", 0)
    logger.info(
        f"[ADR-026] MCP Analysis complete: {original_filename} → report_id={resolved_report_id}, "
        f"findings={total_findings}"
    )
    return result, resolved_report_id

class XrayMCPAnalyzer:
    """Uses Local GPU YOLO + Segment Everything model."""

    async def analyze(self, image_path: str, thread_id: str, original_filename: str) -> AnalysisResult:
        outputs_dir = get_paths().sandbox_outputs_dir(thread_id)
        outputs_dir.mkdir(parents=True, exist_ok=True)
        
        safe_filename = Path(image_path).name 
        enhanced_name = f"enhanced_{safe_filename}"
        enhanced_host = str(outputs_dir / enhanced_name)

        if Path(image_path).exists():
             await asyncio.to_thread(enhance_medical_imaging, image_path, enhanced_host)
        else:
             logger.warning(f"File missing, skipping enhancement: {image_path}")

        result, report_id = await _call_mcp_analyze(image_path, thread_id, original_filename)
        
        if result:
            findings = result.get("findings", result.get("summary", {}).get("findings", []))
            count = len(findings) if isinstance(findings, list) else result.get("summary", {}).get("total_findings", 0)
            structured = {
                "mcp_status": "completed",
                "findings_count": count,
                "status": "pending_review",
                "modality": "chest_xray_2d",
                "viewer_kind": "imaging_bbox_review",
                "report_id": report_id,
            }
        else:
            structured = None

        return AnalysisResult(
            filename=original_filename,
            category="",
            confidence=0.0,
            analyzer_name="",
            evidence_type="imaging",
            evidence_title="胸部X光片", # Specialized UI text for imaging
            structured_data=structured,
            is_abnormal=bool(structured and structured.get("findings_count", 0) > 0),
            enhanced_file_path=f"/mnt/user-data/outputs/{enhanced_name}" if Path(enhanced_host).exists() else None
        )
