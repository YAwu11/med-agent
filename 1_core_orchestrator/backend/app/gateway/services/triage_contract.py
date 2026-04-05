"""Structured visual triage contract placeholder.

This module defines the stable shape for future visual triage output without
binding the current pipeline to a real triage model implementation.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


TriageLevel = Literal["routine", "priority", "urgent", "critical"]


class VisualTriageResult(BaseModel):
    """Full triage payload retained for backend and doctor-side consumers."""

    triage_level: TriageLevel
    recommended_department: str | None = None
    urgent_flags: list[str] = Field(default_factory=list)
    needs_doctor_review: bool = True
    confidence: float
    patient_visible_summary: str


class PatientVisibleTriageResult(BaseModel):
    """Projection that is safe to expose on the patient side."""

    triage_level: TriageLevel
    recommended_department: str | None = None
    needs_doctor_review: bool
    patient_visible_summary: str


_CATEGORY_DEPARTMENT_MAP = {
    "medical_imaging": "呼吸内科",
    "brain_mri": "神经内科",
    "lab_report": "检验科",
    "clinical_photo": "皮肤科",
}


def _normalize_confidence(confidence: float) -> float:
    bounded = min(max(float(confidence), 0.0), 1.0)
    return round(bounded, 2)


def _derive_urgent_flags(structured_data: dict[str, Any] | None) -> list[str]:
    if not isinstance(structured_data, dict):
        return []

    flags = structured_data.get("urgent_flags")
    if not isinstance(flags, list):
        return []

    return [str(flag).strip() for flag in flags if str(flag).strip()]


def build_placeholder_triage_result(
    *,
    category: str,
    confidence: float,
    structured_data: dict[str, Any] | None = None,
) -> VisualTriageResult:
    """Build a stable placeholder contract until a real triage model exists."""

    urgent_flags = _derive_urgent_flags(structured_data)
    triage_level: TriageLevel = "priority" if urgent_flags else "routine"

    return VisualTriageResult(
        triage_level=triage_level,
        recommended_department=_CATEGORY_DEPARTMENT_MAP.get(category),
        urgent_flags=urgent_flags,
        needs_doctor_review=True,
        confidence=_normalize_confidence(confidence),
        patient_visible_summary="系统已接收该资料，详细分诊与解释将由医生进一步确认。",
    )


def to_patient_visible_triage(
    triage: VisualTriageResult | dict[str, Any],
) -> PatientVisibleTriageResult:
    """Project the full triage contract down to the patient-safe view."""

    full = (
        triage
        if isinstance(triage, VisualTriageResult)
        else VisualTriageResult.model_validate(triage)
    )
    return PatientVisibleTriageResult(
        triage_level=full.triage_level,
        recommended_department=full.recommended_department,
        needs_doctor_review=full.needs_doctor_review,
        patient_visible_summary=full.patient_visible_summary,
    )


def attach_triage_contract(
    structured_data: dict[str, Any] | None,
    *,
    category: str,
    confidence: float,
) -> dict[str, Any]:
    """Attach the full triage contract under the stable ``triage`` key."""

    payload = dict(structured_data or {})
    payload["triage"] = build_placeholder_triage_result(
        category=category,
        confidence=confidence,
        structured_data=payload,
    ).model_dump()
    return payload