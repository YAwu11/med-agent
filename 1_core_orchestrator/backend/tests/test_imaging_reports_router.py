import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.models.case import Case, EvidenceItem, PatientInfo


def _make_app() -> FastAPI:
    from app.gateway.routers import imaging_reports

    app = FastAPI()
    app.include_router(imaging_reports.router)
    return app


def _make_case(thread_id: str, image_path: str) -> Case:
    return Case(
        case_id="case-1",
        patient_thread_id=thread_id,
        patient_info=PatientInfo(name="张三"),
        evidence=[
            EvidenceItem(
                evidence_id="ev-1",
                type="imaging",
                title="胸部X光片",
                file_path=image_path,
            )
        ],
    )


def test_stateless_analyze_cv_defaults_to_existing_case_image(tmp_path: Path):
    from app.gateway.routers import imaging_reports

    thread_id = "thread-1"
    reports_dir = tmp_path / "imaging-reports"
    reports_dir.mkdir(parents=True)
    image_path = tmp_path / "existing.png"
    image_path.write_bytes(b"not-a-real-png")

    case = _make_case(thread_id, str(image_path))
    ai_result = {
        "findings": [{"bbox": [0, 0, 10, 20], "disease": "肺炎", "confidence": 0.8}],
        "summary": {"disease_probabilities": {"pneumonia": 0.91}},
    }
    mocked_image = MagicMock()
    mocked_image.__enter__.return_value.size = (100, 200)
    mocked_image.__exit__.return_value = False

    with (
        patch.object(imaging_reports, "_get_reports_dir", return_value=reports_dir),
        patch.object(imaging_reports, "get_case_by_thread", return_value=case),
        patch.object(imaging_reports, "update_evidence_data") as update_evidence_data,
        patch("app.gateway.services.mcp_vision_client.analyze_xray", AsyncMock(return_value=ai_result)),
        patch("PIL.Image.open", return_value=mocked_image),
    ):
        with TestClient(_make_app(), raise_server_exceptions=False) as client:
            response = client.post(f"/api/threads/{thread_id}/imaging-reports/analyze-cv", json={})

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["data"]["image_path"] == str(image_path)
    assert payload["data"]["ai_result"]["findings"][0]["id"]
    assert payload["data"]["ai_result"]["findings"][0]["bbox"] == {
        "x": 0.0,
        "y": 0.0,
        "width": 10.0,
        "height": 10.0,
    }
    update_evidence_data.assert_called_once()


def test_stateless_analyze_cv_preserves_summary_probs_and_rejected_contract(tmp_path: Path):
    from app.gateway.routers import imaging_reports

    thread_id = "thread-1"
    reports_dir = tmp_path / "imaging-reports"
    reports_dir.mkdir(parents=True)
    image_path = tmp_path / "existing.png"
    image_path.write_bytes(b"not-a-real-png")

    case = _make_case(thread_id, str(image_path))
    ai_result = {
        "findings": [{"bbox": [10, 20, 30, 60], "disease": "肺炎", "confidence": 0.82}],
        "summary": {
            "total_findings": 1,
            "disease_breakdown": {"肺炎": 1},
        },
        "densenet_probs": {"Pneumonia": 0.91, "Effusion": 0.34},
        "rejected": [{"disease": "结节", "reason": "Outside lung"}],
        "pipeline": "Pipeline V3 (MCP Service)",
        "disclaimer": "For research use only.",
    }
    mocked_image = MagicMock()
    mocked_image.__enter__.return_value.size = (100, 200)
    mocked_image.__exit__.return_value = False

    with (
        patch.object(imaging_reports, "_get_reports_dir", return_value=reports_dir),
        patch.object(imaging_reports, "get_case_by_thread", return_value=case),
        patch.object(imaging_reports, "update_evidence_data") as update_evidence_data,
        patch("app.gateway.services.mcp_vision_client.analyze_xray", AsyncMock(return_value=ai_result)),
        patch("PIL.Image.open", return_value=mocked_image),
    ):
        with TestClient(_make_app(), raise_server_exceptions=False) as client:
            response = client.post(f"/api/threads/{thread_id}/imaging-reports/analyze-cv", json={})

    assert response.status_code == 200
    payload = response.json()
    ai_payload = payload["data"]["ai_result"]

    assert ai_payload["summary"] == {
        "total_findings": 1,
        "disease_breakdown": {"肺炎": 1},
    }
    assert ai_payload["densenet_probs"] == {"Pneumonia": 0.91, "Effusion": 0.34}
    assert ai_payload["rejected"] == [{"disease": "结节", "reason": "Outside lung"}]
    assert ai_payload["pipeline"] == "Pipeline V3 (MCP Service)"
    assert ai_payload["disclaimer"] == "For research use only."

    update_evidence_data.assert_called_once()
    synced_payload = update_evidence_data.call_args.args[2]["structured_data"]["ai_result"]
    assert synced_payload["summary"] == ai_payload["summary"]
    assert synced_payload["densenet_probs"] == ai_payload["densenet_probs"]
    assert synced_payload["rejected"] == ai_payload["rejected"]


