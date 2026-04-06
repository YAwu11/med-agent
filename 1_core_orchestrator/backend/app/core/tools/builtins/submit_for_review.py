"""Submit-for-review tool: blocks until doctor completes imaging report review.

This tool is ONLY used by imaging-agent. When called, it:
1. Writes the AI raw report to disk as a JSON file
2. Polls the file every 2 seconds until a doctor changes status to 'reviewed'
3. Returns the doctor-modified (or doctor-confirmed) report data

The frontend discovers pending reviews via GET /api/threads/{tid}/imaging-reports.
The doctor submits modifications via PUT /api/threads/{tid}/imaging-reports/{rid}.
"""

import asyncio
import json
import logging
import uuid
from typing import Any

from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT

from app.core.config.paths import get_paths
from app.core.thread_state import ThreadState

logger = logging.getLogger(__name__)

# How often to check for doctor review (seconds)
_POLL_INTERVAL = 2


@tool("submit_for_review", parse_docstring=True)
async def submit_for_review_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    report_json: str,
    image_path: str,
) -> str:
    """Submit AI imaging analysis results for doctor review and wait for approval.

    Call this tool AFTER receiving results from the MCP analyze_xray tool.
    The tool will block until the doctor completes their review on the frontend.
    Once the doctor approves (with or without modifications), the reviewed data
    is returned for you to use in your final analysis report.

    Args:
        report_json: The raw JSON string from the MCP analyze_xray tool output.
        image_path: The original image file path that was analyzed.
    """
    # Extract thread_id from runtime context (injected by task_tool -> executor)
    thread_id = None
    if runtime and runtime.context:
        thread_id = runtime.context.get("thread_id")
    if not thread_id:
        logger.error("[HITL] thread_id not found in runtime context, cannot write report")
        return json.dumps({"error": "Internal error: thread_id not available in agent context"})

    report_id = str(uuid.uuid4())[:8]

    # Resolve the reports directory next to uploads
    paths = get_paths()
    paths.ensure_thread_dirs(thread_id)
    reports_dir = paths.sandbox_user_data_dir(thread_id) / "imaging-reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    report_file = reports_dir / f"{report_id}.json"

    # Parse the AI result, handling both JSON strings and raw dicts
    try:
        ai_result = json.loads(report_json) if isinstance(report_json, str) else report_json
    except json.JSONDecodeError:
        ai_result = {"raw_text": report_json}

    # Write the pending review file
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
        f"[HITL] Report {report_id} written to {report_file}, waiting for doctor review..."
    )

    # Poll until doctor submits review
    while True:
        try:
            data = json.loads(report_file.read_text(encoding="utf-8"))
            if data.get("status") == "reviewed":
                logger.info(f"[HITL] Report {report_id} reviewed by doctor")
                # Return doctor's version if they made changes, otherwise AI original
                reviewed = data.get("doctor_result") or data.get("ai_result", {})
                return json.dumps(reviewed, ensure_ascii=False)
        except Exception as e:
            logger.warning(f"[HITL] Error reading report file: {e}")

        await asyncio.sleep(_POLL_INTERVAL)

