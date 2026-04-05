import importlib.util

from app.gateway.services.local_lab_ocr_runtime import get_local_lab_ocr_runtime_status


def test_local_lab_ocr_runtime_reports_missing_modules(monkeypatch):
    def _fake_find_spec(name: str):
        return None

    monkeypatch.setattr(importlib.util, "find_spec", _fake_find_spec)

    status = get_local_lab_ocr_runtime_status()

    assert status.available is False
    assert status.mode == "cloud_fallback"
    assert status.missing_modules == ("paddle", "paddleocr", "paddlex")


def test_local_lab_ocr_runtime_reports_available_when_all_modules_exist(monkeypatch):
    def _fake_find_spec(name: str):
        return object()

    monkeypatch.setattr(importlib.util, "find_spec", _fake_find_spec)

    status = get_local_lab_ocr_runtime_status()

    assert status.available is True
    assert status.mode == "local_ready"
    assert status.missing_modules == ()