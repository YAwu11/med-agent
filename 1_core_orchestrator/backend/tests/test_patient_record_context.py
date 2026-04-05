from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

from langchain_core.messages import HumanMessage

from deerflow.config.paths import Paths

THREAD_ID = "thread-patient-context"


def _paths(tmp_path: Path) -> Paths:
    return Paths(str(tmp_path))


def _runtime(thread_id: str | None = THREAD_ID) -> MagicMock:
    runtime = MagicMock()
    runtime.context = {"thread_id": thread_id}
    return runtime


def _write_patient_intake(paths: Paths, data: dict) -> None:
    user_dir = paths.sandbox_user_data_dir(THREAD_ID)
    user_dir.mkdir(parents=True, exist_ok=True)
    (user_dir / "patient_intake.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _write_upload(paths: Paths, filename: str, content: bytes = b"img") -> Path:
    uploads_dir = paths.sandbox_uploads_dir(THREAD_ID)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    file_path = uploads_dir / filename
    file_path.write_bytes(content)
    return file_path


def _write_meta(paths: Paths, filename: str, payload: dict) -> None:
    uploads_dir = paths.sandbox_uploads_dir(THREAD_ID)
    (uploads_dir / f"{filename}.meta.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _write_ocr(paths: Paths, filename: str, text: str) -> None:
    uploads_dir = paths.sandbox_uploads_dir(THREAD_ID)
    (uploads_dir / f"{filename}.ocr.md").write_text(text, encoding="utf-8")


def _write_report(paths: Paths, filename: str, *, status: str = "completed") -> None:
    reports_dir = paths.sandbox_user_data_dir(THREAD_ID) / "imaging-reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "report_id": f"report_{filename}",
        "status": status,
        "image_path": f"/mnt/user-data/uploads/{filename}",
        "ai_result": {
            "summary": {"total_findings": 1},
            "findings": [{"label": "轻度浸润影"}],
        },
    }
    (reports_dir / f"{filename}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


class TestPatientRecordSnapshot:
    def test_builds_ready_snapshot_with_processed_uploads(self, tmp_path):
        from deerflow.patient_record_context import build_patient_record_snapshot

        paths = _paths(tmp_path)
        _write_patient_intake(
            paths,
            {
                "name": "张三",
                "age": 35,
                "sex": "男",
                "chief_complaint": "发热咳嗽 3 天",
                "present_illness": "夜间加重",
            },
        )
        _write_upload(paths, "cbc.png")
        _write_meta(paths, "cbc.png", {"image_type": "lab_report", "image_confidence": 0.98})
        _write_ocr(paths, "cbc.png", "# 血常规\n\n- 白细胞升高\n- 中性粒细胞升高")

        _write_upload(paths, "chest-xray.png")
        _write_meta(paths, "chest-xray.png", {"image_type": "medical_imaging", "image_confidence": 0.96})
        _write_report(paths, "chest-xray.png")

        snapshot = build_patient_record_snapshot(THREAD_ID, paths=paths)

        assert snapshot["patient_info"]["name"] == "张三"
        assert snapshot["guidance"]["ready_for_ai_summary"] is True
        assert snapshot["guidance"]["missing_required_fields"] == []
        assert snapshot["guidance"]["pending_files"] == []
        assert len(snapshot["evidence_items"]) == 2
        assert {item["status"] for item in snapshot["evidence_items"]} == {"completed"}
        assert {item["image_type"] for item in snapshot["uploaded_items"]} == {
            "lab_report",
            "medical_imaging",
        }

    def test_marks_snapshot_not_ready_when_required_fields_or_uploads_pending(self, tmp_path):
        from deerflow.patient_record_context import build_patient_record_snapshot

        paths = _paths(tmp_path)
        _write_patient_intake(paths, {"name": "李四", "sex": "女"})
        _write_upload(paths, "brain-mri.nii.gz")
        _write_meta(paths, "brain-mri.nii.gz", {"image_type": "medical_imaging", "image_confidence": 0.91})

        snapshot = build_patient_record_snapshot(THREAD_ID, paths=paths)

        assert snapshot["guidance"]["ready_for_ai_summary"] is False
        assert "年龄" in snapshot["guidance"]["missing_required_fields"]
        assert "主诉" in snapshot["guidance"]["missing_required_fields"]
        assert snapshot["guidance"]["pending_files"] == ["brain-mri.nii.gz"]
        assert snapshot["evidence_items"][0]["status"] == "processing"

    def test_matches_brain_preview_report_back_to_original_nifti_upload(self, tmp_path):
        from deerflow.patient_record_context import build_patient_record_snapshot

        paths = _paths(tmp_path)
        _write_patient_intake(
            paths,
            {
                "name": "李四",
                "age": 52,
                "sex": "女",
                "chief_complaint": "头痛伴呕吐",
            },
        )
        _write_upload(paths, "brain-mri.nii.gz")
        _write_meta(paths, "brain-mri.nii.gz", {"image_type": "brain_nifti", "image_confidence": 0.99})

        reports_dir = paths.sandbox_user_data_dir(THREAD_ID) / "imaging-reports"
        reports_dir.mkdir(parents=True, exist_ok=True)
        (reports_dir / "brain-report.json").write_text(
            json.dumps(
                {
                    "report_id": "brain-report-1",
                    "status": "reviewed",
                    "image_path": "/mnt/user-data/outputs/brain_slice.png",
                    "source_upload_filename": "brain-mri.nii.gz",
                    "ai_result": {
                        "findings": [{"label": "右侧额叶占位"}],
                    },
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        snapshot = build_patient_record_snapshot(THREAD_ID, paths=paths)

        assert snapshot["guidance"]["pending_files"] == []
        assert snapshot["uploaded_items"][0]["status"] == "completed"
        assert snapshot["evidence_items"][0]["status"] == "completed"

    def test_projects_brain_nifti_metadata_for_patient_views(self, tmp_path):
        from deerflow.patient_record_context import build_patient_record_snapshot

        paths = _paths(tmp_path)
        _write_patient_intake(
            paths,
            {
                "name": "周七",
                "age": 47,
                "sex": "女",
                "chief_complaint": "头痛伴视物模糊",
            },
        )
        _write_upload(paths, "brain-mri.nii.gz")
        _write_meta(paths, "brain-mri.nii.gz", {"image_type": "brain_nifti", "image_confidence": 0.99})

        reports_dir = paths.sandbox_user_data_dir(THREAD_ID) / "imaging-reports"
        reports_dir.mkdir(parents=True, exist_ok=True)
        (reports_dir / "brain-report.json").write_text(
            json.dumps(
                {
                    "report_id": "brain-report-2",
                    "status": "reviewed",
                    "image_path": "/mnt/user-data/outputs/brain_slice.png",
                    "source_upload_filename": "brain-mri.nii.gz",
                    "viewer_kind": "brain_spatial_review",
                    "modality": "brain_mri",
                    "pipeline": "brain_nifti_v1",
                    "slice_png_path": "/mnt/user-data/outputs/brain_slice.png",
                    "spatial_info": {
                        "location": "右侧额叶",
                        "clinical_warning": "邻近功能区，建议尽快复核",
                    },
                    "report_text": "右侧额叶可见占位性病灶，建议结合增强扫描与病理进一步评估。",
                    "ai_result": {
                        "findings": [{"label": "右侧额叶占位"}],
                    },
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        snapshot = build_patient_record_snapshot(THREAD_ID, paths=paths)

        evidence = snapshot["evidence_items"][0]
        assert evidence["title"] == "脑 MRI 3D 分析: brain-mri.nii.gz"
        assert evidence["report_id"] == "brain-report-2"
        assert evidence["viewer_kind"] == "brain_spatial_review"
        assert evidence["pipeline"] == "brain_nifti_v1"
        assert evidence["modality"] == "brain_mri"
        assert evidence["review_status"] == "reviewed"
        assert evidence["slice_png_path"] == "/mnt/user-data/outputs/brain_slice.png"
        assert evidence["spatial_info"]["location"] == "右侧额叶"
        assert evidence["findings_count"] == 1
        assert evidence["source_upload_filename"] == "brain-mri.nii.gz"

    def test_formats_compact_patient_record_block(self, tmp_path):
        from deerflow.patient_record_context import (
            build_patient_record_snapshot,
            format_patient_record_block,
        )

        paths = _paths(tmp_path)
        _write_patient_intake(
            paths,
            {
                "name": "王五",
                "age": 41,
                "sex": "男",
                "chief_complaint": "胸闷胸痛",
            },
        )
        _write_upload(paths, "ecg.png")
        _write_meta(paths, "ecg.png", {"image_type": "clinical_photo", "image_confidence": 0.63})

        block = format_patient_record_block(build_patient_record_snapshot(THREAD_ID, paths=paths))

        assert "<patient_record>" in block
        assert "姓名: 王五" in block
        assert "ecg.png" in block
        assert "图片类型: clinical_photo" in block
        assert "综合判断状态" in block
        assert "</patient_record>" in block


class TestPatientRecordMiddleware:
    def test_injects_patient_record_block_and_preserves_additional_kwargs(self, tmp_path):
        from deerflow.agents.middlewares.patient_record_middleware import PatientRecordMiddleware

        paths = _paths(tmp_path)
        _write_patient_intake(
            paths,
            {
                "name": "赵六",
                "age": 28,
                "sex": "女",
                "chief_complaint": "腹痛",
            },
        )
        _write_upload(paths, "lab.png")
        _write_meta(paths, "lab.png", {"image_type": "lab_report", "image_confidence": 0.93})
        _write_ocr(paths, "lab.png", "# 尿常规\n\n- 蛋白阴性")

        middleware = PatientRecordMiddleware(base_dir=str(tmp_path))
        message = HumanMessage(
            content="请继续帮我分析",
            additional_kwargs={"files": [{"filename": "lab.png", "size": 12}]},
        )

        result = middleware.before_agent({"messages": [message]}, _runtime())

        assert result is not None
        updated_message = result["messages"][-1]
        assert "<patient_record>" in updated_message.content
        assert "请继续帮我分析" in updated_message.content
        assert updated_message.additional_kwargs == message.additional_kwargs
        assert result["patient_record_snapshot"]["guidance"]["ready_for_ai_summary"] is True

    def test_returns_none_when_thread_has_no_snapshot_content(self, tmp_path):
        from deerflow.agents.middlewares.patient_record_middleware import PatientRecordMiddleware

        middleware = PatientRecordMiddleware(base_dir=str(tmp_path))
        message = HumanMessage(content="你好")

        assert middleware.before_agent({"messages": [message]}, _runtime()) is None