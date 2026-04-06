"""Regression tests for the slimmed patient-intake lead-agent profile."""

from __future__ import annotations

import deerflow.tools as tools_package

from deerflow.agents.lead_agent import agent as lead_agent_module
from deerflow.agents.lead_agent.prompt import apply_prompt_template
from deerflow.config.app_config import AppConfig
from deerflow.config.model_config import ModelConfig
from deerflow.config.sandbox_config import SandboxConfig


def _make_app_config(models: list[ModelConfig] | None = None) -> AppConfig:
    return AppConfig(
        models=models or [_make_model("patient-model", supports_thinking=True)],
        sandbox=SandboxConfig(use="deerflow.sandbox.local:LocalSandboxProvider"),
    )


def _make_model(name: str, *, supports_thinking: bool) -> ModelConfig:
    return ModelConfig(
        name=name,
        display_name=name,
        description=None,
        use="langchain_openai:ChatOpenAI",
        model=name,
        supports_thinking=supports_thinking,
        supports_vision=False,
    )


def test_get_available_tools_patient_intake_profile_exposes_only_intake_tools(monkeypatch):
    import deerflow.tools.tools as tools_module

    monkeypatch.setattr(tools_module, "get_app_config", lambda: _make_app_config())

    tool_names = {
        tool.name
        for tool in tools_module.get_available_tools(
            profile="patient_intake",
            include_mcp=True,
            subagent_enabled=True,
        )
    }

    assert tool_names == {
        "ask_clarification",
        "preview_appointment",
        "read_patient_record",
        "show_medical_record",
        "update_patient_info",
    }
    assert "rag_retrieve" not in tool_names


def test_make_lead_agent_defaults_to_patient_intake_profile_and_disables_thinking(monkeypatch):
    app_config = _make_app_config([_make_model("thinking-model", supports_thinking=True)])

    monkeypatch.setattr(lead_agent_module, "get_app_config", lambda: app_config)

    requested_tools: dict[str, object] = {}

    def _fake_get_available_tools(**kwargs):
        requested_tools.update(kwargs)
        return []

    captured_model: dict[str, object] = {}

    def _fake_create_chat_model(*, name, thinking_enabled, reasoning_effort=None):
        captured_model["name"] = name
        captured_model["thinking_enabled"] = thinking_enabled
        captured_model["reasoning_effort"] = reasoning_effort
        return object()

    monkeypatch.setattr(tools_package, "get_available_tools", _fake_get_available_tools)
    monkeypatch.setattr(lead_agent_module, "create_chat_model", _fake_create_chat_model)
    monkeypatch.setattr(lead_agent_module, "create_agent", lambda **kwargs: kwargs)

    result = lead_agent_module.make_lead_agent(
        {
            "configurable": {
                "model_name": "thinking-model",
                "thinking_enabled": True,
            }
        }
    )

    assert captured_model["name"] == "thinking-model"
    assert captured_model["thinking_enabled"] is False
    assert captured_model["reasoning_effort"] is None
    assert requested_tools["profile"] == "patient_intake"
    assert result["tools"] == []


def test_patient_intake_prompt_removes_rag_and_interpretation_workflow():
    prompt = apply_prompt_template(profile="patient_intake")

    assert "rag_retrieve" not in prompt
    assert "化验单识别与分析" not in prompt
    assert "医疗影像解读" not in prompt
    assert "read_patient_record" in prompt
    assert "preview_appointment" in prompt
