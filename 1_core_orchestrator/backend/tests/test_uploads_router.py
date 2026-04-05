import asyncio
from io import BytesIO
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import BackgroundTasks, UploadFile

from app.gateway.routers import uploads


def test_upload_files_writes_thread_storage_and_skips_local_sandbox_sync(tmp_path):
    thread_uploads_dir = tmp_path / "uploads"
    thread_uploads_dir.mkdir(parents=True)

    provider = MagicMock()
    provider.acquire.return_value = "local"
    sandbox = MagicMock()
    provider.get.return_value = sandbox

    with (
        patch.object(uploads, "get_uploads_dir", return_value=thread_uploads_dir),
        patch.object(uploads, "ensure_uploads_dir", return_value=thread_uploads_dir),
        patch.object(uploads, "get_sandbox_provider", return_value=provider),
        patch.object(uploads, "get_app_config", return_value=type("Cfg", (), {"vision": {"enabled": False}})()),
        patch.object(uploads, "_auto_sync_evidence", AsyncMock(return_value={})),
    ):
        file = UploadFile(filename="notes.txt", file=BytesIO(b"hello uploads"))
        result = asyncio.run(
            uploads.upload_files("thread-local", BackgroundTasks(), files=[file])
        )

    assert result.success is True
    assert len(result.files) == 1
    assert result.files[0]["filename"] == "notes.txt"
    assert (thread_uploads_dir / "notes.txt").read_bytes() == b"hello uploads"

    sandbox.update_file.assert_not_called()


def test_upload_files_syncs_non_local_sandbox_and_marks_markdown_file(tmp_path):
    thread_uploads_dir = tmp_path / "uploads"
    thread_uploads_dir.mkdir(parents=True)

    provider = MagicMock()
    provider.acquire.return_value = "aio-1"
    sandbox = MagicMock()
    provider.get.return_value = sandbox

    async def fake_convert(file_path: Path) -> Path:
        md_path = file_path.with_suffix(".md")
        md_path.write_text("converted", encoding="utf-8")
        return md_path

    with (
        patch.object(uploads, "get_uploads_dir", return_value=thread_uploads_dir),
        patch.object(uploads, "ensure_uploads_dir", return_value=thread_uploads_dir),
        patch.object(uploads, "get_sandbox_provider", return_value=provider),
        patch.object(uploads, "convert_file_to_markdown", AsyncMock(side_effect=fake_convert)),
        patch.object(uploads, "get_app_config", return_value=type("Cfg", (), {"vision": {"enabled": False}})()),
        patch.object(uploads, "_auto_sync_evidence", AsyncMock(return_value={})),
    ):
        file = UploadFile(filename="report.pdf", file=BytesIO(b"pdf-bytes"))
        result = asyncio.run(
            uploads.upload_files("thread-aio", BackgroundTasks(), files=[file])
        )

    assert result.success is True
    assert len(result.files) == 1
    file_info = result.files[0]
    assert file_info["filename"] == "report.pdf"
    assert file_info["markdown_file"] == "report.md"

    assert (thread_uploads_dir / "report.pdf").read_bytes() == b"pdf-bytes"
    assert (thread_uploads_dir / "report.md").read_text(encoding="utf-8") == "converted"

    sandbox.update_file.assert_any_call("/mnt/user-data/uploads/report.pdf", b"pdf-bytes")
    sandbox.update_file.assert_any_call("/mnt/user-data/uploads/report.md", b"converted")


def test_upload_files_rejects_dotdot_and_dot_filenames(tmp_path):
    thread_uploads_dir = tmp_path / "uploads"
    thread_uploads_dir.mkdir(parents=True)

    provider = MagicMock()
    provider.acquire.return_value = "local"
    sandbox = MagicMock()
    provider.get.return_value = sandbox

    with (
        patch.object(uploads, "get_uploads_dir", return_value=thread_uploads_dir),
        patch.object(uploads, "ensure_uploads_dir", return_value=thread_uploads_dir),
        patch.object(uploads, "get_sandbox_provider", return_value=provider),
        patch.object(uploads, "get_app_config", return_value=type("Cfg", (), {"vision": {"enabled": False}})()),
        patch.object(uploads, "_auto_sync_evidence", AsyncMock(return_value={})),
    ):
        # These filenames must be rejected outright
        for bad_name in ["..", "."]:
            file = UploadFile(filename=bad_name, file=BytesIO(b"data"))
            result = asyncio.run(
                uploads.upload_files("thread-local", BackgroundTasks(), files=[file])
            )
            assert result.success is True
            assert result.files == [], f"Expected no files for unsafe filename {bad_name!r}"

        # Path-traversal prefixes are stripped to the basename and accepted safely
        file = UploadFile(filename="../etc/passwd", file=BytesIO(b"data"))
        result = asyncio.run(
            uploads.upload_files("thread-local", BackgroundTasks(), files=[file])
        )
        assert result.success is True
        assert len(result.files) == 1
        assert result.files[0]["filename"] == "passwd"

    # Only the safely normalised file should exist
    assert [f.name for f in thread_uploads_dir.iterdir()] == ["passwd"]


