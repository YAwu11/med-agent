"""Schedule Appointment tool: the formal registration gate.

[ADR-020] Delayed Registration Architecture:
This is the ONLY tool that creates a Case in the EMR database.
It is called exclusively when the patient explicitly confirms they want
to register for a doctor consultation. 

The tool performs an atomic operation:
  1. Read sandbox patient_intake.json → PatientInfo
  2. Scan sandbox imaging-reports/*.json → Evidence items
  3. Create formal Case in cases.db (status=pending)
  4. Sync reports into the reports table for ImagingViewer
  5. Returns confirmation to the Agent
"""

import json
import logging
from pathlib import Path

from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT
from pydantic import BaseModel, Field

from app.core.thread_state import ThreadState
from app.core.config.paths import get_paths

logger = logging.getLogger(__name__)


class ScheduleAppointmentSchema(BaseModel):
    """Schema for scheduling a patient appointment."""
    priority: str = Field(
        "medium",
        description="Suggested triage priority based on symptom severity: low, medium, high, critical"
    )
    department: str | None = Field(
        None,
        description="Suggested department, e.g. '呼吸内科', '骨科', '心内科'"
    )
    reason: str = Field(
        ...,
        description="Brief triage summary / reason for scheduling (1-2 sentences)"
    )


@tool("schedule_appointment", args_schema=ScheduleAppointmentSchema, parse_docstring=True)
async def schedule_appointment_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    priority: str = "medium",
    department: str | None = None,
    reason: str = "",
) -> str:
    """Schedule a formal doctor appointment for the patient.

    Call this tool ONLY after the patient has explicitly confirmed they want
    to register for a consultation. This will formally register their case
    into the medical system, making it visible to doctors on the review dashboard.

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
        from app.gateway.models.case import (
            AddEvidenceRequest,
            CreateCaseRequest,
            PatientInfo,
            Priority,
        )
        from app.gateway.services import case_db

        # ── Guard: prevent duplicate registration ──
        existing_case = case_db.get_case_by_thread(thread_id)
        if existing_case:
            return json.dumps({
                "status": "already_registered",
                "case_id": existing_case.case_id,
                "message": f"您已成功挂号（编号: {existing_case.case_id[:8]}），无需重复挂号。",
            }, ensure_ascii=False)

        paths = get_paths()
        sandbox_dir = paths.sandbox_user_data_dir(thread_id)

        # ── Step 1: Read sandbox patient_intake.json ──
        patient_info_dict: dict = {}
        intake_file = sandbox_dir / "patient_intake.json"
        if intake_file.exists():
            try:
                patient_info_dict = json.loads(intake_file.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as e:
                logger.warning(f"[SCHEDULE] Failed to read patient_intake.json: {e}")

        # Build PatientInfo model from staged data
        patient_info = PatientInfo(**{
            k: v for k, v in patient_info_dict.items()
            if hasattr(PatientInfo, k) and v is not None
        })

        # ── Step 2: Scan sandbox imaging-reports/*.json ──
        evidence_items: list[AddEvidenceRequest] = []
        reports_dir = sandbox_dir / "imaging-reports"
        report_files: list[Path] = []
        if reports_dir.exists():
            report_files = sorted(reports_dir.glob("*.json"))
            for report_file in report_files:
                try:
                    report_data = json.loads(report_file.read_text(encoding="utf-8"))
                    report_id = report_data.get("report_id", report_file.stem)
                    image_path = report_data.get("image_path", "")
                    ai_result = report_data.get("ai_result", {})

                    # Determine abnormality
                    is_abnormal = False
                    if isinstance(ai_result, dict):
                        findings = ai_result.get("findings", ai_result.get("abnormalities", []))
                        if findings:
                            is_abnormal = True

                    evidence_title = image_path.rsplit("/", 1)[-1] if "/" in image_path else image_path

                    evidence_items.append(AddEvidenceRequest(
                        evidence_id=report_id,
                        type="imaging",
                        title=f"影像分析: {evidence_title}",
                        source="ai_generated",
                        file_path=image_path,
                        structured_data=ai_result if isinstance(ai_result, dict) else None,
                        ai_analysis=json.dumps(ai_result, ensure_ascii=False)[:500] if ai_result else None,
                        is_abnormal=is_abnormal,
                    ))
                except Exception as e:
                    logger.warning(f"[SCHEDULE] Failed to parse report {report_file}: {e}")

        # ── Step 3: Map priority string to enum ──
        priority_map = {
            "low": Priority.LOW,
            "medium": Priority.MEDIUM,
            "high": Priority.HIGH,
            "critical": Priority.CRITICAL,
        }
        case_priority = priority_map.get(priority.lower(), Priority.MEDIUM)

        # ── Step 4: Create the formal Case (atomic) ──
        # [ADR-037] case_id = thread_id，让患者端和医生端使用同一个 ID
        new_case = case_db.create_case(CreateCaseRequest(
            case_id=thread_id,
            patient_thread_id=thread_id,
            priority=case_priority,
            patient_info=patient_info,
        ))
        logger.info(f"[SCHEDULE] Created case {new_case.case_id} for thread {thread_id}")

        # Attach all evidence items
        for ev_req in evidence_items:
            case_db.add_evidence(new_case.case_id, ev_req)

        # ── Step 5: Sync reports into the reports table for ImagingViewer ──
        for report_file in report_files:
            try:
                case_db.sync_report_from_file(thread_id, report_file)
            except Exception as e:
                logger.warning(f"[SCHEDULE] Failed to sync report to DB: {e}")

        # Build user-facing confirmation message
        dept_text = f"，建议科室：{department}" if department else ""
        case_short_id = new_case.case_id[:8]

        return json.dumps({
            "status": "success",
            "case_id": new_case.case_id,
            "message": (
                f"挂号成功！您的就诊编号为 {case_short_id}{dept_text}。"
                f"已为您提交 {len(evidence_items)} 份检查资料，医生将尽快审阅。"
                f"挂号原因：{reason}"
            ),
        }, ensure_ascii=False)

    except Exception as e:
        logger.error(f"[SCHEDULE] Failed to create appointment: {e}", exc_info=True)
        return json.dumps({"error": f"挂号失败，请稍后重试。({str(e)})"}, ensure_ascii=False)
