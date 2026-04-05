"""Analyzer for lab and text-heavy medical reports.

[Plan E] 使用本地 PPStructureV3 + Qwen3.5-35B-A3B 方案：
  PPStructureV3 → 纯文本 → Qwen3.5-35B-A3B → 固定 6 列 Markdown
  双源校验：PPStructureV3 原始数值指纹 ↔ LLM 清洗后数值交叉对账。
"""

from loguru import logger
from pathlib import Path

from app.gateway.services.analyzer_registry import AnalysisResult
from app.gateway.services.local_paddle_ocr import fetch_medical_report_ocr
from app.gateway.services.paddle_ocr import fetch_medical_report_ocr as fetch_medical_report_ocr_remote
from app.core.config.paths import get_paths


class LabOCRAnalyzer:
    """Uses PaddleOCR-VL model to extract markdown from lab reports."""
    
    async def analyze(self, image_path: str, thread_id: str, original_filename: str) -> AnalysisResult:
        outputs_dir = get_paths().sandbox_outputs_dir(thread_id)
        outputs_dir.mkdir(parents=True, exist_ok=True)
        
        safe_filename = Path(image_path).name

        # 优先本地 OCR；若本地依赖缺失或产空，则自动回退到云端 OCR，避免整条上传链路静默中断。
        ocr_markdown, ocr_raw_numbers = await fetch_medical_report_ocr(image_path)
        if not ocr_markdown:
            logger.warning(
                f"Local OCR returned empty result for {original_filename}; falling back to remote PaddleOCR-VL"
            )
            ocr_markdown, ocr_raw_numbers = await fetch_medical_report_ocr_remote(image_path)

        logger.info(
            f"OCR yield ({original_filename}): {len(ocr_markdown)} chars, {len(ocr_raw_numbers)} raw numbers"
            if ocr_markdown else f"OCR Empty ({original_filename})"
        )

        evidence_title = original_filename
        if ocr_markdown:
            uploads_dir = Path(image_path).parent
            sidecar_path = uploads_dir / f"{safe_filename}.ocr.md"
            sidecar_path.write_text(ocr_markdown, encoding="utf-8")

            # 尝试从 Markdown 第一行标题提取证据名
            for line in ocr_markdown.split("\n"):
                stripped = line.strip()
                if stripped.startswith("# "):
                    evidence_title = stripped.lstrip("# ").strip()
                    break

        # 构建 structured_data（包含 OCR 原始数值指纹供前端双源对账）
        structured = None
        if ocr_raw_numbers:
            structured = {"ocr_raw_numbers": ocr_raw_numbers}

        return AnalysisResult(
            filename=original_filename,
            category="",
            confidence=0.0,
            analyzer_name="",
            evidence_type="lab",
            evidence_title=evidence_title,
            ai_analysis_text=ocr_markdown,
            structured_data=structured,
            is_abnormal=False,
            enhanced_file_path=None
        )
