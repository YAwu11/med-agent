"""Appointment router: preview and confirmation endpoints.

[ADR-021] Appointment workflow:
1. Agent calls preview_appointment tool → returns structured preview JSON
2. Frontend renders interactive confirmation card
3. Patient reviews/edits info → clicks "确认提交"
4. Frontend calls POST /api/threads/{tid}/confirm-appointment
5. This endpoint creates the formal Case + SSE broadcast to doctor dashboard
"""

import json
from pathlib import Path

from fastapi import APIRouter
from loguru import logger
from pydantic import BaseModel, ConfigDict

from app.core.config.paths import get_paths
from deerflow.patient_record_context import build_patient_record_snapshot

router = APIRouter(prefix="/api/threads/{thread_id}", tags=["appointment"])

# ── Request / Response Models ──────────────────────────────

class EvidenceSelection(BaseModel):
    """Evidence item selected (or deselected) by the patient."""
    id: str
    selected: bool = True

class ConfirmAppointmentRequest(BaseModel):
    """Patient-confirmed appointment data (may be edited from original preview)."""
    patient_info: dict  # Patient may have edited name, age, complaints etc.
    selected_evidence_ids: list[str]  # Only the evidence items the patient chose to submit
    priority: str = "medium"
    department: str | None = None
    reason: str = ""

class ConfirmAppointmentResponse(BaseModel):
    """Response after successful registration."""
    success: bool
    case_id: str
    short_id: str
    department: str | None
    evidence_count: int
    message: str

# ── Preview Endpoint ───────────────────────────────────────

@router.get("/appointment-preview")
async def get_appointment_preview(thread_id: str) -> dict:
    """Return sandbox data for appointment preview.

    This is a read-only endpoint that returns all staged patient info
    and evidence items from the sandbox, without creating any Case.
    """
    from app.gateway.services import case_db

    # Guard: prevent duplicate
    existing = case_db.get_case_by_thread(thread_id)
    if existing:
        return {
            "type": "appointment_confirmed",
            "case_id": existing.case_id,
            "message": f"已挂号（编号: {existing.case_id[:8]}）",
        }

    snapshot = build_patient_record_snapshot(thread_id)

    return {
        "type": "appointment_preview",
        "thread_id": thread_id,
        "patient_info": snapshot["patient_info"],
        "evidence_items": snapshot["evidence_items"],
    }

# ── Confirm Endpoint ───────────────────────────────────────

