from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config.paths import Paths
from app.core.uploads.manager import upload_artifact_url
from app.gateway.models.case import Case, PatientInfo


def _make_app() -> FastAPI:
    from app.gateway.routers import appointment

    app = FastAPI()
    app.include_router(appointment.router)
    return app


def test_confirm_appointment_attaches_pending_uploaded_images_to_case(tmp_path: Path):
    thread_id = "thread-upload-handoff"
    paths = Paths(base_dir=tmp_path / ".deer-flow")
    paths.ensure_thread_dirs(thread_id)

    uploads_dir = paths.sandbox_uploads_dir(thread_id)
    (uploads_dir / "chest-xray.png").write_bytes(b"fake-image")

    created_case = Case(
        case_id="case-upload-handoff",
        patient_thread_id=thread_id,
        patient_info=PatientInfo(name="张三"),
    )
    added_evidence = []

    def _capture_add_evidence(case_id, req):
        added_evidence.append((case_id, req))
        return created_case

    with (
        patch("app.gateway.routers.appointment.get_paths", return_value=paths),
        patch("app.gateway.services.case_db.get_case_by_thread", return_value=None),
        patch("app.gateway.services.case_db.create_case", return_value=created_case),
        patch("app.gateway.services.case_db.add_evidence", side_effect=_capture_add_evidence),
        patch("app.gateway.services.case_db.sync_report_from_file"),
        patch("app.gateway.routers.cases._broadcast_event"),
    ):
        with TestClient(_make_app(), raise_server_exceptions=False) as client:
            response = client.post(
                f"/api/threads/{thread_id}/confirm-appointment",
                json={
                    "patient_info": {"name": "张三", "chief_complaint": "胸痛"},
                    "selected_evidence_ids": ["pending_chest-xray.png"],
                    "priority": "medium",
                },
            )

    assert response.status_code == 200
    assert response.json()["case_id"] == "case-upload-handoff"
    assert len(added_evidence) == 1

    case_id, evidence_request = added_evidence[0]
    assert case_id == "case-upload-handoff"
    assert evidence_request.type == "imaging"
    assert evidence_request.source == "patient_upload"
    assert evidence_request.title.endswith("chest-xray.png")
    assert evidence_request.file_path == upload_artifact_url(thread_id, "chest-xray.png")
    assert evidence_request.structured_data == {
        "status": "processing",
        "source_upload_filename": "chest-xray.png",
    }