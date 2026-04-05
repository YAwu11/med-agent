import asyncio
import json
from types import SimpleNamespace

from app.core.config.paths import Paths


def _runtime(thread_id: str = "thread-update-patient-info") -> SimpleNamespace:
    return SimpleNamespace(context={"thread_id": thread_id})


def test_update_patient_info_tool_writes_field_meta_and_clears_deleted_fields(
    tmp_path,
    monkeypatch,
):
    from app.core.tools.builtins import update_patient_info as update_patient_info_module

    thread_id = "thread-update-patient-info"
    paths = Paths(base_dir=tmp_path / ".deer-flow")
    monkeypatch.setattr(update_patient_info_module, "get_paths", lambda: paths)

    result = asyncio.run(
        update_patient_info_module.update_patient_info_tool.coroutine(
            runtime=_runtime(thread_id),
            name="张三",
            allergies="青霉素过敏",
        )
    )

    assert json.loads(result)["status"] == "success"

    intake_file = paths.sandbox_user_data_dir(thread_id) / "patient_intake.json"
    payload = json.loads(intake_file.read_text(encoding="utf-8"))
    assert payload["name"] == "张三"
    assert payload["allergies"] == "青霉素过敏"
    assert payload["_field_meta"]["name"]["source"] == "agent"
    assert payload["_field_meta"]["name"]["updated_at"]
    assert payload["_field_meta"]["allergies"]["source"] == "agent"

    asyncio.run(
        update_patient_info_module.update_patient_info_tool.coroutine(
            runtime=_runtime(thread_id),
            allergies="",
        )
    )

    updated_payload = json.loads(intake_file.read_text(encoding="utf-8"))
    assert updated_payload["name"] == "张三"
    assert "allergies" not in updated_payload
    assert "allergies" not in updated_payload["_field_meta"]


def test_update_patient_info_tool_accepts_extended_patient_fields_and_returns_changes(
    tmp_path,
    monkeypatch,
):
    from app.core.tools.builtins import update_patient_info as update_patient_info_module

    thread_id = "thread-update-patient-info"
    paths = Paths(base_dir=tmp_path / ".deer-flow")
    monkeypatch.setattr(update_patient_info_module, "get_paths", lambda: paths)

    initial_result = json.loads(
        asyncio.run(
            update_patient_info_module.update_patient_info_tool.coroutine(
                runtime=_runtime(thread_id),
                phone="13800138000",
                id_number="110101199001010011",
                height_cm=168,
                weight_kg=62,
                spo2=98,
            )
        )
    )

    assert initial_result["status"] == "success"
    assert initial_result["updated_fields"]["phone"] == "13800138000"
    assert {change["field"]: change["action"] for change in initial_result["changes"]} == {
        "phone": "added",
        "id_number": "added",
        "height_cm": "added",
        "weight_kg": "added",
        "spo2": "added",
    }

    follow_up_result = json.loads(
        asyncio.run(
            update_patient_info_module.update_patient_info_tool.coroutine(
                runtime=_runtime(thread_id),
                phone="13900001111",
                id_number="",
            )
        )
    )

    assert {change["field"]: change["action"] for change in follow_up_result["changes"]} == {
        "phone": "updated",
        "id_number": "deleted",
    }

    intake_file = paths.sandbox_user_data_dir(thread_id) / "patient_intake.json"
    payload = json.loads(intake_file.read_text(encoding="utf-8"))
    assert payload["phone"] == "13900001111"
    assert payload["height_cm"] == 168
    assert payload["weight_kg"] == 62
    assert payload["spo2"] == 98
    assert "id_number" not in payload