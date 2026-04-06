import asyncio
import json
import sys
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import BackgroundTasks, FastAPI, UploadFile
from fastapi.testclient import TestClient

from app.gateway.models.case import Case, EvidenceItem, PatientInfo


def _make_app() -> FastAPI:
    from app.gateway.routers import brain_report, imaging_reports

    app = FastAPI()
    app.include_router(brain_report.router)
    app.include_router(imaging_reports.router)
    return app


def test_brain_mri_upload_to_doctor_review_flow(tmp_path: Path):
    from app.gateway.routers import brain_report, imaging_reports, uploads

    thread_id = "thread-1"
    case = Case(
        case_id="case-1",
        patient_thread_id=thread_id,
        patient_info=PatientInfo(name="张三"),
    )
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True)
    reports_dir = tmp_path / thread_id / "imaging-reports"
    provider = MagicMock()
    provider.acquire.return_value = "local"
    provider.get.return_value = MagicMock()
    report_store: dict[str, dict] = {}

    def fake_add_evidence(case_id: str, req):
        assert case_id == case.case_id
        evidence = EvidenceItem(
            evidence_id=str(req.evidence_id),
            type=req.type,
            title=req.title,
            source=req.source,
            file_path=req.file_path,
            structured_data=req.structured_data,
            ai_analysis=req.ai_analysis,
            is_abnormal=req.is_abnormal,
        )
        case.evidence.append(evidence)
        return case

    def fake_update_evidence_data(case_id: str, evidence_id: str, updates: dict):
        assert case_id == case.case_id
        evidence = next(item for item in case.evidence if item.evidence_id == evidence_id)

        if "title" in updates:
            evidence.title = updates["title"]
        if "ai_analysis" in updates:
            evidence.ai_analysis = updates["ai_analysis"]
        if "structured_data" in updates:
            evidence.structured_data = updates["structured_data"]
        if updates.get("is_abnormal") is not None:
            evidence.is_abnormal = bool(updates["is_abnormal"])

        return case

    def fake_sync_report_from_file(current_thread_id: str, file_path: Path):
        assert current_thread_id == thread_id
        data = json.loads(file_path.read_text(encoding="utf-8"))
        report_store[data["report_id"]] = data
        return data

    def fake_update_report(report_id: str, doctor_result: dict, doctor_id: str = "unknown"):
        _ = doctor_id
        existing = report_store.get(report_id, {"report_id": report_id, "ai_result": {}, "doctor_result": {}})
        merged_doctor_result = {}
        if isinstance(existing.get("ai_result"), dict):
            merged_doctor_result.update(existing["ai_result"])
        if isinstance(existing.get("doctor_result"), dict):
            merged_doctor_result.update(existing["doctor_result"])
        merged_doctor_result.update(doctor_result)

        updated = {
            **existing,
            "report_id": report_id,
            "status": "reviewed",
            "doctor_result": merged_doctor_result,
        }
        report_store[report_id] = updated
        return updated

    def fake_update_case_evidence_from_report(current_thread_id: str, report_id: str, doctor_result: dict):
        assert current_thread_id == thread_id
        for evidence in case.evidence:
            structured = evidence.structured_data if isinstance(evidence.structured_data, dict) else {}
            if structured.get("report_id") == report_id:
                evidence.structured_data = {
                    **structured,
                    **doctor_result,
                    "status": "reviewed",
                }
                return True
        return False

    class _FakePaths:
        def sandbox_user_data_dir(self, current_thread_id: str) -> Path:
            assert current_thread_id == thread_id
            return tmp_path / current_thread_id

    fake_brain_pipeline = SimpleNamespace(process_nifti_pipeline_async=lambda *args, **kwargs: None)

    with (
        patch.object(uploads, "get_uploads_dir", return_value=uploads_dir),
        patch.object(uploads, "ensure_uploads_dir", return_value=uploads_dir),
        patch.object(uploads, "get_sandbox_provider", return_value=provider),
        patch.object(uploads, "get_app_config", return_value=type("Cfg", (), {"vision": {"enabled": False}})()),
        patch("app.gateway.services.case_db.get_case_by_thread", return_value=case),
        patch("app.gateway.services.case_db.add_evidence", side_effect=fake_add_evidence),
        patch("app.gateway.services.case_db.update_evidence_data", side_effect=fake_update_evidence_data),
        patch.dict(sys.modules, {"app.gateway.services.brain_nifti_pipeline": fake_brain_pipeline}),
    ):
        upload_result = asyncio.run(
            uploads.upload_files(
                thread_id,
                BackgroundTasks(),
                files=[
                    UploadFile(filename="study_t1.nii.gz", file=BytesIO(b"t1")),
                    UploadFile(filename="study_t1ce.nii.gz", file=BytesIO(b"t1ce")),
                    UploadFile(filename="study_t2.nii.gz", file=BytesIO(b"t2")),
                    UploadFile(filename="study_flair.nii.gz", file=BytesIO(b"flair")),
                ],
            )
        )

    assert upload_result.success is True
    assert len(upload_result.files) == 4
    assert len(case.evidence) == 4

    selected_evidence = next(
        evidence for evidence in case.evidence if str(evidence.file_path).endswith("study_flair.nii.gz")
    )
    selected_structured = selected_evidence.structured_data
    assert isinstance(selected_structured, dict)
    assert selected_structured["pipeline"] == "brain_nifti_v1"
    assert selected_structured["detected_sequences"] == ["t1", "t1ce", "t2", "flair"]
    assert selected_structured["missing_sequences"] == []
    assert selected_structured["ready_for_analysis"] is True

    with (
        patch.object(brain_report, "generate_brain_report", AsyncMock(return_value={"report_text": "最终报告", "cross_check_passed": True})),
        patch.object(brain_report, "get_case", return_value=case),
        patch.object(brain_report, "get_paths", return_value=_FakePaths()),
        patch.object(brain_report, "sync_report_from_file", side_effect=fake_sync_report_from_file),
        patch.object(brain_report, "update_evidence_data", side_effect=fake_update_evidence_data),
        patch.object(brain_report, "update_report", side_effect=fake_update_report),
        patch.object(imaging_reports, "_get_reports_dir", return_value=reports_dir),
        patch.object(imaging_reports, "sync_report_from_file", side_effect=fake_sync_report_from_file),
        patch.object(imaging_reports, "update_report", side_effect=fake_update_report),
        patch("app.gateway.services.case_db.update_case_evidence_from_report", side_effect=fake_update_case_evidence_from_report),
    ):
        with TestClient(_make_app(), raise_server_exceptions=False) as client:
            report_response = client.post(
                f"/api/cases/{case.case_id}/brain-report",
                json={
                    "evidence_id": selected_evidence.evidence_id,
                    "spatial_info": {"location": "右侧额叶", "volumes": {"WT": 12.3}},
                    "slice_png_path": "/mnt/user-data/outputs/brain_slice.png",
                },
            )

            assert report_response.status_code == 200

            review_response = client.put(
                f"/api/threads/{thread_id}/imaging-reports/{selected_evidence.evidence_id}",
                json={
                    "doctor_result": {
                        "doctor_note": "二次复核确认",
                        "quality": "accepted",
                    }
                },
            )

    assert review_response.status_code == 200
    payload = review_response.json()
    assert payload["status"] == "ok"
    assert payload["report_id"] == selected_evidence.evidence_id
    assert payload["data"]["doctor_result"]["report_text"] == "最终报告"
    assert payload["data"]["doctor_result"]["doctor_note"] == "二次复核确认"
    assert payload["data"]["doctor_result"]["quality"] == "accepted"

    report_file = reports_dir / f"{selected_evidence.evidence_id}.json"
    persisted = json.loads(report_file.read_text(encoding="utf-8"))
    assert persisted["status"] == "reviewed"
    assert persisted["doctor_result"]["report_text"] == "最终报告"
    assert persisted["doctor_result"]["doctor_note"] == "二次复核确认"

    updated_evidence = next(item for item in case.evidence if item.evidence_id == selected_evidence.evidence_id)
    updated_structured = updated_evidence.structured_data
    assert isinstance(updated_structured, dict)
    assert updated_structured["report_text"] == "最终报告"
    assert updated_structured["doctor_note"] == "二次复核确认"
    assert updated_structured["status"] == "reviewed"