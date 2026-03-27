"""Upload router for handling file uploads."""

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from deerflow.config.app_config import get_app_config
from deerflow.config.paths import get_paths
from deerflow.sandbox.sandbox_provider import get_sandbox_provider
from deerflow.uploads.manager import (
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
from deerflow.utils.file_conversion import CONVERTIBLE_EXTENSIONS, convert_file_to_markdown

logger = logging.getLogger(__name__)

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}

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

            # ── P2: 视觉管道（受 vision.enabled 开关控制） ──
            file_ext = file_path.suffix.lower()
            vision_cfg = getattr(get_app_config(), "vision", None) or {}
            vision_enabled = vision_cfg.get("enabled", False)

            if file_ext in IMAGE_EXTS and vision_enabled:
                try:
                    from app.gateway.services.vision_gateway import (
                        classify_image,
                        enhance_lab_report,
                        enhance_medical_imaging,
                    )

                    classification = await classify_image(str(file_path))
                    file_info["image_type"] = classification["category"]
                    file_info["image_confidence"] = str(classification["confidence"])

                    # 写入分类结果 sidecar 文件，保证多次会话/重载时不丢失类型信息
                    import json
                    meta_path = uploads_dir / f"{safe_filename}.meta.json"
                    meta_path.write_text(json.dumps({
                        "image_type": classification["category"], 
                        "image_confidence": classification["confidence"]
                    }), encoding="utf-8")

                    outputs_dir = get_paths().sandbox_outputs_dir(thread_id)
                    outputs_dir.mkdir(parents=True, exist_ok=True)
                    enhanced_name = f"enhanced_{safe_filename}"
                    enhanced_host = str(outputs_dir / enhanced_name)

                    if classification["category"] == "lab_report":
                        # 步骤1: 增强（检查文件是否仍存在）
                        if not file_path.exists():
                            logger.warning(f"文件已被删除，跳过增强: {file_path}")
                            continue
                        await asyncio.to_thread(
                            enhance_lab_report, str(file_path), enhanced_host
                        )
                        file_info["enhanced_path"] = f"/mnt/user-data/outputs/{enhanced_name}"

                        # 步骤2: 百度 OCR（使用原始图片，增强版仅供前端展示）
                        from app.gateway.services.baidu_ocr import fetch_medical_report_ocr

                        raw_json = await fetch_medical_report_ocr(str(file_path))
                        logger.info(f"百度 OCR 原始返回 ({safe_filename}): 包含 {len(raw_json.get('Item', raw_json.get('item', [])))} 项" if raw_json else f"百度 OCR 返回 None ({safe_filename})")

                        # 步骤3: JSON → Markdown + 写 sidecar 文件
                        from app.gateway.services.ocr_formatter import format_to_markdown

                        clean_md = format_to_markdown(raw_json or {})
                        sidecar_path = uploads_dir / f"{safe_filename}.ocr.md"
                        sidecar_path.write_text(clean_md, encoding="utf-8")
                        logger.info(f"OCR sidecar 已写入: {sidecar_path}")

                    elif classification["category"] == "medical_imaging":
                        if not file_path.exists():
                            logger.warning(f"文件已被删除，跳过增强: {file_path}")
                            continue
                        await asyncio.to_thread(
                            enhance_medical_imaging, str(file_path), enhanced_host
                        )
                        file_info["enhanced_path"] = f"/mnt/user-data/outputs/{enhanced_name}"

                except Exception as vision_err:
                    logger.error(f"视觉管道处理失败 ({safe_filename}): {vision_err}")
                    # 视觉管道失败不影响上传本身

        except Exception as e:
            logger.error(f"Failed to upload {file.filename}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to upload {file.filename}: {str(e)}")

    return UploadResponse(
        success=True,
        files=uploaded_files,
        message=f"Successfully uploaded {len(uploaded_files)} file(s)",
    )


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