def test_update_case_evidence_from_report_matches_structured_report_id():
    from app.gateway.services import case_db

    case = Case(
        case_id="case-1",
        patient_thread_id="thread-1",
        patient_info=PatientInfo(name="张三"),
        evidence=[
            EvidenceItem(
                evidence_id="ev-1",
                type="imaging",
                title="胸部X光片",
                structured_data={"report_id": "report-1", "status": "pending_review"},
            )
        ],
    )
    fake_conn = MagicMock()

    with (
        patch.object(case_db, "get_case_by_thread", return_value=case),
        patch.object(case_db, "_get_conn", return_value=fake_conn),
    ):
        updated = case_db.update_case_evidence_from_report(
            "thread-1",
            "report-1",
            {"status": "reviewed", "doctor_note": "已确认"},
        )

    assert updated is True
    assert case.evidence[0].structured_data == {
        "report_id": "report-1",
        "status": "reviewed",
        "doctor_note": "已确认",
    }
    fake_conn.execute.assert_called_once()
    fake_conn.commit.assert_called_once()


def test_update_report_merges_existing_ai_result_when_doctor_payload_is_partial():
    from app.gateway.services import case_db

    existing_report = {
        "report_id": "report-1",
        "ai_result": {
            "findings": [{"id": "finding-1", "name": "肺炎"}],
            "summary": {"total_findings": 1},
            "densenet_probs": {"Pneumonia": 0.91},
            "rejected": [{"disease": "结节"}],
        },
        "doctor_result": None,
    }
    updated_report = {
        **existing_report,
        "status": "reviewed",
        "doctor_result": {
            "findings": [{"id": "finding-1", "name": "肺炎", "note": "医生已复核"}],
            "summary": {"total_findings": 1},
            "densenet_probs": {"Pneumonia": 0.91},
            "rejected": [{"disease": "结节"}],
        },
    }
    fake_conn = MagicMock()

    with (
        patch.object(case_db, "get_report_by_id", side_effect=[existing_report, updated_report]),
        patch.object(case_db, "_get_conn", return_value=fake_conn),
    ):
        result = case_db.update_report(
            "report-1",
            {"findings": [{"id": "finding-1", "name": "肺炎", "note": "医生已复核"}]},
        )

    assert result == updated_report
    update_sql, update_args = fake_conn.execute.call_args_list[0].args
    assert "UPDATE reports SET doctor_result" in update_sql
    stored_payload = json.loads(update_args[0])
    assert stored_payload["findings"] == [{"id": "finding-1", "name": "肺炎", "note": "医生已复核"}]
    assert stored_payload["summary"] == {"total_findings": 1}
    assert stored_payload["densenet_probs"] == {"Pneumonia": 0.91}
    assert stored_payload["rejected"] == [{"disease": "结节"}]