def test_delete_uploaded_file_removes_generated_markdown_companion(tmp_path):
    thread_uploads_dir = tmp_path / "uploads"
    thread_uploads_dir.mkdir(parents=True)
    (thread_uploads_dir / "report.pdf").write_bytes(b"pdf-bytes")
    (thread_uploads_dir / "report.md").write_text("converted", encoding="utf-8")

    with patch.object(uploads, "get_uploads_dir", return_value=thread_uploads_dir):
        result = asyncio.run(uploads.delete_uploaded_file("thread-aio", "report.pdf"))

    assert result == {"success": True, "message": "Deleted report.pdf"}
    assert not (thread_uploads_dir / "report.pdf").exists()
    assert not (thread_uploads_dir / "report.md").exists()


def test_auto_sync_evidence_projects_brain_nifti_contract_fields():
    from app.gateway.models.case import Case, PatientInfo

    case = Case(
        case_id="case-1",
        patient_thread_id="thread-1",
        patient_info=PatientInfo(name="张三"),
    )
    captured_request = {}

    def fake_add_evidence(case_id, req):
        captured_request["case_id"] = case_id
        captured_request["request"] = req
        return case

    with (
        patch("app.gateway.services.case_db.get_case_by_thread", return_value=case),
        patch("app.gateway.services.case_db.add_evidence", side_effect=fake_add_evidence),
    ):
        mapping = asyncio.run(
            uploads._auto_sync_evidence(
                "thread-1",
                [
                    {
                        "filename": "brain-mri.nii.gz",
                        "artifact_url": "/api/threads/thread-1/artifacts/brain-mri.nii.gz",
                    }
                ],
                [],
            )
        )

    req = captured_request["request"]
    assert captured_request["case_id"] == "case-1"
    assert mapping == {"brain-mri.nii.gz": req.evidence_id}
    assert req.structured_data == {
        "pipeline": "brain_nifti_v1",
        "status": "processing",
        "modality": "brain_mri_3d",
        "viewer_kind": "brain_spatial_review",
        "report_id": req.evidence_id,
        "upload_mode": "guided_4_sequence",
        "required_sequences": ["t1", "t1ce", "t2", "flair"],
        "detected_sequences": [],
        "missing_sequences": ["t1", "t1ce", "t2", "flair"],
        "ready_for_analysis": False,
    }


def test_auto_sync_evidence_tracks_brain_mri_sequence_progress():
    from app.gateway.models.case import Case, EvidenceItem, PatientInfo

    case = Case(
        case_id="case-1",
        patient_thread_id="thread-1",
        patient_info=PatientInfo(name="张三"),
        evidence=[
            EvidenceItem(
                evidence_id="ev-1",
                type="imaging",
                title="脑 MRI T1",
                file_path="/api/threads/thread-1/artifacts/patient_t1.nii.gz",
                structured_data={"pipeline": "brain_nifti_v1"},
            )
        ],
    )
    captured_request = {}

    def fake_add_evidence(case_id, req):
        captured_request["case_id"] = case_id
        captured_request["request"] = req
        return case

    with (
        patch("app.gateway.services.case_db.get_case_by_thread", return_value=case),
        patch("app.gateway.services.case_db.add_evidence", side_effect=fake_add_evidence),
    ):
        mapping = asyncio.run(
            uploads._auto_sync_evidence(
                "thread-1",
                [
                    {
                        "filename": "patient_flair.nii.gz",
                        "artifact_url": "/api/threads/thread-1/artifacts/patient_flair.nii.gz",
                    }
                ],
                [],
            )
        )

    req = captured_request["request"]
    assert mapping == {"patient_flair.nii.gz": req.evidence_id}
    assert req.structured_data["required_sequences"] == ["t1", "t1ce", "t2", "flair"]
    assert req.structured_data["detected_sequences"] == ["t1", "flair"]
    assert req.structured_data["missing_sequences"] == ["t1ce", "t2"]
    assert req.structured_data["ready_for_analysis"] is False


