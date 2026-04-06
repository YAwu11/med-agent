"""Update patient info tool: sandbox-staging version.

[ADR-020] Delayed Registration Architecture:
This tool writes extracted patient demographics to a sandbox staging file
(patient_intake.json) instead of directly to the EMR Case database.
The data is only promoted to a real Case when the patient confirms
scheduling through the frontend confirmation flow.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any

from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT
from pydantic import BaseModel, Field

from app.core.thread_state import ThreadState
from app.core.config.paths import get_paths

logger = logging.getLogger(__name__)


def _is_empty_update_value(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


class UpdatePatientInfoSchema(BaseModel):
    """Schema for updating patient info."""
    name: str | None = Field(None, description="Patient name if provided")
    age: int | None = Field(None, description="Patient age")
    sex: str | None = Field(None, description="Patient sex (male, female, etc)")
    phone: str | None = Field(None, description="Patient phone number")
    id_number: str | None = Field(None, description="Patient ID number")
    chief_complaint: str | None = Field(None, description="Primary reason for visit / chief complaint")
    present_illness: str | None = Field(None, description="History of present illness")
    medical_history: str | None = Field(None, description="Past medical history")
    allergies: str | None = Field(None, description="Known allergies")
    height_cm: float | None = Field(None, description="Height in centimeters")
    weight_kg: float | None = Field(None, description="Weight in kilograms")
    temperature: float | None = Field(None, description="Body temperature in Celsius")
    heart_rate: int | None = Field(None, description="Heart rate (bpm)")
    blood_pressure: str | None = Field(None, description="Blood pressure (e.g., '120/80')")
    spo2: float | None = Field(None, description="Peripheral oxygen saturation percentage")


# 沙箱暂存文件的约定路径常量
PATIENT_INTAKE_FILENAME = "patient_intake.json"


@tool("update_patient_info", args_schema=UpdatePatientInfoSchema, parse_docstring=True)
async def update_patient_info_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    name: str | None = None,
    age: int | None = None,
    sex: str | None = None,
    phone: str | None = None,
    id_number: str | None = None,
    chief_complaint: str | None = None,
    present_illness: str | None = None,
    medical_history: str | None = None,
    allergies: str | None = None,
    height_cm: float | None = None,
    weight_kg: float | None = None,
    temperature: float | None = None,
    heart_rate: int | None = None,
    blood_pressure: str | None = None,
    spo2: float | None = None,
) -> str:
    """Save or update structured patient demographics and vital signs.
    
    Call this tool when you have extracted meaningful clinical information
    (like chief complaint or vitals) from the patient's conversation.
    The data is staged in the sandbox and will be formally registered
    into the EMR system only when the patient confirms the appointment preview.
    """
    thread_id = None
    if runtime and runtime.context:
        thread_id = runtime.context.get("thread_id")
    if not thread_id:
        return json.dumps({"error": "No thread_id available"})

    try:
        # 构建本次更新的字段字典（过滤掉 None 值）
        info_dict = {
            "name": name,
            "age": age,
            "sex": sex,
            "phone": phone,
            "id_number": id_number,
            "chief_complaint": chief_complaint,
            "present_illness": present_illness,
            "medical_history": medical_history,
            "allergies": allergies,
            "height_cm": height_cm,
            "weight_kg": weight_kg,
            "temperature": temperature,
            "heart_rate": heart_rate,
            "blood_pressure": blood_pressure,
            "spo2": spo2,
        }
        info_dict = {k: v for k, v in info_dict.items() if v is not None}
        
        if not info_dict:
            return json.dumps({"status": "no_op", "message": "No specific info provided to update."})

        # 写入沙箱暂存文件（增量合并，不覆盖已有字段）
        paths = get_paths()
        paths.ensure_thread_dirs(thread_id)
        intake_file = paths.sandbox_user_data_dir(thread_id) / PATIENT_INTAKE_FILENAME

        # 读取已有的暂存数据（如果存在）
        existing_data: dict[str, Any] = {}
        if intake_file.exists():
            try:
                existing_data = json.loads(intake_file.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                existing_data = {}

        field_meta = existing_data.get("_field_meta")
        if not isinstance(field_meta, dict):
            field_meta = {}
        now = datetime.now(timezone.utc).isoformat()
        changes: list[dict[str, Any]] = []
        updated_fields: dict[str, Any] = {}

        for key, value in info_dict.items():
            had_existing_value = key in existing_data and not _is_empty_update_value(existing_data.get(key))
            previous_value = existing_data.get(key)
            if _is_empty_update_value(value):
                existing_data.pop(key, None)
                field_meta.pop(key, None)
                if had_existing_value:
                    changes.append({"field": key, "action": "deleted"})
                continue

            existing_data[key] = value
            field_meta[key] = {"source": "agent", "updated_at": now}
            updated_fields[key] = value
            if not had_existing_value:
                changes.append({"field": key, "action": "added"})
            elif previous_value != value:
                changes.append({"field": key, "action": "updated"})

        if field_meta:
            existing_data["_field_meta"] = field_meta
        else:
            existing_data.pop("_field_meta", None)

        # 回写到沙箱
        intake_file.write_text(
            json.dumps(existing_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        logger.info(f"[SANDBOX-INTAKE] Staged patient info for thread {thread_id}: {list(info_dict.keys())}")
        
        return json.dumps({
            "status": "success", 
            "message": "患者信息已暂存，将在挂号确认后正式归档到医生系统。",
            "updated_fields": updated_fields,
            "changes": changes,
        })
    except Exception as e:
        logger.error(f"[SANDBOX-INTAKE] Failed to stage patient info: {e}")
        return json.dumps({"error": str(e)})
