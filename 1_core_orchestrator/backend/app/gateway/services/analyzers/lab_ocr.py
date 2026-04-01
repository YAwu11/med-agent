"""Analyzer for lab and text-heavy medical reports."""

import asyncio
import logging
from pathlib import Path

from app.gateway.services.analyzer_registry import AnalysisResult
from app.gateway.services.vision_gateway import enhance_lab_report
from app.gateway.services.paddle_ocr import fetch_medical_report_ocr, _extract_title_from_markdown
from app.core.config.paths import get_paths
from app.core.utils.image_optimizer import optimize_lab_image

logger = logging.getLogger(__name__)

class LabOCRAnalyzer:
    """Uses PaddleOCR-VL model to extract markdown from lab reports."""
    
    async def analyze(self, image_path: str, thread_id: str, original_filename: str) -> AnalysisResult:
        outputs_dir = get_paths().sandbox_outputs_dir(thread_id)
        outputs_dir.mkdir(parents=True, exist_ok=True)
        
        safe_filename = Path(image_path).name # The already safe name 
        enhanced_name = f"enhanced_{safe_filename}"
        enhanced_host = str(outputs_dir / enhanced_name)

        # Step 0: 按需压缩优化（灰度化 + Lanczos缩放 + 锐化）
        # 只针对化验单/文字报告，原图保持不动，压缩图存入 outputs 沙盒
        optimized_path = image_path
        if Path(image_path).exists():
            try:
                opt_dst = str(outputs_dir / f"{Path(image_path).stem}_ocr_opt.jpg")
                optimized_path = await asyncio.to_thread(
                    optimize_lab_image, image_path, opt_dst
                )
                if optimized_path != image_path:
                    logger.info(f"[LabOCR] 使用压缩优化图: {Path(optimized_path).name}")
            except Exception as e:
                logger.warning(f"[LabOCR] 图像压缩失败，降级使用原图: {e}")
                optimized_path = image_path

        # Step 1: Enhance Image for text extraction
        if Path(optimized_path).exists():
             await asyncio.to_thread(enhance_lab_report, optimized_path, enhanced_host)
        else:
             logger.warning(f"File missing, skipping enhancement: {optimized_path}")

        # Step 2: Extract text using VLM (使用压缩后的图以加速传输和推理)
        # [ADR-035] 返回值变为 (markdown, ocr_raw_numbers) 元组
        ocr_markdown, ocr_raw_numbers = await fetch_medical_report_ocr(optimized_path)
        logger.info(f"VLM OCR yield ({original_filename}): {len(ocr_markdown)} chars, {len(ocr_raw_numbers)} numbers" if ocr_markdown else f"VLM Empty ({original_filename})")

        evidence_title = original_filename
        if ocr_markdown:
             # Cache to sidecar (useful for development and debugging)
             uploads_dir = Path(image_path).parent
             sidecar_path = uploads_dir / f"{safe_filename}.ocr.md"
             sidecar_path.write_text(ocr_markdown, encoding="utf-8")
             
             extracted_title = _extract_title_from_markdown(ocr_markdown)
             if extracted_title:
                 evidence_title = extracted_title

        return AnalysisResult(
            filename=original_filename,
            category="", # Overwritten by registry dispatcher
            confidence=0.0,
            analyzer_name="",
            evidence_type="lab",
            evidence_title=evidence_title,
            ai_analysis_text=ocr_markdown,
            # [ADR-035] 存储 OCR 原始数值指纹，前端用于交叉验证 LLM 清洗后数值
            structured_data={"ocr_raw_numbers": ocr_raw_numbers} if ocr_raw_numbers else None,
            enhanced_file_path=f"/mnt/user-data/outputs/{enhanced_name}" if Path(enhanced_host).exists() else None
        )
