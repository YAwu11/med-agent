"""
Doctor Settings REST API — simple JSON-file persistence.

Provides:
  GET  /api/doctor/settings   — Load current settings
  PUT  /api/doctor/settings   — Save settings
  DELETE /api/doctor/settings — Reset to defaults
"""

from __future__ import annotations

import json
from loguru import logger
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel


router = APIRouter(prefix="/api/doctor", tags=["settings"])

_SETTINGS_DIR = Path(__file__).resolve().parents[4] / "data"
_SETTINGS_FILE = _SETTINGS_DIR / "doctor_settings.json"

_DEFAULTS: dict[str, Any] = {
    "ai_model": "qwen-3.5-medical",
    "temperature": 0.3,
    "confidence_threshold": 60,
    "auto_approve_threshold": 85,
    "supervisory_mode_default": True,
    "annotation_template": "standard",
    "annotation_template_text": "",
    "quick_phrases": ["未见明显异常", "建议进一步检查", "需要临床随访"],
    "notification_new_case": True,
    "notification_urgent_popup": True,
    "notification_sound": False,
    "push_frequency": "sse",
    "display_compact": False,
    "display_confidence": True,
    "display_highlight_abnormal": True,
    "display_default_tab": "evidence",
}

def _load() -> dict[str, Any]:
    if _SETTINGS_FILE.exists():
        try:
            return json.loads(_SETTINGS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return dict(_DEFAULTS)

def _save(data: dict[str, Any]):
    _SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    _SETTINGS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )

class SettingsUpdate(BaseModel):
    settings: dict[str, Any]

@router.get("/settings")
async def get_settings():
    return {"settings": _load()}

@router.put("/settings")
async def update_settings(req: SettingsUpdate):
    current = _load()
    current.update(req.settings)
    _save(current)
    logger.info("Doctor settings saved")
    return {"settings": current, "status": "saved"}

@router.delete("/settings")
async def reset_settings():
    _save(dict(_DEFAULTS))
    logger.info("Doctor settings reset to defaults")
    return {"settings": dict(_DEFAULTS), "status": "reset"}
