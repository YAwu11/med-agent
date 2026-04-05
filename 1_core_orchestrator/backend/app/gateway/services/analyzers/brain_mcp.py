"""脑肿瘤 MRI 3D NIfTI 分析器 (Brain Tumor Analyzer)

架构决策 (ADR-033/036):
- 本模块为"脑肿瘤 HITL 分割"子系统的后端调度入口。
- YOLO-seg 2D 方案已废弃。全面采用 3D NIfTI 管线（nnU-Net + ANTs）。
- 绝不在这里进行任何医学库的依赖导入（绝对禁止导入 nibabel / ants）。
- 本模块仅作为代理层，将 NIfTI 数据包路径通过 MCP 协议发往独立的 `mcp-brain-tumor-sse` (端口 8003)。
- 收到空间结构化数据和报告后，组装成 AnalysisResult。
"""

import json
import uuid

from loguru import logger

from app.core.config.paths import get_paths
from app.gateway.services.analyzer_registry import AnalysisResult
from app.gateway.services.mcp_brain_client import analyze_brain_tumor_nifti_mcp


class BrainTumorAnalyzer:
    """脑部 3D 取向肿瘤分析器"""

    async def analyze(
        self,
        image_path: str,
        thread_id: str,
        original_filename: str,
        report_id: str | None = None,
    ) -> AnalysisResult:
        logger.info(f"[BrainMCP] 接收到脑部 MRI 任务: {original_filename}")

        # 1. 向远端微服务发送推理请求
        result_dict = await analyze_brain_tumor_nifti_mcp(image_path, original_filename)

        if not result_dict:
            logger.error(f"[BrainMCP] 远端 3D NIfTI 管线调用失败或无返回: {original_filename}")
            return AnalysisResult(
                filename=original_filename,
                category="",
                confidence=0.0,
                analyzer_name="BrainTumorAnalyzer",
                evidence_type="imaging",
                evidence_title="脑部核磁共振 (MRI NIfTI)",
                error="MCP 微服务无响应。请确保 8003 端口的 mcp_brain_tumor 正在运行。",
                is_abnormal=False
            )

        # 2. 提取微服务传回的结构化空间数据
        spatial_info = result_dict.get("spatial_info", {})
        slice_png_path = result_dict.get("slice_png_path", "")
        
        is_abnormal = result_dict.get("is_abnormal", False)
        is_mock_fallback = result_dict.get("is_mock_fallback", False)

        # 3. 将分析结果写入沙盒，供工作站展现
        resolved_report_id = report_id or str(uuid.uuid4())[:8]
        paths = get_paths()
        reports_dir = paths.sandbox_user_data_dir(thread_id) / "imaging-reports"
        reports_dir.mkdir(parents=True, exist_ok=True)
        report_file = reports_dir / f"{resolved_report_id}.json"

        # VLM 判定的结果数据
        ai_result = {
            "findings_count": 1 if is_abnormal else 0,
            "findings": [spatial_info.get("location", "未知部位")] if is_abnormal else [],
            "volumes": spatial_info.get("volumes", {})
        }

        report_payload = {
            "report_id": resolved_report_id,
            "thread_id": thread_id,
            "status": "pending_review",
            "image_path": slice_png_path if slice_png_path else image_path,
            "source_upload_filename": original_filename,
            "modality": "brain_mri_3d",
            "viewer_kind": "brain_spatial_review",
            "ai_result": ai_result,
            "doctor_result": None,
        }
        report_file.write_text(
            json.dumps(report_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        structured_data = {
            "pipeline": "brain_nifti_v1",
            "mcp_status": "completed",
            "modality": "brain_mri_3d",
            "viewer_kind": "brain_spatial_review",
            "status": "pending_review",
            "spatial_info": spatial_info,
            "slice_png_path": slice_png_path,
            "is_mock_fallback": is_mock_fallback,
            "report_id": resolved_report_id,
        }

        # 4. 返回标准 AnalysisResult 供大模型整合
        return AnalysisResult(
            filename=original_filename,
            category="",
            confidence=0.0,
            analyzer_name="BrainTumorAnalyzer",
            evidence_type="imaging",
            evidence_title=f"脑部核磁共振 3D 分析 ({original_filename})",
            ai_analysis_text=None,  # 报告留待医生在 UI 完成空间数据复核后请求生成
            structured_data=structured_data,
            is_abnormal=is_abnormal
        )
