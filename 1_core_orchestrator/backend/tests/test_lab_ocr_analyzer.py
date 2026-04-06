import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.gateway.services.analyzers import lab_ocr


def test_lab_ocr_analyzer_falls_back_to_remote_when_local_ocr_returns_empty(tmp_path):
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True)
    image_path = uploads_dir / "lab.png"
    image_path.write_bytes(b"fake-image-bytes")

    remote_markdown = "# 血常规\n\n| 序号 | 项目名称 | 结果 | 异常 | 单位 | 参考范围 |\n| --- | --- | --- | --- | --- | --- |"
    remote_numbers = ["5.2", "11.8"]

    with (
        patch.object(lab_ocr, "fetch_medical_report_ocr", AsyncMock(return_value=("", []))),
        patch.object(
            lab_ocr,
            "fetch_medical_report_ocr_remote",
            AsyncMock(return_value=(remote_markdown, remote_numbers)),
            create=True,
        ) as remote_fetch,
        patch.object(
            lab_ocr,
            "get_paths",
            return_value=type(
                "Paths",
                (),
                {"sandbox_outputs_dir": lambda self, _: tmp_path / "outputs"},
            )(),
        ),
    ):
        result = asyncio.run(
            lab_ocr.LabOCRAnalyzer().analyze(str(image_path), "thread-1", "lab.png")
        )

    assert remote_fetch.await_count == 1
    assert result.ai_analysis_text == remote_markdown
    assert result.structured_data == {"ocr_raw_numbers": remote_numbers}
    assert (uploads_dir / "lab.png.ocr.md").read_text(encoding="utf-8") == remote_markdown


def test_lab_ocr_analyzer_prefers_local_ocr_when_available(tmp_path):
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True)
    image_path = uploads_dir / "lab.png"
    image_path.write_bytes(b"fake-image-bytes")

    local_markdown = "# 电解质\n\n| 序号 | 项目名称 | 结果 | 异常 | 单位 | 参考范围 |\n| --- | --- | --- | --- | --- | --- |"
    local_numbers = ["138", "4.1"]

    with (
        patch.object(lab_ocr, "fetch_medical_report_ocr", AsyncMock(return_value=(local_markdown, local_numbers))),
        patch.object(
            lab_ocr,
            "fetch_medical_report_ocr_remote",
            AsyncMock(return_value=("# 不应命中", ["0"])),
            create=True,
        ) as remote_fetch,
        patch.object(
            lab_ocr,
            "get_paths",
            return_value=type(
                "Paths",
                (),
                {"sandbox_outputs_dir": lambda self, _: tmp_path / "outputs"},
            )(),
        ),
    ):
        result = asyncio.run(
            lab_ocr.LabOCRAnalyzer().analyze(str(image_path), "thread-1", "lab.png")
        )

    assert remote_fetch.await_count == 0
    assert result.ai_analysis_text == local_markdown
    assert result.structured_data == {"ocr_raw_numbers": local_numbers}