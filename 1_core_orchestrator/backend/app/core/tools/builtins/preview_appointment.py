"""Preview Appointment tool: generates a structured preview for patient review.

[ADR-021] This tool is called by the Agent when the patient agrees to register.
It reads all sandbox data (patient info + analysis results) and returns a structured
preview that the frontend renders as an interactive confirmation card.

The tool ONLY reads sandbox data — it does NOT create any Case or write to the database.
Actual registration happens when the patient clicks "确认提交" on the frontend,
which triggers POST /api/threads/{tid}/confirm-appointment.
"""

import json
import logging

from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT
from pydantic import BaseModel, Field

from app.core.thread_state import ThreadState
from deerflow.patient_record_context import build_patient_record_snapshot

logger = logging.getLogger(__name__)


class PreviewAppointmentSchema(BaseModel):
    """Schema for generating appointment preview."""
    priority: str = Field(
        "medium",
        description="基于症状严重程度的分诊优先级: low, medium, high, critical"
    )
    department: str | None = Field(
        None,
        description="建议科室，如 '呼吸内科', '骨科', '心内科'"
    )
    reason: str = Field(
        ...,
        description="挂号原因摘要（1-2 句话概括患者情况）"
    )


@tool("preview_appointment", args_schema=PreviewAppointmentSchema, parse_docstring=True)
async def preview_appointment_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    priority: str = "medium",
    department: str | None = None,
    reason: str = "",
) -> str:
    """Generate a preview of the appointment registration for patient review.

    Call this tool when the patient confirms they want to register. The system will
    display an interactive confirmation card where the patient can review, edit,
    and confirm their information before final submission.

    Args:
        priority: Triage priority level (low/medium/high/critical) based on symptoms.
        department: Suggested medical department for the consultation.
        reason: Brief summary of why this appointment is being scheduled.
    """
    thread_id = None
    if runtime and runtime.context:
        thread_id = runtime.context.get("thread_id")
    if not thread_id:
        return json.dumps({"error": "Internal error: thread_id not available"})

    try:
        from app.gateway.services import case_db

        # Guard: prevent duplicate registration
        existing_case = case_db.get_case_by_thread(thread_id)
        if existing_case:
            return json.dumps({
                "type": "appointment_confirmed",
                "case_id": existing_case.case_id,
                "message": f"您已成功挂号（编号: {existing_case.case_id[:8]}），无需重复挂号。",
            }, ensure_ascii=False)

        snapshot = build_patient_record_snapshot(thread_id)

        # ── Step 3: 构造预览数据 ──
        preview_data = {
            "type": "appointment_preview",
            "thread_id": thread_id,
            "patient_info": snapshot["patient_info"],
            "evidence_items": snapshot["evidence_items"],
            "suggested_priority": priority,
            "suggested_department": department,
            "reason": reason,
        }

        logger.info(
            f"[PREVIEW] Generated preview for thread {thread_id}: "
            f"{len(snapshot['evidence_items'])} evidence items"
        )

        # 返回给 Agent 的消息（前端会检测 type=appointment_preview 并渲染为交互卡片）
        return json.dumps(preview_data, ensure_ascii=False)

    except Exception as e:
        logger.error(f"[PREVIEW] Failed to generate preview: {e}", exc_info=True)
        return json.dumps({"error": f"预览生成失败，请稍后重试。({str(e)})"}, ensure_ascii=False)
