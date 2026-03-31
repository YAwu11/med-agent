"""Analyzer for lab and text-heavy medical reports."""

import asyncio
import logging
from pathlib import Path

from app.gateway.services.analyzer_registry import AnalysisResult
from app.gateway.services.vision_gateway import enhance_lab_report
from app.gateway.services.paddle_ocr import fetch_medical_report_ocr, _extract_title_from_markdown
from deerflow.config.paths import get_paths

logger = logging.getLogger(__name__)

class LabOCRAnalyzer:
    """Uses PaddleOCR-VL model to extract markdown from lab reports."""
    
    async def analyze(self, image_path: str, thread_id: str, original_filename: str) -> AnalysisResult:
        outputs_dir = get_paths().sandbox_outputs_dir(thread_id)
        outputs_dir.mkdir(parents=True, exist_ok=True)
        
        safe_filename = Path(image_path).name # The already safe name 
        enhanced_name = f"enhanced_{safe_filename}"
        enhanced_host = str(outputs_dir / enhanced_name)

        # Step 1: Enhance Image for text extraction
        if Path(image_path).exists():
             await asyncio.to_thread(enhance_lab_report, image_path, enhanced_host)
        else:
             logger.warning(f"File missing, skipping enhancement: {image_path}")

        # Step 2: Extract text using VLM
        ocr_markdown = await fetch_medical_report_ocr(image_path)
        logger.info(f"VLM OCR yield ({original_filename}): {len(ocr_markdown)} chars" if ocr_markdown else f"VLM Empty ({original_filename})")

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
            enhanced_file_path=f"/mnt/user-data/outputs/{enhanced_name}" if Path(enhanced_host).exists() else None
        )
