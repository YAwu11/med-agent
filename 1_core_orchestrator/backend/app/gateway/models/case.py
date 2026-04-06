"""
Case-centric data models for MedAgent diagnostic pipeline.

ADR-008: A 'Case' is the single unit connecting a patient's intake
with the doctor's review. All evidence and diagnoses attach to a Case.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


# ── Enums ──────────────────────────────────────────────────

class CaseStatus(str, Enum):
    PENDING = "pending"          # 等待医生接诊
    IN_REVIEW = "in_review"      # 医生正在审阅
    DIAGNOSED = "diagnosed"      # 医生已提交诊断
    CLOSED = "closed"            # 已归档

class Priority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


# ── Evidence ───────────────────────────────────────────────

class EvidenceItem(BaseModel):
    """Single piece of clinical evidence (an image, a lab report, a note)."""
    evidence_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    type: Literal["vitals", "imaging", "lab", "ecg", "note"]
    title: str
    source: Literal["patient_upload", "ai_generated", "doctor_input"] = "patient_upload"

    # Raw data references
    file_path: str | None = None
    structured_data: list[Any] | dict[str, Any] | None = None
    ai_analysis: str | None = None

    # Doctor annotations
    doctor_annotation: str | None = None
    is_abnormal: bool = False

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ── Patient Info ───────────────────────────────────────────

class PatientInfo(BaseModel):
    """Basic patient demographics extracted from intake."""
    name: str | None = None                  # 姓名
    age: int | None = None
    sex: str | None = None
    phone: str | None = None                 # 联系电话
    id_number: str | None = None             # 身份证号 (脱敏存储)
    chief_complaint: str | None = None       # 主诉
    present_illness: str | None = None       # 现病史
    medical_history: str | None = None       # 既往史
    allergies: str | None = None             # 过敏与用药
    height_cm: float | None = None
    weight_kg: float | None = None
    temperature: float | None = None         # °C
    heart_rate: int | None = None            # bpm
    blood_pressure: str | None = None        # "140/90"
    spo2: float | None = None               # %


# ── Diagnosis ──────────────────────────────────────────────

class DoctorDiagnosis(BaseModel):
    """Doctor's final diagnostic conclusion."""
    primary_diagnosis: str
    secondary_diagnoses: list[str] = Field(default_factory=list)
    treatment_plan: str = ""
    prescription: str | None = None
    follow_up: str | None = None
    doctor_notes: str = ""
    diagnosed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ── Case (Top-Level Entity) ───────────────────────────────

class Case(BaseModel):
    """
    The core diagnostic unit bridging patient intake and doctor review.

    Lifecycle: pending → in_review → diagnosed → closed
    """
    case_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:16])
    patient_thread_id: str               # Patient's LangGraph thread_id
    doctor_thread_id: str | None = None  # Assigned when doctor picks up

    status: CaseStatus = CaseStatus.PENDING
    priority: Priority = Priority.MEDIUM

    patient_info: PatientInfo = Field(default_factory=PatientInfo)
    evidence: list[EvidenceItem] = Field(default_factory=list)
    diagnosis: DoctorDiagnosis | None = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ── API Request / Response schemas ─────────────────────────

class CreateCaseRequest(BaseModel):
    case_id: str | None = None               # 外部指定 case_id（患者端用 thread_id 统一）
    patient_thread_id: str | None = None
    priority: Priority = Priority.MEDIUM
    patient_info: PatientInfo = Field(default_factory=PatientInfo)
    evidence: list[EvidenceItem] = Field(default_factory=list)

class AddEvidenceRequest(BaseModel):
    evidence_id: str | None = None
    type: Literal["vitals", "imaging", "lab", "ecg", "note"]
    title: str
    source: Literal["patient_upload", "ai_generated", "doctor_input"] = "patient_upload"
    file_path: str | None = None
    structured_data: list[Any] | dict[str, Any] | None = None
    ai_analysis: str | None = None
    is_abnormal: bool = False

class SubmitDiagnosisRequest(BaseModel):
    primary_diagnosis: str
    secondary_diagnoses: list[str] = Field(default_factory=list)
    treatment_plan: str = ""
    prescription: str | None = None
    follow_up: str | None = None
    doctor_notes: str = ""

class UpdateStatusRequest(BaseModel):
    status: CaseStatus

class UpdateEvidenceRequest(BaseModel):
    """Doctor-side partial update for a specific evidence item."""
    structured_data: list[Any] | dict[str, Any] | None = None
    ai_analysis: str | None = None
    is_abnormal: bool | None = None


class UpdatePatientInfoRequest(BaseModel):
    """Doctor-side patient info update (partial update supported)."""
    name: str | None = None
    age: int | None = None
    sex: str | None = None
    phone: str | None = None
    chief_complaint: str | None = None
    present_illness: str | None = None
    medical_history: str | None = None
    allergies: str | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    temperature: float | None = None
    heart_rate: int | None = None
    blood_pressure: str | None = None
    spo2: float | None = None

