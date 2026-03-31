"""Registry for pluggable image analysis tools."""

from dataclasses import dataclass
from typing import Awaitable, Callable, Protocol


@dataclass
class AnalysisResult:
    """Standardized result format for all background analyzers."""
    filename: str
    category: str                    # CLIP category
    confidence: float
    analyzer_name: str               # e.g., 'paddle_ocr', 'mcp_xray', 'vlm_fallback'
    evidence_type: str               # e.g., 'lab', 'imaging', 'note'
    evidence_title: str
    ai_analysis_text: str | None = None  # Markdown string (OCR or VLM description)
    structured_data: dict | None = None  # JSON findings (e.g., YOLO bounding boxes)
    is_abnormal: bool = False
    error: str | None = None
    enhanced_file_path: str | None = None # Path to enhanced image if applicable


class AnalyzerFunction(Protocol):
    async def __call__(self, file_path: str, thread_id: str, original_filename: str) -> dict: ...


@dataclass
class AnalyzerSpec:
    name: str
    categories: list[str]
    handler: Callable[[str, str, str], Awaitable[AnalysisResult]]
    min_confidence: float = 0.0
    is_fallback: bool = False
    gpu_bound: bool = False
    priority: int = 0


_registry: list[AnalyzerSpec] = []


def register(spec: AnalyzerSpec) -> None:
    """Register a new analyzer specification."""
    _registry.append(spec)
    _registry.sort(key=lambda s: s.priority, reverse=True)


def get_analyzers_for(category: str, confidence: float) -> list[AnalyzerSpec]:
    """Find matching analyzers based on CLIP category and confidence."""
    matched = [
        s for s in _registry
        if category in s.categories and confidence >= s.min_confidence
    ]
    if not matched:
        return [s for s in _registry if s.is_fallback]
    return matched
