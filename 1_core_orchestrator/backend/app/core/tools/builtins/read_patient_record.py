"""Read patient record tool for diagnosis and re-diagnosis flows."""

import json
import logging
from typing import Literal

from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT
from pydantic import BaseModel, Field

from app.core.thread_state import ThreadState
from deerflow.patient_record_context import build_patient_record_snapshot

logger = logging.getLogger(__name__)


class ReadPatientRecordSchema(BaseModel):
    """Schema for reading the current patient record snapshot."""

    mode: Literal["summary", "full", "diagnosis"] = Field(
        "diagnosis",
        description="How much patient-record detail to return. Use diagnosis before giving a comprehensive judgment.",
    )


def _build_summary_view(snapshot: dict) -> dict:
    return {
        "type": "patient_record_snapshot",
        "mode": "summary",
        "thread_id": snapshot.get("thread_id"),
        "revision": snapshot.get("revision", 0),
        "patient_info": snapshot.get("patient_info", {}),
        "uploaded_items": [
            {
                "filename": item.get("filename"),
                "image_type": item.get("image_type"),
                "status": item.get("status"),
            }
            for item in snapshot.get("uploaded_items", [])
        ],
        "guidance": snapshot.get("guidance", {}),
    }


@tool("read_patient_record", args_schema=ReadPatientRecordSchema, parse_docstring=True)
async def read_patient_record_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    mode: Literal["summary", "full", "diagnosis"] = "diagnosis",
) -> str:
    """Read the patient's current structured record snapshot.

    Call this tool before giving a comprehensive medical judgment or when you need
    to re-evaluate the patient after new data arrives.

    Args:
        mode: Snapshot detail level. Use `diagnosis` before comprehensive judgment.
    """
    thread_id = None
    if runtime and runtime.context:
        thread_id = runtime.context.get("thread_id")
    if not thread_id:
        return json.dumps({"error": "Internal error: thread_id not available"})

    try:
        snapshot = build_patient_record_snapshot(thread_id)
        if mode == "summary":
            payload = _build_summary_view(snapshot)
        else:
            payload = {
                "type": "patient_record_snapshot",
                "mode": mode,
                **snapshot,
            }

        logger.info(
            "[READ_PATIENT_RECORD] Generated %s snapshot for thread %s (revision=%s)",
            mode,
            thread_id,
            snapshot.get("revision", 0),
        )
        return json.dumps(payload, ensure_ascii=False)
    except Exception as exc:
        logger.error("[READ_PATIENT_RECORD] Failed to generate snapshot: %s", exc, exc_info=True)
        return json.dumps({"error": f"病历读取失败: {str(exc)}"}, ensure_ascii=False)