def test_auto_sync_evidence_ignores_non_nifti_filenames_that_look_like_brain_sequences():
    from app.gateway.models.case import Case, EvidenceItem, PatientInfo

    case = Case(
        case_id="case-1",
        patient_thread_id="thread-1",
        patient_info=PatientInfo(name="张三"),
        evidence=[
            EvidenceItem(
                evidence_id="ev-1",
                type="imaging",
                title="脑 MRI T1 截图",
                file_path="/api/threads/thread-1/artifacts/patient_t1.png",
                structured_data={"pipeline": "brain_nifti_v1"},
            )
        ],
    )
    captured_request = {}

    def fake_add_evidence(case_id, req):
        captured_request["case_id"] = case_id
        captured_request["request"] = req
        return case

    with (
        patch("app.gateway.services.case_db.get_case_by_thread", return_value=case),
        patch("app.gateway.services.case_db.add_evidence", side_effect=fake_add_evidence),
    ):
        mapping = asyncio.run(
            uploads._auto_sync_evidence(
                "thread-1",
                [
                    {
                        "filename": "patient_flair.nii.gz",
                        "artifact_url": "/api/threads/thread-1/artifacts/patient_flair.nii.gz",
                    }
                ],
                [],
            )
        )

    req = captured_request["request"]
    assert mapping == {"patient_flair.nii.gz": req.evidence_id}
    assert req.structured_data["detected_sequences"] == ["flair"]
    assert req.structured_data["missing_sequences"] == ["t1", "t1ce", "t2"]
    assert req.structured_data["ready_for_analysis"] is False


