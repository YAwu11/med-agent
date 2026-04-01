"""Upload router for handling file uploads."""

import asyncio
import json
import logging
import sys
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
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

logger = logging.getLogger(__name__)

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}

# 文件类型 → Evidence 类型映射（非图像文件根据扩展名推断）
_DOC_EXTS = {".pdf", ".doc", ".docx", ".txt", ".md", ".csv", ".xls", ".xlsx"}

router = APIRouter(prefix="/api/threads/{thread_id}/uploads", tags=["uploads"])

class UploadResponse(BaseModel):
    """Response model for file upload."""

    success: bool
    files: list[dict[str, str]]
    message: str


@router.post("", response_model=UploadResponse)
async def upload_files(
    thread_id: str,
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
                    # For legacy compatibility in response structure
                    if res.structured_data and res.structured_data.get("mcp_status") == "completed":
                         f["mcp_analysis_status"] = "completed"
                         f["mcp_findings_count"] = str(res.structured_data.get("findings_count", 0))

    # [Gap①] 自动将上传结果回写到 Case 的 evidence 数组
    try:
        await _auto_sync_evidence(thread_id, uploaded_files, analysis_results)
    except Exception as sync_err:
        logger.warning(f"[Gap①] Evidence auto-sync failed (non-blocking): {sync_err}")

    return UploadResponse(
        success=True,
        files=uploaded_files,
        message=f"Successfully uploaded {len(uploaded_files)} file(s)",
    )


async def _auto_sync_evidence(thread_id: str, uploaded_files: list[dict], analysis_results: list[AnalysisResult]) -> None:
    """[Gap①] 上传完成后，自动将分析结果回写到 Case 的 evidence 数组。"""
    from app.gateway.services.case_db import get_case_by_thread, add_evidence
    from app.gateway.models.case import AddEvidenceRequest

    case = get_case_by_thread(thread_id)
    if not case:
        logger.debug(f"[Gap①] No case for thread {thread_id}, skipping evidence sync")
        return

    result_map = {r.filename: r for r in analysis_results if not r.error}

    for f in uploaded_files:
        filename = f.get("filename", "")
        file_ext = Path(filename).suffix.lower()
        artifact_url = f.get("artifact_url", f.get("path", ""))

        analysis = result_map.get(filename)
        
        # Merge properties from AnalysisResult if available
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
            update_evidence_data(case.case_id, existing_ev.evidence_id, {
                "title": evidence_title,
                "ai_analysis": ai_analysis_text,
                "structured_data": structured,
                "is_abnormal": bool(is_abnormal),
            })
            logger.info(f"[Gap①] Updated existing evidence: {filename} → {ev_type} for case {case.case_id}")
        else:
            req = AddEvidenceRequest(
                type=ev_type,
                title=evidence_title,
                source="patient_upload",
                file_path=artifact_url,
                ai_analysis=ai_analysis_text,
                structured_data=structured,
                is_abnormal=bool(is_abnormal),
            )
            add_evidence(case.case_id, req)
            logger.info(f"[Gap①] Auto-synced evidence: {filename} → {ev_type} for case {case.case_id}")


@router.get("/list", response_model=dict)
async def list_uploaded_files(thread_id: str) -> dict:
    """List all files in a thread's uploads directory."""
    try:
        uploads_dir = get_uploads_dir(thread_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    result = list_files_in_dir(uploads_dir)
    # 过滤 sidecar 文件，不向前端暴露
    result["files"] = [
        f for f in result["files"] 
        if not f["filename"].endswith(".ocr.md") and not f["filename"].endswith(".meta.json")
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
        # 清理 sidecar 文件（如果存在）
        sidecar_ocr = uploads_dir / f"{filename}.ocr.md"
        sidecar_ocr.unlink(missing_ok=True)
        sidecar_meta = uploads_dir / f"{filename}.meta.json"
        sidecar_meta.unlink(missing_ok=True)
        return result
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")
    except PathTraversalError:
        raise HTTPException(status_code=400, detail="Invalid path")
    except Exception as e:
        logger.error(f"Failed to delete {filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete {filename}: {str(e)}")