def test_submit_doctor_review_persists_merged_result_to_case_and_sandbox_file(tmp_path: Path):
    from app.gateway.routers import imaging_reports

    thread_id = "thread-1"
    report_id = "report-1"
    reports_dir = tmp_path / "imaging-reports"
    reports_dir.mkdir(parents=True)
    report_file = reports_dir / f"{report_id}.json"
    report_file.write_text(
        json.dumps(
            {
                "report_id": report_id,
                "thread_id": thread_id,
                "status": "pending_review",
                "version": 1,
                "image_path": "/api/threads/thread-1/artifacts/chest.png",
                "ai_result": {
                    "findings": [{"id": "finding-1", "name": "肺炎"}],
                    "summary": {"total_findings": 1},
                    "densenet_probs": {"Pneumonia": 0.91},
                    "rejected": [{"disease": "结节"}],
                },
                "doctor_result": {},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    merged_report = {
        "report_id": report_id,
        "status": "reviewed",
        "doctor_result": {
            "findings": [{"id": "finding-1", "name": "肺炎", "note": "医生复核"}],
            "summary": {"total_findings": 1},
            "densenet_probs": {"Pneumonia": 0.91},
            "rejected": [{"disease": "结节"}],
        },
    }

    with (
        patch.object(imaging_reports, "_get_reports_dir", return_value=reports_dir),
        patch.object(imaging_reports, "sync_report_from_file"),
        patch.object(imaging_reports, "update_report", return_value=merged_report),
        patch("app.gateway.services.case_db.update_case_evidence_from_report") as update_case_evidence_from_report,
    ):
        with TestClient(_make_app(), raise_server_exceptions=False) as client:
            response = client.put(
                f"/api/threads/{thread_id}/imaging-reports/{report_id}",
                json={
                    "doctor_result": {
                        "findings": [{"id": "finding-1", "name": "肺炎", "note": "医生复核"}]
                    }
                },
            )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    update_case_evidence_from_report.assert_called_once_with(
        thread_id,
        report_id,
        merged_report["doctor_result"],
    )

    persisted = json.loads(report_file.read_text(encoding="utf-8"))
    assert persisted["status"] == "reviewed"
    assert persisted["version"] == 2
    assert persisted["doctor_result"] == merged_report["doctor_result"]


def test_generate_brain_report_persists_nested_structured_data_and_updates_linked_report(tmp_path: Path):
    from app.gateway.routers import brain_report

    case = Case(
        case_id="case-1",
        patient_thread_id="thread-1",
        patient_info=PatientInfo(name="张三"),
        evidence=[
            EvidenceItem(
                evidence_id="ev-brain",
                type="imaging",
                title="脑部核磁共振 (MRI NIfTI)",
                structured_data={
                    "pipeline": "brain_nifti_v1",
                    "report_id": "brain-report-1",
                    "status": "pending_review",
                    "slice_png_path": "/mnt/user-data/outputs/brain_slice.png",
                },
            )
        ],
    )

    request = brain_report.BrainReportRequest(
        evidence_id="ev-brain",
        spatial_info={"location": "右侧额叶", "volumes": {"WT": 12.3}},
        slice_png_path="/mnt/user-data/outputs/brain_slice.png",
    )

    class _FakePaths:
        def sandbox_user_data_dir(self, thread_id: str) -> Path:
            return tmp_path / thread_id

    with (
        patch.object(
            brain_report,
            "generate_brain_report",
            AsyncMock(return_value={"report_text": "最终报告", "cross_check_passed": True}),
        ),
        patch.object(brain_report, "get_case", return_value=case, create=True),
        patch.object(brain_report, "get_paths", return_value=_FakePaths()),
        patch.object(brain_report, "sync_report_from_file"),
        patch.object(brain_report, "update_evidence_data") as update_evidence_data,
        patch.object(brain_report, "update_report", create=True) as update_report,
    ):
        response = asyncio.run(brain_report.generate_brain_report_endpoint("case-1", request))

    assert response["status"] == "ok"
    update_evidence_data.assert_called_once_with(
        "case-1",
        "ev-brain",
        {
            "ai_analysis": "最终报告",
            "structured_data": {
                "pipeline": "brain_nifti_v1",
                "report_id": "brain-report-1",
                "status": "reviewed",
                "slice_png_path": "/mnt/user-data/outputs/brain_slice.png",
                "modality": "brain_mri_3d",
                "viewer_kind": "brain_spatial_review",
                "spatial_info": {"location": "右侧额叶", "volumes": {"WT": 12.3}},
                "cross_check_passed": True,
                "report_text": "最终报告",
            },
        },
    )
    update_report.assert_called_once_with(
        "brain-report-1",
        {
            "status": "reviewed",
            "report_text": "最终报告",
            "cross_check_passed": True,
            "spatial_info": {"location": "右侧额叶", "volumes": {"WT": 12.3}},
            "slice_png_path": "/mnt/user-data/outputs/brain_slice.png",
        },
    )