def test_brain_mri_upload_to_doctor_review_flow_preserves_report_contract(tmp_path):
    import json

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.gateway.models.case import Case, EvidenceItem, PatientInfo
    from app.gateway.routers import brain_report, imaging_reports

    thread_id = "thread-1"
    case_id = "case-1"
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True)
    sandbox_user_data_dir = tmp_path / thread_id
    reports_dir = sandbox_user_data_dir / "imaging-reports"
    reports_dir.mkdir(parents=True)

    case = Case(
        case_id=case_id,
        patient_thread_id=thread_id,
        patient_info=PatientInfo(name="张三"),
        evidence=[],
    )
    reports_by_id: dict[str, dict] = {}

    provider = MagicMock()
    provider.acquire.return_value = "local"
    provider.get.return_value = MagicMock()

    class _UploadPaths:
        def sandbox_uploads_dir(self, thread_id: str) -> Path:
            return Path(f"/mnt/user-data/{thread_id}/uploads")

    class _BrainPaths:
        def sandbox_user_data_dir(self, thread_id: str) -> Path:
            return sandbox_user_data_dir

    def fake_add_evidence(case_id_arg, req):
        case.evidence.append(
            EvidenceItem(
                evidence_id=str(req.evidence_id),
                type=req.type,
                title=req.title,
                source=req.source,
                file_path=req.file_path,
                structured_data=req.structured_data,
                ai_analysis=req.ai_analysis,
                is_abnormal=req.is_abnormal,
            )
        )
        return case

    def fake_update_evidence_data(case_id_arg, evidence_id_arg, payload):
        for evidence in case.evidence:
            if evidence.evidence_id != evidence_id_arg:
                continue
            if "title" in payload and payload["title"] is not None:
                evidence.title = payload["title"]
            if "ai_analysis" in payload:
                evidence.ai_analysis = payload["ai_analysis"]
            if "structured_data" in payload:
                evidence.structured_data = payload["structured_data"]
            if "is_abnormal" in payload and payload["is_abnormal"] is not None:
                evidence.is_abnormal = bool(payload["is_abnormal"])
            return case
        raise AssertionError(f"Evidence not found: {evidence_id_arg}")

    def fake_sync_report_from_file(thread_id_arg, report_file):
        data = json.loads(Path(report_file).read_text(encoding="utf-8"))
        reports_by_id[data["report_id"]] = data
        return data

    def fake_update_report(report_id_arg, doctor_result):
        existing = reports_by_id.get(
            report_id_arg,
            {
                "report_id": report_id_arg,
                "ai_result": {},
                "doctor_result": {},
                "status": "pending_review",
            },
        )
        merged_doctor_result = {}
        if isinstance(existing.get("ai_result"), dict):
            merged_doctor_result.update(existing["ai_result"])
        if isinstance(existing.get("doctor_result"), dict):
            merged_doctor_result.update(existing["doctor_result"])
        if isinstance(doctor_result, dict):
            merged_doctor_result.update(doctor_result)
        updated = {
            **existing,
            "status": "reviewed",
            "doctor_result": merged_doctor_result,
        }
        reports_by_id[report_id_arg] = updated
        return updated

    def fake_update_case_evidence_from_report(thread_id_arg, report_id_arg, doctor_result):
        for evidence in case.evidence:
            structured = evidence.structured_data if isinstance(evidence.structured_data, dict) else {}
            if str(structured.get("report_id")) != report_id_arg:
                continue
            evidence.structured_data = {
                **structured,
                **doctor_result,
                "report_id": report_id_arg,
                "status": "reviewed",
            }
            return True
        return False

    app = FastAPI()
    app.include_router(uploads.router)
    app.include_router(brain_report.router)
    app.include_router(imaging_reports.router)

    with (
        patch.object(uploads, "get_uploads_dir", return_value=uploads_dir),
        patch.object(uploads, "ensure_uploads_dir", return_value=uploads_dir),
        patch.object(uploads, "get_paths", return_value=_UploadPaths()),
        patch.object(uploads, "get_sandbox_provider", return_value=provider),
        patch.object(uploads, "get_app_config", return_value=type("Cfg", (), {"vision": {"enabled": False}})()),
        patch("app.gateway.services.case_db.get_case_by_thread", return_value=case),
        patch("app.gateway.services.case_db.add_evidence", side_effect=fake_add_evidence),
        patch("app.gateway.services.task_store.create_task"),
        patch("app.gateway.services.brain_nifti_pipeline.process_nifti_pipeline_async", AsyncMock(return_value=None)),
        patch.object(brain_report, "get_case", return_value=case),
        patch.object(brain_report, "get_paths", return_value=_BrainPaths()),
        patch.object(brain_report, "generate_brain_report", AsyncMock(return_value={"report_text": "AI 脑 MRI 报告", "cross_check_passed": True})),
        patch.object(brain_report, "sync_report_from_file", side_effect=fake_sync_report_from_file),
        patch.object(brain_report, "update_evidence_data", side_effect=fake_update_evidence_data),
        patch.object(brain_report, "update_report", side_effect=fake_update_report),
        patch.object(imaging_reports, "_get_reports_dir", return_value=reports_dir),
        patch.object(imaging_reports, "sync_report_from_file", side_effect=fake_sync_report_from_file),
        patch.object(imaging_reports, "update_report", side_effect=fake_update_report),
        patch("app.gateway.services.case_db.update_case_evidence_from_report", side_effect=fake_update_case_evidence_from_report),
    ):
        with TestClient(app, raise_server_exceptions=False) as client:
            upload_response = client.post(
                f"/api/threads/{thread_id}/uploads",
                files=[
                    ("files", ("patient_t1.nii.gz", b"t1-data", "application/octet-stream")),
                    ("files", ("patient_t1ce.nii.gz", b"t1ce-data", "application/octet-stream")),
                    ("files", ("patient_t2.nii.gz", b"t2-data", "application/octet-stream")),
                    ("files", ("patient_flair.nii.gz", b"flair-data", "application/octet-stream")),
                ],
            )

            assert upload_response.status_code == 200
            upload_payload = upload_response.json()
            assert upload_payload["success"] is True
            assert len(case.evidence) == 4
            for evidence in case.evidence:
                structured = evidence.structured_data if isinstance(evidence.structured_data, dict) else {}
                assert structured["pipeline"] == "brain_nifti_v1"
                assert structured["viewer_kind"] == "brain_spatial_review"
                assert structured["ready_for_analysis"] is True
                assert structured["detected_sequences"] == ["t1", "t1ce", "t2", "flair"]
                assert structured["missing_sequences"] == []

            target_evidence = case.evidence[0]
            target_report_id = str(target_evidence.structured_data["report_id"])

            brain_report_response = client.post(
                f"/api/cases/{case_id}/brain-report",
                json={
                    "evidence_id": target_evidence.evidence_id,
                    "spatial_info": {"location": "右侧额叶", "volumes": {"WT": 12.3}},
                    "slice_png_path": "/mnt/user-data/outputs/brain_slice.png",
                },
            )

            assert brain_report_response.status_code == 200
            report_file = reports_dir / f"{target_report_id}.json"
            assert report_file.exists()

            review_response = client.put(
                f"/api/threads/{thread_id}/imaging-reports/{target_report_id}",
                json={
                    "doctor_result": {
                        "report_text": "医生确认后的脑 MRI 报告",
                        "spatial_info": {"location": "右侧额叶", "volumes": {"WT": 12.3}},
                        "slice_png_path": "/mnt/user-data/outputs/brain_slice.png",
                    }
                },
            )

    assert review_response.status_code == 200
    review_payload = review_response.json()
    assert review_payload["status"] == "ok"

    persisted_report = json.loads(report_file.read_text(encoding="utf-8"))
    assert persisted_report["status"] == "reviewed"
    assert persisted_report["doctor_result"]["report_text"] == "医生确认后的脑 MRI 报告"
    assert persisted_report["doctor_result"]["cross_check_passed"] is True
    assert persisted_report["doctor_result"]["slice_png_path"] == "/mnt/user-data/outputs/brain_slice.png"

    structured = target_evidence.structured_data if isinstance(target_evidence.structured_data, dict) else {}
    assert structured["report_id"] == target_report_id
    assert structured["status"] == "reviewed"
    assert structured["report_text"] == "医生确认后的脑 MRI 报告"
    assert structured["cross_check_passed"] is True
