import asyncio
import json
from types import SimpleNamespace


def _runtime(thread_id: str = "thread-read-patient-record") -> SimpleNamespace:
    return SimpleNamespace(context={"thread_id": thread_id})


def test_schedule_appointment_not_exposed_in_builtin_tools():
    from app.core.tools.tools import BUILTIN_TOOLS as app_tools
    from deerflow.tools.tools import BUILTIN_TOOLS as harness_tools

    names = {tool.name for tool in app_tools} | {tool.name for tool in harness_tools}

    assert "preview_appointment" in names
    assert "schedule_appointment" not in names


def test_read_patient_record_exposed_in_builtin_tools():
    from app.core.tools.tools import BUILTIN_TOOLS as app_tools
    from deerflow.tools.tools import BUILTIN_TOOLS as harness_tools

    names = {tool.name for tool in app_tools} | {tool.name for tool in harness_tools}

    assert "read_patient_record" in names


def test_read_patient_record_tool_returns_snapshot(monkeypatch):
    from app.core.tools.builtins import read_patient_record as read_patient_record_module

    monkeypatch.setattr(
        read_patient_record_module,
        "build_patient_record_snapshot",
        lambda thread_id: {
            "kind": "patient_record_snapshot",
            "revision": 12,
            "thread_id": thread_id,
            "patient_info": {"name": "张三"},
            "uploaded_items": [{"filename": "cbc.png", "status": "completed"}],
            "evidence_items": [{"id": "lab_cbc.png", "type": "lab_report"}],
            "guidance": {"ready_for_ai_summary": True},
        },
    )

    payload = json.loads(
        asyncio.run(
            read_patient_record_module.read_patient_record_tool.coroutine(
                runtime=_runtime(),
                mode="diagnosis",
            )
        )
    )

    assert payload["thread_id"] == "thread-read-patient-record"
    assert payload["type"] == "patient_record_snapshot"
    assert payload["mode"] == "diagnosis"
    assert payload["patient_info"]["name"] == "张三"
    assert payload["uploaded_items"][0]["filename"] == "cbc.png"
    assert payload["guidance"]["ready_for_ai_summary"] is True