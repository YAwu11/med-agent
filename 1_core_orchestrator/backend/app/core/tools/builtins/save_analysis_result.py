"""Save analysis result tool: non-blocking async storage for AI analysis results.

[ADR-020] Delayed Registration Architecture:
This tool ONLY writes AI analysis results to the sandbox disk as staging data.
It does NOT create or modify any Case in the EMR database.
Case creation happens exclusively via the schedule_appointment tool
when the patient explicitly confirms they want to register for a consultation.

The doctor discovers and reviews results via GET /api/threads/{tid}/imaging-reports
ONLY AFTER the patient has been formally registered (Case exists).
"""

import json
import logging
import uuid
from typing import Any

from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT

from app.core.config.paths import get_paths
from app.core.thread_state import ThreadState

logger = logging.getLogger(__name__)


@tool("save_analysis_result", parse_docstring=True)
async def save_analysis_result_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    report_json: str,
    image_path: str,
) -> str:
    """Save AI imaging analysis results to disk for asynchronous doctor review.

    Call this tool AFTER receiving results from the MCP analyze_xray tool.
    This tool writes the result to the sandbox staging area and returns
    IMMEDIATELY. The data will be formally registered into the EMR system
    only when the patient confirms scheduling via schedule_appointment.

    Args:
        report_json: The raw JSON string from the MCP analyze_xray tool output.
        image_path: The original image file path that was analyzed.
    """
    # Extract thread_id from runtime context
    thread_id = None
    if runtime and runtime.context:
        thread_id = runtime.context.get("thread_id")
    if not thread_id:
        logger.error("[ASYNC-SAVE] thread_id not found in runtime context")
        return json.dumps({"error": "Internal error: thread_id not available"})

    report_id = str(uuid.uuid4())[:8]

    # Resolve the reports directory (sandbox staging area)
    paths = get_paths()
    paths.ensure_thread_dirs(thread_id)
    reports_dir = paths.sandbox_user_data_dir(thread_id) / "imaging-reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    report_file = reports_dir / f"{report_id}.json"

    # Parse the AI result
    try:
        ai_result = json.loads(report_json) if isinstance(report_json, str) else report_json
    except json.JSONDecodeError:
        ai_result = {"raw_text": report_json}

    # Write the report file to sandbox with pending_review status
    report_data: dict[str, Any] = {
        "report_id": report_id,
        "thread_id": thread_id,
        "status": "pending_review",
        "image_path": image_path,
        "ai_result": ai_result,
        "doctor_result": None,
    }
    report_file.write_text(
        json.dumps(report_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info(
        f"[SANDBOX-SAVE] Report {report_id} staged to {report_file}. "
        f"Will be registered into EMR only upon patient scheduling confirmation."
    )

    # NOTE: No _sync_to_case_db() call here. Data stays in sandbox
    # until patient explicitly confirms scheduling via schedule_appointment tool.

    # Return the AI result immediately so the Agent can summarize for the patient
    return json.dumps({
        "status": "saved_for_review",
        "report_id": report_id,
        "ai_result": ai_result,
        "message": "分析结果已暂存。请根据AI分析结果为患者提供初步建议，并在合适时机询问是否需要挂号。",
    }, ensure_ascii=False)

