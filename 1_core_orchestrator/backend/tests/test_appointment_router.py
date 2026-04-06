import json
import importlib
import sys
import warnings
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config.paths import Paths
from app.gateway.models.case import Case, PatientInfo


def _make_app() -> FastAPI:
    from app.gateway.routers import appointment

    app = FastAPI()
    app.include_router(appointment.router)
    return app


def test_patch_patient_intake_request_uses_v2_config_without_deprecation_warning():
    module_name = "app.gateway.routers.appointment"
    sys.modules.pop(module_name, None)

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        module = importlib.import_module(module_name)

    assert not any(
        "Support for class-based `config` is deprecated" in str(warning.message)
        for warning in caught
    )

    payload = module.PatchPatientIntakeRequest.model_validate(
        {
            "name": "张三",
            "chief_complaint": "发热",
            "custom_field": "kept",
        }
    )

    assert payload.model_dump() == {
        "name": "张三",
        "chief_complaint": "发热",
        "custom_field": "kept",
    }


def test_confirm_appointment_normalizes_lab_evidence_before_case_persist(tmp_path: Path):
    from app.gateway.routers import appointment

    thread_id = "thread-1"
    paths = Paths(base_dir=tmp_path / ".deer-flow")
    paths.ensure_thread_dirs(thread_id)
    uploads_dir = paths.sandbox_uploads_dir(thread_id)
    (uploads_dir / "cbc.png.ocr.md").write_text("WBC 升高", encoding="utf-8")

    added_evidence = []
    created_case = Case(
        case_id="case-1",
        patient_thread_id=thread_id,
        patient_info=PatientInfo(name="张三"),
    )

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
                    "patient_info": {"name": "张三", "chief_complaint": "发热"},
                    "selected_evidence_ids": ["lab_cbc.png"],
                    "priority": "medium",
                },
            )

    assert response.status_code == 200
    assert response.json()["case_id"] == "case-1"
    assert len(added_evidence) == 1
    _, evidence_request = added_evidence[0]
    assert evidence_request.type == "lab"
    assert evidence_request.source == "patient_upload"
    assert evidence_request.title == "化验单: cbc.png"
    assert evidence_request.ai_analysis == "WBC 升高"


