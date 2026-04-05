"""Notice-only analyzer for unsupported 2D brain MRI screenshots.

The real brain tumor workflow only supports 3D NIfTI series. When CLIP
classifies a 2D image as ``brain_mri``, we return a doctor-readable guidance
note instead of routing the image into the 3D analyzer by mistake.
"""

from app.gateway.services.analyzer_registry import AnalysisResult


class BrainImageNoticeAnalyzer:
    """Explain that the brain pipeline only supports NIfTI uploads."""

    async def analyze(self, image_path: str, thread_id: str, original_filename: str) -> AnalysisResult:
        del image_path, thread_id

        return AnalysisResult(
            filename=original_filename,
            category="",
            confidence=0.0,
            analyzer_name="BrainImageNoticeAnalyzer",
            evidence_type="note",
            evidence_title="脑 MRI 二维截图（当前仅支持 NIfTI 原始序列）",
            ai_analysis_text=(
                "当前脑肿瘤分析链路只支持四序列 NIfTI 数据包上传。\n\n"
                "请改为上传同一病例目录，至少包含 t1、t1ce、t2、flair。\n"
                f"当前文件 {original_filename} 已保留，但不会进入 3D 分割与空间定位流程。"
            ),
            structured_data={
                "status": "unsupported",
                "modality": "brain_mri_2d",
                "viewer_kind": "brain_mri_notice",
            },
            is_abnormal=False,
        )