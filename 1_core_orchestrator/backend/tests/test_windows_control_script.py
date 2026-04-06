from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
CONTROL_SCRIPT = REPO_ROOT / "项目控制台.bat"


def _read_control_script() -> str:
    return CONTROL_SCRIPT.read_text(encoding="utf-8")


def test_windows_control_script_uses_repo_relative_paths() -> None:
    content = _read_control_script()

    assert 'set "ROOT=%~dp0"' in content
    assert 'E:\\Dev_Workspace' not in content


def test_windows_control_script_uses_repo_local_python_modules() -> None:
    content = _read_control_script()

    assert '"%BACKEND_PYTHON%" -m langgraph_cli dev' in content
    assert '"%BACKEND_PYTHON%" -m uvicorn app.gateway.app:app' in content
    assert "uv run" not in content