def test_confirm_appointment_preserves_patient_info_fields(tmp_path: Path):
    thread_id = "thread-patient-info"
    paths = Paths(base_dir=tmp_path / ".deer-flow")
    paths.ensure_thread_dirs(thread_id)
    (paths.sandbox_user_data_dir(thread_id) / "patient_intake.json").write_text(
        json.dumps(
            {
                "_field_meta": {
                    "name": {
                        "source": "agent",
                        "updated_at": "2026-04-05T00:00:00Z",
                    }
                }
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    created_cases: list[Case] = []

    def _capture_create_case(req):
        created_case = Case(
            case_id="case-preserve-info",
            patient_thread_id=thread_id,
            patient_info=req.patient_info,
            priority=req.priority,
        )
        created_cases.append(created_case)
        return created_case

    with (
        patch("app.gateway.routers.appointment.get_paths", return_value=paths),
        patch("app.gateway.services.case_db.get_case_by_thread", return_value=None),
        patch("app.gateway.services.case_db.create_case", side_effect=_capture_create_case),
        patch("app.gateway.services.case_db.sync_report_from_file"),
        patch("app.gateway.routers.cases._broadcast_event"),
    ):
        with TestClient(_make_app(), raise_server_exceptions=False) as client:
            response = client.post(
                f"/api/threads/{thread_id}/confirm-appointment",
                json={
                    "patient_info": {
                        "name": "张三",
                        "age": 45,
                        "chief_complaint": "胸痛 2 天",
                    },
                    "selected_evidence_ids": [],
                    "priority": "medium",
                },
            )

    assert response.status_code == 200
    assert len(created_cases) == 1
    assert created_cases[0].patient_info.name == "张三"
    assert created_cases[0].patient_info.age == 45
    assert created_cases[0].patient_info.chief_complaint == "胸痛 2 天"

    intake_payload = json.loads(
        (paths.sandbox_user_data_dir(thread_id) / "patient_intake.json").read_text(
            encoding="utf-8"
        )
    )
    assert intake_payload["name"] == "张三"
    assert intake_payload["age"] == 45
    assert intake_payload["chief_complaint"] == "胸痛 2 天"
    assert intake_payload["_field_meta"]["name"]["source"] == "agent"


def test_patch_patient_intake_tracks_field_meta_and_removes_deleted_entries(tmp_path: Path):
    thread_id = "thread-patch-meta"
    paths = Paths(base_dir=tmp_path / ".deer-flow")
    paths.ensure_thread_dirs(thread_id)
    intake_file = paths.sandbox_user_data_dir(thread_id) / "patient_intake.json"
    intake_file.write_text(
        json.dumps(
            {
                "chief_complaint": "发热",
                "_field_meta": {
                    "chief_complaint": {
                        "source": "agent",
                        "updated_at": "2026-04-05T00:00:00Z",
                    }
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    with patch("app.gateway.routers.appointment.get_paths", return_value=paths):
        with TestClient(_make_app(), raise_server_exceptions=False) as client:
            response = client.patch(
                f"/api/threads/{thread_id}/patient-intake",
                json={
                    "chief_complaint": "",
                    "allergies": "青霉素过敏",
                },
            )

    assert response.status_code == 200
    response_payload = response.json()["patient_info"]
    assert "_field_meta" not in response_payload
    assert response_payload["allergies"] == "青霉素过敏"
    assert "chief_complaint" not in response_payload

    intake_payload = json.loads(intake_file.read_text(encoding="utf-8"))
    assert intake_payload["allergies"] == "青霉素过敏"
    assert "chief_complaint" not in intake_payload
    assert intake_payload["_field_meta"]["allergies"]["source"] == "patient"
    assert intake_payload["_field_meta"]["allergies"]["updated_at"]
    assert "chief_complaint" not in intake_payload["_field_meta"]


def test_get_appointment_preview_reuses_patient_snapshot_brain_contract(tmp_path: Path):
    thread_id = "thread-brain"
    paths = Paths(base_dir=tmp_path / ".deer-flow")
    paths.ensure_thread_dirs(thread_id)

    snapshot = {
        "patient_info": {
            "name": "周七",
            "age": 47,
            "sex": "女",
            "chief_complaint": "头痛伴视物模糊",
        },
        "guidance": {
            "ready_for_ai_summary": True,
        },
        "evidence_items": [
            {
                "id": "brain-report-2",
                "type": "imaging",
                "title": "脑 MRI 3D 分析: brain-mri.nii.gz",
                "filename": "brain-mri.nii.gz",
                "status": "completed",
                "is_abnormal": True,
                "report_id": "brain-report-2",
                "viewer_kind": "brain_spatial_review",
                "pipeline": "brain_nifti_v1",
                "modality": "brain_mri",
                "review_status": "reviewed",
                "slice_png_path": "/mnt/user-data/outputs/brain_slice.png",
                "spatial_info": {"location": "右侧额叶"},
                "findings_count": 1,
                "findings_brief": "右侧额叶占位",
            }
        ],
    }

    with (
        patch("app.gateway.routers.appointment.get_paths", return_value=paths),
        patch("app.gateway.services.case_db.get_case_by_thread", return_value=None),
        patch("app.gateway.routers.appointment.build_patient_record_snapshot", return_value=snapshot),
    ):
        with TestClient(_make_app(), raise_server_exceptions=False) as client:
            response = client.get(f"/api/threads/{thread_id}/appointment-preview")

    assert response.status_code == 200
    payload = response.json()
    assert payload["patient_info"]["name"] == "周七"
    assert payload["evidence_items"][0]["title"] == "脑 MRI 3D 分析: brain-mri.nii.gz"
    assert payload["evidence_items"][0]["viewer_kind"] == "brain_spatial_review"
    assert payload["evidence_items"][0]["pipeline"] == "brain_nifti_v1"
    assert payload["evidence_items"][0]["review_status"] == "reviewed"