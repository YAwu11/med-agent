import asyncio
from unittest.mock import patch

from app.gateway.services.analyzer_registry import AnalysisResult, AnalyzerSpec


def test_placeholder_triage_contract_exposes_full_and_patient_views():
    from app.gateway.services.triage_contract import (
        build_placeholder_triage_result,
        to_patient_visible_triage,
    )

    triage = build_placeholder_triage_result(
        category="medical_imaging",
        confidence=0.82,
    )

    payload = triage.model_dump()
    assert payload["triage_level"]
    assert payload["recommended_department"] == "呼吸内科"
    assert payload["urgent_flags"] == []
    assert payload["needs_doctor_review"] is True
    assert payload["confidence"] == 0.82
    assert "医生" in payload["patient_visible_summary"]

    patient_view = to_patient_visible_triage(triage).model_dump()
    assert patient_view == {
        "triage_level": payload["triage_level"],
        "recommended_department": "呼吸内科",
        "needs_doctor_review": True,
        "patient_visible_summary": payload["patient_visible_summary"],
    }


def test_parallel_analyzer_attaches_triage_contract_to_structured_data():
    from app.gateway.services import parallel_analyzer

    async def fake_classify_image(_file_path: str) -> dict:
        return {"category": "medical_imaging", "confidence": 0.88}

    async def fake_handler(_file_path: str, _thread_id: str, original_filename: str) -> AnalysisResult:
        return AnalysisResult(
            filename=original_filename,
            category="",
            confidence=0.0,
            analyzer_name="",
            evidence_type="imaging",
            evidence_title="胸片",
            structured_data={"findings": [{"label": "opacity", "confidence": 0.93}]},
        )

    spec = AnalyzerSpec(
        name="fake_xray",
        categories=["medical_imaging"],
        handler=fake_handler,
    )

    with (
        patch("app.gateway.services.vision_gateway.classify_image", side_effect=fake_classify_image),
        patch.object(parallel_analyzer, "get_analyzers_for", return_value=[spec]),
        patch.object(parallel_analyzer, "apply_circuit_breaker", side_effect=lambda result: result),
    ):
        result = asyncio.run(
            parallel_analyzer.analyze_single_file(
                "C:/tmp/chest.png",
                "thread-1",
                "chest.png",
            )
        )

    assert result.structured_data is not None
    assert result.structured_data["findings"][0]["label"] == "opacity"
    assert result.structured_data["triage"] == {
        "triage_level": "routine",
        "recommended_department": "呼吸内科",
        "urgent_flags": [],
        "needs_doctor_review": True,
        "confidence": 0.88,
        "patient_visible_summary": "系统已接收该资料，详细分诊与解释将由医生进一步确认。",
    }