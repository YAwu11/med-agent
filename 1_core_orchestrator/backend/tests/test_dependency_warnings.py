import subprocess
import sys


def test_importing_requests_does_not_emit_dependency_warning():
    result = subprocess.run(
        [
            sys.executable,
            "-W",
            "always",
            "-c",
            "import requests",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert "RequestsDependencyWarning" not in result.stderr, result.stderr


def test_importing_transformers_pipeline_succeeds():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from transformers import pipeline",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr