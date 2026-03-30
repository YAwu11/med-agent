"""Save analysis result tool: non-blocking async storage for AI analysis results.

Replaces the old submit_for_review tool which blocked the Agent in a polling loop.
This tool writes the AI result to disk immediately and returns, allowing the Agent
to continue responding to the patient without waiting for doctor review.

The doctor discovers and reviews results via GET /api/threads/{tid}/imaging-reports.
Additionally, it creates/updates a Case in the central database so the result
appears in the doctor's Queue page.
"""

import json
import logging
import uuid
from typing import Any

from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT

from app.core.thread_state import ThreadState
from app.core.config.paths import get_paths

logger = logging.getLogger(__name__)


def _sync_to_case_db(thread_id: str, report_id: str, image_path: str, ai_result: dict) -> None:
    """Best-effort sync to the central Case database.

    If the Case DB is unavailable, the imaging-report file on disk is
    the authoritative fallback.  We log warnings but never crash the tool.
    """
    try:
        from app.gateway.models.case import (
            AddEvidenceRequest,
            CreateCaseRequest,
            PatientInfo,
            Priority,
        )
        from app.gateway.services import case_db

        # Check if a Case already exists for this patient thread
        existing = case_db.list_cases(limit=1)
        case_for_thread = None
        for c in case_db.list_cases(limit=200):
            if c.patient_thread_id == thread_id:
                case_for_thread = c
                break

        evidence_title = image_path.rsplit("/", 1)[-1] if "/" in image_path else image_path
        # Determine if AI flagged any abnormality
        is_abnormal = False
        if isinstance(ai_result, dict):
            # Check common MCP result patterns
            findings = ai_result.get("findings", ai_result.get("abnormalities", []))
            if findings:
                is_abnormal = True

        if case_for_thread:
            # Append evidence to existing case
            case_db.add_evidence(
                case_for_thread.case_id,
                AddEvidenceRequest(
                    type="imaging",
                    title=f"影像分析: {evidence_title}",
                    source="ai_generated",
                    file_path=image_path,
                    structured_data=ai_result if isinstance(ai_result, dict) else None,
                    ai_analysis=json.dumps(ai_result, ensure_ascii=False)[:500] if ai_result else None,
                    is_abnormal=is_abnormal,
                ),
            )
            logger.info(f"[CASE-SYNC] Added evidence to case {case_for_thread.case_id}")
        else:
            # Create a brand new Case
            new_case = case_db.create_case(
                CreateCaseRequest(
                    patient_thread_id=thread_id,
                    priority=Priority.HIGH if is_abnormal else Priority.MEDIUM,
                    patient_info=PatientInfo(),  # Will be enriched later
                    evidence=[],
                )
            )
            # Immediately add the evidence
            case_db.add_evidence(
                new_case.case_id,
                AddEvidenceRequest(
                    type="imaging",
                    title=f"影像分析: {evidence_title}",
                    source="ai_generated",
                    file_path=image_path,
                    structured_data=ai_result if isinstance(ai_result, dict) else None,
                    ai_analysis=json.dumps(ai_result, ensure_ascii=False)[:500] if ai_result else None,
                    is_abnormal=is_abnormal,
                ),
            )
            logger.info(f"[CASE-SYNC] Created new case {new_case.case_id} for thread {thread_id}")

    except Exception as e:
        # Non-fatal: the imaging-report file on disk is the fallback
        logger.warning(f"[CASE-SYNC] Failed to sync to Case DB (non-fatal): {e}")


@tool("save_analysis_result", parse_docstring=True)
async def save_analysis_result_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    report_json: str,
    image_path: str,
) -> str:
    """Save AI imaging analysis results to disk for asynchronous doctor review.

    Call this tool AFTER receiving results from the MCP analyze_xray tool.
    Unlike submit_for_review, this tool returns IMMEDIATELY — it does NOT
    wait for doctor approval. The doctor will review the results later
    on their dedicated Doctor Dashboard.

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

    # Resolve the reports directory
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

    # Write the report file with pending_review status
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
        f"[ASYNC-SAVE] Report {report_id} saved to {report_file}. "
        f"Agent will continue without waiting for doctor review."
    )

    # Sync to central Case database (best-effort, non-blocking)
    _sync_to_case_db(thread_id, report_id, image_path, ai_result)

    # Return the AI result immediately so the Agent can summarize for the patient
    return json.dumps({
        "status": "saved_for_review",
        "report_id": report_id,
        "ai_result": ai_result,
        "message": "分析结果已保存，医生将在诊断台异步审核。请根据AI分析结果为患者提供初步建议。",
    }, ensure_ascii=False)

