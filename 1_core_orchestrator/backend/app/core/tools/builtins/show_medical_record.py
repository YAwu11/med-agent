"""Show Medical Record tool: generates structured patient record card data.

Returns a JSON payload with type=medical_record that the frontend detects
and renders as an interactive MedicalRecordCard in the chat bubble.

Similar pattern to preview_appointment: Agent calls tool → JSON returned →
frontend detects type → renders card component.
"""

import json
import logging

from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT
from pydantic import BaseModel, Field

from app.core.thread_state import ThreadState
from deerflow.patient_record_context import build_patient_record_snapshot

logger = logging.getLogger(__name__)


class ShowMedicalRecordSchema(BaseModel):
    """Schema for showing medical record card."""
    message: str = Field(
        "",
        description="Optional message to display with the medical record card, e.g. '以下是您目前的病历信息，请确认是否正确'",
    )


@tool("show_medical_record", args_schema=ShowMedicalRecordSchema, parse_docstring=True)
async def show_medical_record_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    message: str = "",
) -> str:
    """Display the patient's current medical record as an interactive card.

    Call this tool after collecting enough patient information (basic demographics,
    chief complaint) to show the patient a summary of their medical record.
    The patient can review and edit the information directly on the card.
    Also call this tool when the patient asks to see their medical record.

    Args:
        message: Optional contextual message shown above the card.
    """
    thread_id = None
    if runtime and runtime.context:
        thread_id = runtime.context.get("thread_id")
    if not thread_id:
        return json.dumps({"error": "Internal error: thread_id not available"})

    try:
        snapshot = build_patient_record_snapshot(thread_id)

        # ── Build response ──
        record_data = {
            "type": "medical_record",
            "thread_id": thread_id,
            "message": message,
            "patient_info": snapshot["patient_info"],
            "evidence_items": snapshot["evidence_items"],
            "guidance": snapshot["guidance"],
        }

        logger.info(
            f"[MED_RECORD] Generated record for thread {thread_id}: "
            f"{len(snapshot['evidence_items'])} evidence items, "
            f"patient fields: {len([v for v in snapshot['patient_info'].values() if v])}"
        )

        return json.dumps(record_data, ensure_ascii=False)

    except Exception as e:
        logger.error(f"[MED_RECORD] Failed to generate record: {e}", exc_info=True)
        return json.dumps({"error": f"病历单生成失败: {str(e)}"}, ensure_ascii=False)
