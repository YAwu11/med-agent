"""Opt-in live smoke test for the local brain MCP service.

Run explicitly from `1_core_orchestrator/backend` after the local `8003` service is up:

    $env:RUN_BRAIN_MCP_LIVE = "1"
    $env:PYTHONPATH = "."
    $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = "1"
    ./.venv/Scripts/python.exe -m pytest tests/test_brain_mcp_live.py -v -s

This test does not require real model weights. It generates a synthetic NIfTI
volume and accepts either full pipeline output or a mock-fallback response as
long as the response shape is valid and the live MCP round-trip succeeds.
"""

import asyncio
import os
from pathlib import Path

import httpx
import numpy as np
import pytest


if os.environ.get("CI"):
    pytest.skip("Brain MCP live smoke is skipped in CI", allow_module_level=True)

if os.environ.get("RUN_BRAIN_MCP_LIVE", "").lower() not in ("1", "true", "yes"):
    pytest.skip("Set RUN_BRAIN_MCP_LIVE=1 to run the live brain MCP smoke test", allow_module_level=True)


nibabel = pytest.importorskip("nibabel")

from app.gateway.services.mcp_brain_client import analyze_brain_tumor_nifti_mcp


def _brain_service_online() -> bool:
    try:
        response = httpx.get("http://localhost:8003/health", timeout=5.0)
    except Exception:
        return False
    return response.status_code == 200 and response.json().get("status") == "ok"


if not _brain_service_online():
    pytest.skip("Brain MCP live smoke requires a running service on localhost:8003", allow_module_level=True)


def _write_synthetic_nifti(path: Path) -> None:
    volume = np.zeros((32, 32, 16), dtype=np.float32)
    volume[10:20, 10:20, 4:12] = 1.0
    image = nibabel.Nifti1Image(volume, np.eye(4))
    nibabel.save(image, path)


def test_brain_mcp_returns_completed_payload_for_synthetic_nifti(tmp_path: Path) -> None:
    nifti_path = tmp_path / "synthetic_t1ce.nii.gz"
    _write_synthetic_nifti(nifti_path)

    result = asyncio.run(analyze_brain_tumor_nifti_mcp(str(nifti_path), nifti_path.name))

    assert result is not None
    assert result["status"] == "completed"
    assert isinstance(result.get("spatial_info"), dict)
    assert isinstance(result.get("is_mock_fallback"), bool)
    assert isinstance(result.get("slice_png_path", ""), str)

    volumes = result["spatial_info"].get("volumes", {})
    assert {"ET", "ED", "NCR", "WT"}.issubset(volumes.keys())

    relations = result["spatial_info"].get("spatial_relations", {})
    assert {"crosses_midline", "midline_shift_mm", "brainstem_min_dist_mm", "ventricle_compression_ratio"}.issubset(relations.keys())