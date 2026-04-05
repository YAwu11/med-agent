from __future__ import annotations

import importlib.util
from dataclasses import asdict, dataclass


REQUIRED_LOCAL_LAB_OCR_MODULES = ("paddle", "paddleocr", "paddlex")


@dataclass(frozen=True)
class LocalLabOcrRuntimeStatus:
    available: bool
    mode: str
    required_modules: tuple[str, ...]
    missing_modules: tuple[str, ...]
    summary: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def get_local_lab_ocr_runtime_status() -> LocalLabOcrRuntimeStatus:
    missing_modules = tuple(
        module_name
        for module_name in REQUIRED_LOCAL_LAB_OCR_MODULES
        if importlib.util.find_spec(module_name) is None
    )

    if missing_modules:
        missing_text = ", ".join(missing_modules)
        return LocalLabOcrRuntimeStatus(
            available=False,
            mode="cloud_fallback",
            required_modules=REQUIRED_LOCAL_LAB_OCR_MODULES,
            missing_modules=missing_modules,
            summary=(
                "Local PPStructureV3 OCR unavailable in backend .venv; "
                f"missing modules: {missing_text}. Uploads will fall back to PaddleOCR-VL."
            ),
        )

    return LocalLabOcrRuntimeStatus(
        available=True,
        mode="local_ready",
        required_modules=REQUIRED_LOCAL_LAB_OCR_MODULES,
        missing_modules=(),
        summary="Local PPStructureV3 OCR is available in backend .venv.",
    )