@router.post("/confirm-appointment", response_model=ConfirmAppointmentResponse)
async def confirm_appointment(thread_id: str, req: ConfirmAppointmentRequest):
    """Formally register the patient's case after review.

    This is the ONLY endpoint that creates a Case in the EMR database.
    It is triggered by the patient clicking "确认提交" on the confirmation card.
    """
    from app.gateway.models.case import (
        AddEvidenceRequest,
        CreateCaseRequest,
        PatientInfo,
        Priority,
    )
    from app.gateway.services import case_db

    # Guard: prevent duplicate
    existing = case_db.get_case_by_thread(thread_id)
    if existing:
        return ConfirmAppointmentResponse(
            success=True,
            case_id=existing.case_id,
            short_id=existing.case_id[:8],
            department=req.department,
            evidence_count=0,
            message=f"您已成功挂号（编号: {existing.case_id[:8]}），无需重复操作。",
        )

    # Build PatientInfo from edited data
    patient_info = PatientInfo(**{
        k: v for k, v in req.patient_info.items()
        if hasattr(PatientInfo, k) and v is not None
    })

    # Write back edited patient info to sandbox (for consistency)
    paths = get_paths()
    sandbox_dir = paths.sandbox_user_data_dir(thread_id)
    intake_file = sandbox_dir / "patient_intake.json"
    intake_file.write_text(
        json.dumps(req.patient_info, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Map priority
    priority_map = {
        "low": Priority.LOW,
        "medium": Priority.MEDIUM,
        "high": Priority.HIGH,
        "critical": Priority.CRITICAL,
    }
    case_priority = priority_map.get(req.priority.lower(), Priority.MEDIUM)

    # Create the formal Case
    new_case = case_db.create_case(CreateCaseRequest(
        patient_thread_id=thread_id,
        priority=case_priority,
        patient_info=patient_info,
    ))
    logger.info(f"[CONFIRM] Created case {new_case.case_id} for thread {thread_id}")

    # Attach only the evidence items that the patient selected
    selected_ids = set(req.selected_evidence_ids)
    reports_dir = sandbox_dir / "imaging-reports"
    report_files: list[Path] = []

    if reports_dir.exists():
        report_files = sorted(reports_dir.glob("*.json"))
        for rf in report_files:
            try:
                rd = json.loads(rf.read_text(encoding="utf-8"))
                report_id = rd.get("report_id", rf.stem)
                if report_id not in selected_ids:
                    continue  # Skipped by patient

                ai_result = rd.get("ai_result", {})
                image_path = rd.get("image_path", "")
                findings = ai_result.get("findings", []) if isinstance(ai_result, dict) else []
                fname = image_path.rsplit("/", 1)[-1] if "/" in image_path else image_path

                case_db.add_evidence(new_case.case_id, AddEvidenceRequest(
                    evidence_id=report_id,
                    type="imaging",
                    title=f"影像分析: {fname}",
                    source="ai_generated",
                    file_path=image_path,
                    structured_data=ai_result if isinstance(ai_result, dict) else None,
                    ai_analysis=json.dumps(ai_result, ensure_ascii=False)[:500] if ai_result else None,
                    is_abnormal=bool(findings),
                ))
            except Exception as e:
                logger.warning(f"[CONFIRM] Failed to process report {rf}: {e}")

    # Sync reports to DB for ImagingViewer
    for rf in report_files:
        try:
            rd = json.loads(rf.read_text(encoding="utf-8"))
            if rd.get("report_id", rf.stem) in selected_ids:
                case_db.sync_report_from_file(thread_id, rf)
        except Exception as e:
            logger.warning(f"[CONFIRM] Failed to sync report: {e}")

    # Attach lab reports (OCR) as evidence
    uploads_dir = paths.sandbox_uploads_dir(thread_id)
    if uploads_dir and uploads_dir.exists():
        for ocr_file in sorted(uploads_dir.glob("*.ocr.md")):
            original = ocr_file.name.replace(".ocr.md", "")
            lab_id = f"lab_{original}"
            if lab_id not in selected_ids:
                continue

            ocr_text = ocr_file.read_text(encoding="utf-8")
            case_db.add_evidence(new_case.case_id, AddEvidenceRequest(
                evidence_id=lab_id,
                type="lab",
                title=f"化验单: {original}",
                source="patient_upload",
                ai_analysis=ocr_text[:500] if ocr_text else None,
                is_abnormal=False,
            ))

    evidence_count = len(selected_ids)

    # ── SSE Broadcast to doctor dashboard ──
    try:
        from app.gateway.routers.cases import _broadcast_event
        _broadcast_event("new_case", {
            "case_id": new_case.case_id,
            "priority": case_priority.value,
            "chief_complaint": patient_info.chief_complaint or "未填写",
        })
        logger.info(f"[CONFIRM] SSE broadcast: new_case {new_case.case_id}")
    except Exception as e:
        logger.warning(f"[CONFIRM] SSE broadcast failed: {e}")

    dept_text = f"，建议科室：{req.department}" if req.department else ""
    short_id = new_case.case_id[:8]

    return ConfirmAppointmentResponse(
        success=True,
        case_id=new_case.case_id,
        short_id=short_id,
        department=req.department,
        evidence_count=evidence_count,
        message=f"挂号成功！就诊编号 {short_id}{dept_text}。已提交 {evidence_count} 份检查资料。",
    )

# ── Medical Record Endpoints ──────────────────────────────

@router.get("/medical-record")
async def get_medical_record(thread_id: str) -> dict:
    """Return current medical record data for the drawer view.

    Reads sandbox-staged patient info and scanned evidence items,
    same logic as the show_medical_record tool but via REST API.
    """
    snapshot = build_patient_record_snapshot(thread_id)

    return {
        "type": "medical_record",
        "thread_id": thread_id,
        "patient_info": snapshot["patient_info"],
        "evidence_items": snapshot["evidence_items"],
        "guidance": snapshot["guidance"],
    }


class PatchPatientIntakeRequest(BaseModel):
    """Partial update to patient intake info."""

    model_config = ConfigDict(extra="allow")


@router.patch("/patient-intake")
async def patch_patient_intake(thread_id: str, req: PatchPatientIntakeRequest) -> dict:
    """Merge-update the sandbox patient_intake.json file.

    Used by the MedicalRecordCard edit form to save changes.
    """
    paths = get_paths()
    sandbox_dir = paths.sandbox_user_data_dir(thread_id)
    sandbox_dir.mkdir(parents=True, exist_ok=True)

    intake_file = sandbox_dir / "patient_intake.json"

    # Read existing
    existing: dict = {}
    if intake_file.exists():
        try:
            existing = json.loads(intake_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    # Merge update (only non-None fields from request)
    update_data = req.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        if v is not None and v != "":
            existing[k] = v
        elif v == "" or v is None:
            existing.pop(k, None)

    intake_file.write_text(
        json.dumps(existing, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    logger.info(f"[PATIENT_INTAKE] Updated intake for thread {thread_id}: {list(update_data.keys())}")
    return {"success": True, "patient_info": existing}
