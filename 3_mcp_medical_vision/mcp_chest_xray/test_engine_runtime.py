from pathlib import Path
import sys


SERVICE_DIR = Path(__file__).resolve().parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))


def test_warmup_models_initializes_guard_and_only_warms_once(monkeypatch):
    import engine

    calls: list[str] = []

    monkeypatch.delattr(engine, "_warmed_up", raising=False)
    monkeypatch.setattr(engine, "_get_yolo", lambda: calls.append("yolo"))
    monkeypatch.setattr(engine, "_get_pspnet", lambda: calls.append("pspnet"))
    monkeypatch.setattr(engine, "_get_densenet", lambda: calls.append("densenet"))

    engine.warmup_models()
    engine.warmup_models()

    assert calls == ["yolo", "pspnet", "densenet"]
    assert engine._warmed_up is True