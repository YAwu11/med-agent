"""Regression tests for the slim patient-intake middleware stack."""

from __future__ import annotations

from deerflow.agents.lead_agent import agent as lead_agent_module
from deerflow.agents.middlewares import tool_error_handling_middleware as middleware_module


def test_build_lead_runtime_middlewares_patient_intake_profile_is_minimal():
    middlewares = middleware_module.build_lead_runtime_middlewares(
        profile="patient_intake",
        lazy_init=True,
    )

    assert [type(m).__name__ for m in middlewares] == [
        "ThreadDataMiddleware",
        "DanglingToolCallMiddleware",
        "ToolErrorHandlingMiddleware",
    ]


def test_build_middlewares_patient_intake_profile_omits_heavy_runtime_layers():
    middlewares = lead_agent_module._build_middlewares(
        {"configurable": {}},
        model_name="patient-model",
        profile="patient_intake",
    )
    middleware_names = [type(m).__name__ for m in middlewares]

    assert middleware_names == [
        "ThreadDataMiddleware",
        "DanglingToolCallMiddleware",
        "ToolErrorHandlingMiddleware",
        "ClarificationMiddleware",
    ]
    assert {
        "UploadsMiddleware",
        "PatientRecordMiddleware",
        "SummarizationMiddleware",
        "TodoMiddleware",
        "TokenUsageMiddleware",
        "TitleMiddleware",
        "ConditionalVisionMiddleware",
        "ReadAndBurnMiddleware",
        "LoopDetectionMiddleware",
    }.isdisjoint(middleware_names)
