from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.models.case import Case, EvidenceItem, PatientInfo
from app.gateway.routers import cases


def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(cases.router)
    return app


def _make_case() -> Case:
    return Case(
        case_id="case-1",
        patient_thread_id="thread-1",
        patient_info=PatientInfo(
            name="张三",
            age=42,
            sex="男",
            chief_complaint="发热伴咳嗽 3 天",
            present_illness="近 3 天发热，夜间咳嗽加重。",
        ),
        evidence=[
            EvidenceItem(
                type="lab",
                title="血常规",
                ai_analysis="CRP 升高，提示炎症活动。",
                is_abnormal=True,
            )
        ],
    )


def test_diagnosis_route_is_registered_once():
    diagnosis_routes = [
        route
        for route in cases.router.routes
        if getattr(route, "path", None) == "/api/cases/{case_id}/diagnosis"
        and "PUT" in getattr(route, "methods", set())
    ]

    assert len(diagnosis_routes) == 1


def test_get_case_summary_readiness_returns_guidance_projection():
    case = _make_case()
    snapshot = {
        "guidance": {
            "ready_for_ai_summary": False,
            "stage": "processing_uploads",
            "status_text": "仍有资料正在解析。",
            "next_action": "请等待上传文件解析完成。",
            "blocking_reasons": ["uploads_pending"],
            "missing_required_fields": ["chief_complaint"],
            "pending_files": ["cbc.png"],
            "failed_files": [],
        }
    }

    with (
        patch("app.gateway.routers.cases.case_db.get_case", return_value=case),
        patch("app.gateway.routers.cases.build_patient_record_snapshot", return_value=snapshot),
    ):
        with TestClient(_make_app()) as client:
            response = client.get("/api/cases/case-1/summary-readiness")

    assert response.status_code == 200
    assert response.json() == {
        "case_id": "case-1",
        "ready_for_synthesis": False,
        "stage": "processing_uploads",
        "status_text": "仍有资料正在解析。",
        "next_action": "请等待上传文件解析完成。",
        "blocking_reasons": ["uploads_pending"],
        "missing_required_fields": ["chief_complaint"],
        "pending_files": ["cbc.png"],
        "failed_files": [],
    }


def test_get_case_summary_returns_409_until_readiness_is_ready():
    case = _make_case()
    snapshot = {
        "guidance": {
            "ready_for_ai_summary": False,
            "stage": "processing_uploads",
            "status_text": "仍有资料正在解析。",
            "next_action": "请等待上传文件解析完成。",
            "blocking_reasons": ["uploads_pending"],
            "missing_required_fields": [],
            "pending_files": ["cbc.png"],
            "failed_files": [],
        }
    }

    with (
        patch("app.gateway.routers.cases.case_db.get_case", return_value=case),
        patch("app.gateway.routers.cases.build_patient_record_snapshot", return_value=snapshot),
    ):
        with TestClient(_make_app()) as client:
            response = client.get("/api/cases/case-1/summary")

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["message"] == "仍有资料正在解析。"
    assert detail["ready_for_synthesis"] is False
    assert detail["pending_files"] == ["cbc.png"]


def test_get_case_summary_returns_summary_and_readiness_when_ready():
    case = _make_case()
    snapshot = {
        "guidance": {
            "ready_for_ai_summary": True,
            "stage": "ready",
            "status_text": "病例资料已齐。",
            "next_action": "可以开始综合诊断。",
            "blocking_reasons": [],
            "missing_required_fields": [],
            "pending_files": [],
            "failed_files": [],
        }
    }

    with (
        patch("app.gateway.routers.cases.case_db.get_case", return_value=case),
        patch("app.gateway.routers.cases.build_patient_record_snapshot", return_value=snapshot),
    ):
        with TestClient(_make_app()) as client:
            response = client.get("/api/cases/case-1/summary")

    assert response.status_code == 200
    payload = response.json()
    assert payload["case_id"] == "case-1"
    assert payload["summary_readiness"]["ready_for_synthesis"] is True
    assert "## 主诉" in payload["summary"]
    assert "### 1. [LAB] 血常规 ⚠️ 异常" in payload["summary"]
    assert "CRP 升高，提示炎症活动。" in payload["summary"]


def test_get_case_summary_formats_brain_mri_evidence_with_brain_specific_text():
    case = _make_case()
    case.evidence = [
        EvidenceItem(
            evidence_id="brain-report-2",
            type="imaging",
            title="脑部核磁共振 (MRI NIfTI)",
            ai_analysis="右侧额叶可见占位性病灶。",
            is_abnormal=True,
            structured_data={
                "pipeline": "brain_nifti_v1",
                "viewer_kind": "brain_spatial_review",
                "modality": "brain_mri",
                "status": "reviewed",
                "spatial_info": {"location": "右侧额叶"},
                "report_text": "建议结合增强扫描与病理进一步评估。",
                "findings": [{"label": "右侧额叶占位"}],
            },
        )
    ]
    snapshot = {
        "guidance": {
            "ready_for_ai_summary": True,
            "stage": "ready",
            "status_text": "病例资料已齐。",
            "next_action": "可以开始综合诊断。",
            "blocking_reasons": [],
            "missing_required_fields": [],
            "pending_files": [],
            "failed_files": [],
        }
    }

    with (
        patch("app.gateway.routers.cases.case_db.get_case", return_value=case),
        patch("app.gateway.routers.cases.build_patient_record_snapshot", return_value=snapshot),
    ):
        with TestClient(_make_app()) as client:
            response = client.get("/api/cases/case-1/summary")

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert "脑 MRI 3D 分析" in summary
    assert "医生审核状态: 已复核" in summary
    assert "关键定位: 右侧额叶" in summary
    assert "建议结合增强扫描与病理进一步评估。" in summary
