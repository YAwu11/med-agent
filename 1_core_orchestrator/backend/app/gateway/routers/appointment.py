"""Appointment router: preview and confirmation endpoints.

[ADR-021] Appointment workflow:
1. Agent calls preview_appointment tool → returns structured preview JSON
2. Frontend renders interactive confirmation card
3. Patient reviews/edits info → clicks "确认提交"
4. Frontend calls POST /api/threads/{tid}/confirm-appointment
5. This endpoint creates the formal Case + SSE broadcast to doctor dashboard
"""

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter
from loguru import logger
from pydantic import BaseModel, ConfigDict

from app.core.config.paths import get_paths
from app.core.uploads.manager import upload_artifact_url
from deerflow.patient_record_context import build_patient_record_snapshot

router = APIRouter(prefix="/api/threads/{thread_id}", tags=["appointment"])

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp", ".gif", ".dcm"}


def _is_nifti_file(filename: str) -> bool:
    lower = filename.lower()
    return lower.endswith(".nii") or lower.endswith(".nii.gz")


def _is_visible_upload(path: Path) -> bool:
    lower = path.name.lower()
    if lower.endswith(".ocr.md") or lower.endswith(".meta.json"):
        return False
    return path.is_file()


def _pending_upload_evidence_type(filename: str) -> str:
    return "imaging" if Path(filename).suffix.lower() in IMAGE_EXTENSIONS or _is_nifti_file(filename) else "note"


def _pending_upload_title(filename: str) -> str:
    evidence_type = _pending_upload_evidence_type(filename)
    return f"待处理影像: {filename}" if evidence_type == "imaging" else f"待处理资料: {filename}"


def _is_empty_update_value(value: object) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def _sanitize_patient_info_payload(payload: dict) -> dict:
    return {key: value for key, value in payload.items() if key != "_field_meta"}

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
        if k in PatientInfo.model_fields and v is not None
    })

    patient_info_payload = patient_info.model_dump(exclude_none=True)

    # Write back edited patient info to sandbox (for consistency)
    paths = get_paths()
    sandbox_dir = paths.sandbox_user_data_dir(thread_id)
    intake_file = sandbox_dir / "patient_intake.json"
    existing_intake: dict = {}
    if intake_file.exists():
        try:
            existing_intake = json.loads(intake_file.read_text(encoding="utf-8"))
        except Exception:
            existing_intake = {}

    persisted_intake = dict(patient_info_payload)
    existing_field_meta = existing_intake.get("_field_meta")
    if isinstance(existing_field_meta, dict) and existing_field_meta:
        persisted_intake["_field_meta"] = existing_field_meta

    intake_file.write_text(
        json.dumps(persisted_intake, ensure_ascii=False, indent=2),
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
    attached_ids: set[str] = set()
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
                attached_ids.add(report_id)

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
            attached_ids.add(lab_id)

            ocr_text = ocr_file.read_text(encoding="utf-8")
            case_db.add_evidence(new_case.case_id, AddEvidenceRequest(
                evidence_id=lab_id,
                type="lab",
                title=f"化验单: {original}",
                source="patient_upload",
                ai_analysis=ocr_text[:500] if ocr_text else None,
                is_abnormal=False,
            ))

    for upload_file in sorted(path for path in uploads_dir.iterdir() if _is_visible_upload(path)):
        pending_id = f"pending_{upload_file.name}"
        if pending_id not in selected_ids and upload_file.name not in selected_ids:
            continue

        if pending_id in attached_ids or upload_file.name in attached_ids:
            continue

        if (uploads_dir / f"{upload_file.name}.ocr.md").exists():
            continue

        case_db.add_evidence(new_case.case_id, AddEvidenceRequest(
            evidence_id=pending_id,
            type=_pending_upload_evidence_type(upload_file.name),
            title=_pending_upload_title(upload_file.name),
            source="patient_upload",
            file_path=upload_artifact_url(thread_id, upload_file.name),
            structured_data={
                "status": "processing",
                "source_upload_filename": upload_file.name,
            },
            is_abnormal=False,
        ))
        attached_ids.add(pending_id)

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
    field_meta = existing.get("_field_meta")
    if not isinstance(field_meta, dict):
        field_meta = {}
    now = datetime.now(timezone.utc).isoformat()

    for k, v in update_data.items():
        if k == "_field_meta":
            continue

        if not _is_empty_update_value(v):
            existing[k] = v
            field_meta[k] = {"source": "patient", "updated_at": now}
        else:
            existing.pop(k, None)
            field_meta.pop(k, None)

    if field_meta:
        existing["_field_meta"] = field_meta
    else:
        existing.pop("_field_meta", None)

    intake_file.write_text(
        json.dumps(existing, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    logger.info(f"[PATIENT_INTAKE] Updated intake for thread {thread_id}: {list(update_data.keys())}")
    return {"success": True, "patient_info": _sanitize_patient_info_payload(existing)}
