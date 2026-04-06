from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def _read(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


def test_gateway_start_commands_use_module_invocation() -> None:
    files_to_check = [
        "backend/Makefile",
        "scripts/serve.sh",
        "scripts/start-daemon.sh",
    ]

    for relative_path in files_to_check:
        content = _read(relative_path)
        assert "python -m uvicorn app.gateway.app:app" in content, relative_path
        assert "uv run uvicorn app.gateway.app:app" not in content, relative_path