"""异步 3D NIfTI 医疗体积管线调度器。

架构决策 (ADR-036):
- 本模块被 BackgroundTasks 调用，因此必须是同步函数。
- 内部使用 asyncio.run() 显式创建事件循环执行异步 MCP 调用，
  避免与 Starlette BackgroundTasks 的事件循环管理冲突。
- Pipeline 完成后将结果回写到对应的 Evidence 记录上。
"""

import asyncio

from loguru import logger

from app.gateway.services.analyzers.brain_mcp import BrainTumorAnalyzer
from app.gateway.services.task_store import update_task_status


def process_nifti_pipeline_async(task_id: str, nifti_path: str, thread_id: str, original_filename: str, ev_id: str):
    """
    后台同步入口：被 FastAPI BackgroundTasks 调用。
    内部创建独立事件循环执行异步 MCP 调用，避免嵌套循环冲突。
    """
    try:
        asyncio.run(_run_pipeline(task_id, nifti_path, thread_id, original_filename, ev_id))
    except Exception as e:
        logger.exception(f"[{task_id}] 3D NIfTI 流水线顶层异常: {e}")
        update_task_status(task_id, "failed", error=str(e))


async def _run_pipeline(task_id: str, nifti_path: str, thread_id: str, original_filename: str, ev_id: str):
    """
    异步执行 3D NIfTI 医疗体积管线 (Step 1-3)。
    """
    logger.info(f"[{task_id}] 开始在后台执行 3D NIfTI 流水线: {original_filename} (EvID: {ev_id})")
    update_task_status(task_id, "processing")

    # 使用 BrainTumorAnalyzer 调度（内部通过 MCP SSE 调用 engine_3d）
    analyzer = BrainTumorAnalyzer()
    result = await analyzer.analyze(
        nifti_path,
        thread_id,
        original_filename,
        report_id=ev_id or None,
    )

    # 将结果回写到对应的 Evidence 上
    if ev_id:
        from app.gateway.services.case_db import get_case_by_thread, update_evidence_data
        case = get_case_by_thread(thread_id)
        if case:
            # 确保 structured_data 中保持 pipeline 标识和 status
            sd = result.structured_data or {}
            sd.setdefault("pipeline", "brain_nifti_v1")
            sd.setdefault("modality", "brain_mri_3d")
            sd.setdefault("viewer_kind", "brain_spatial_review")
            sd.setdefault("report_id", ev_id)
            sd["status"] = str(sd.get("status") or "pending_review")

            update_evidence_data(case.case_id, ev_id, {
                "structured_data": sd,
                "is_abnormal": result.is_abnormal,
                "ai_analysis": result.ai_analysis_text,
            })
            logger.info(f"[{task_id}] 成功将 3D 执行结果同步至 Evidence: {ev_id}")

    update_task_status(task_id, "completed", result=result.structured_data)
    logger.info(f"[{task_id}] 3D NIfTI 流水线执行完毕")
