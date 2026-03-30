"""
SQLite-backed persistence layer for Case management.

Design decisions (ADR-008):
- SQLite chosen for zero-deployment-cost MVP.
- Cases stored as JSON blobs in a single table for maximum schema flexibility.
- Thread-safe via Python's sqlite3 `check_same_thread=False` + a module-level lock.
- Migration path: swap this file for a PostgreSQL/SQLAlchemy impl when needed.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from app.gateway.models.case import (
    Case,
    CaseStatus,
    CreateCaseRequest,
    DoctorDiagnosis,
    EvidenceItem,
    Priority,
    SubmitDiagnosisRequest,
    AddEvidenceRequest,
)

logger = logging.getLogger(__name__)

# ── Database location ──────────────────────────────────────
# Stored alongside the orchestrator data, not inside thread dirs.
_DB_DIR = Path(__file__).resolve().parents[4]  # → 1_core_orchestrator/
_DB_PATH = _DB_DIR / "data" / "cases.db"

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _get_conn() -> sqlite3.Connection:
    """Lazy-init the SQLite connection and ensure the table exists."""
    global _conn
    if _conn is not None:
        return _conn

    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    _conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    _conn.execute("PRAGMA journal_mode=WAL")
    _conn.execute("""
        CREATE TABLE IF NOT EXISTS cases (
            case_id          TEXT PRIMARY KEY,
            patient_thread_id TEXT NOT NULL,
            doctor_thread_id TEXT,
            status           TEXT NOT NULL DEFAULT 'pending',
            priority         TEXT NOT NULL DEFAULT 'medium',
            data             TEXT NOT NULL,
            created_at       TEXT NOT NULL,
            updated_at       TEXT NOT NULL
        )
    """)
    _conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status)
    """)
    _conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_cases_priority ON cases(priority)
    """)
    _conn.commit()
    logger.info(f"Case DB initialized at {_DB_PATH}")
    return _conn


# ── CRUD ──────────────────────────────────────────────────

def create_case(req: CreateCaseRequest) -> Case:
    """Create a new case from a patient intake."""
    case = Case(
        patient_thread_id=req.patient_thread_id,
        priority=req.priority,
        patient_info=req.patient_info,
        evidence=req.evidence,
    )
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO cases (case_id, patient_thread_id, doctor_thread_id, status, priority, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                case.case_id,
                case.patient_thread_id,
                case.doctor_thread_id,
                case.status.value,
                case.priority.value,
                case.model_dump_json(),
                case.created_at.isoformat(),
                case.updated_at.isoformat(),
            ),
        )
        conn.commit()
    logger.info(f"Created case {case.case_id} for thread {case.patient_thread_id}")
    return case


def get_case(case_id: str) -> Case | None:
    """Fetch a single case by ID."""
    with _lock:
        conn = _get_conn()
        row = conn.execute("SELECT data FROM cases WHERE case_id = ?", (case_id,)).fetchone()
    if row is None:
        return None
    return Case.model_validate_json(row[0])


def list_cases(
    status: CaseStatus | None = None,
    priority: Priority | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Case]:
    """List cases with optional filters, ordered by priority desc then created_at desc."""
    query = "SELECT data FROM cases WHERE 1=1"
    params: list = []
    if status:
        query += " AND status = ?"
        params.append(status.value)
    if priority:
        query += " AND priority = ?"
        params.append(priority.value)

    # Priority ordering: critical > high > medium > low
    query += """
        ORDER BY
            CASE priority
                WHEN 'critical' THEN 0
                WHEN 'high' THEN 1
                WHEN 'medium' THEN 2
                WHEN 'low' THEN 3
            END,
            created_at DESC
        LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])

    with _lock:
        conn = _get_conn()
        rows = conn.execute(query, params).fetchall()
    return [Case.model_validate_json(row[0]) for row in rows]


def count_cases(status: CaseStatus | None = None) -> int:
    """Count cases, optionally filtered by status."""
    query = "SELECT COUNT(*) FROM cases WHERE 1=1"
    params: list = []
    if status:
        query += " AND status = ?"
        params.append(status.value)

    with _lock:
        conn = _get_conn()
        row = conn.execute(query, params).fetchone()
    return row[0] if row else 0


def update_case_status(case_id: str, new_status: CaseStatus, doctor_thread_id: str | None = None) -> Case | None:
    """Transition a case to a new status."""
    case = get_case(case_id)
    if case is None:
        return None

    case.status = new_status
    case.updated_at = datetime.now(timezone.utc)
    if doctor_thread_id:
        case.doctor_thread_id = doctor_thread_id

    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE cases SET status = ?, doctor_thread_id = ?, data = ?, updated_at = ? WHERE case_id = ?",
            (new_status.value, case.doctor_thread_id, case.model_dump_json(), case.updated_at.isoformat(), case_id),
        )
        conn.commit()
    return case


def add_evidence(case_id: str, req: AddEvidenceRequest) -> Case | None:
    """Append an evidence item to a case."""
    case = get_case(case_id)
    if case is None:
        return None

    item = EvidenceItem(
        type=req.type,
        title=req.title,
        source=req.source,
        file_path=req.file_path,
        structured_data=req.structured_data,
        ai_analysis=req.ai_analysis,
        is_abnormal=req.is_abnormal,
    )
    case.evidence.append(item)
    case.updated_at = datetime.now(timezone.utc)

    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE cases SET data = ?, updated_at = ? WHERE case_id = ?",
            (case.model_dump_json(), case.updated_at.isoformat(), case_id),
        )
        conn.commit()
    return case


def submit_diagnosis(case_id: str, req: SubmitDiagnosisRequest) -> Case | None:
    """Submit doctor's diagnosis and transition case to 'diagnosed'."""
    case = get_case(case_id)
    if case is None:
        return None

    case.diagnosis = DoctorDiagnosis(
        primary_diagnosis=req.primary_diagnosis,
        secondary_diagnoses=req.secondary_diagnoses,
        treatment_plan=req.treatment_plan,
        prescription=req.prescription,
        follow_up=req.follow_up,
        doctor_notes=req.doctor_notes,
    )
    case.status = CaseStatus.DIAGNOSED
    case.updated_at = datetime.now(timezone.utc)

    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE cases SET status = ?, data = ?, updated_at = ? WHERE case_id = ?",
            (CaseStatus.DIAGNOSED.value, case.model_dump_json(), case.updated_at.isoformat(), case_id),
        )
        conn.commit()
    logger.info(f"Diagnosis submitted for case {case_id}")
    return case


def get_stats() -> dict:
    """Aggregate statistics for the doctor dashboard."""
    with _lock:
        conn = _get_conn()
        total = conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
        pending = conn.execute("SELECT COUNT(*) FROM cases WHERE status = 'pending'").fetchone()[0]
        in_review = conn.execute("SELECT COUNT(*) FROM cases WHERE status = 'in_review'").fetchone()[0]
        diagnosed = conn.execute("SELECT COUNT(*) FROM cases WHERE status = 'diagnosed'").fetchone()[0]
        closed = conn.execute("SELECT COUNT(*) FROM cases WHERE status = 'closed'").fetchone()[0]

    # Pull all cases for richer aggregation
    all_cases = list_cases(limit=1000)

    # Priority breakdown
    priority_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for c in all_cases:
        priority_counts[c.priority.value] = priority_counts.get(c.priority.value, 0) + 1

    # Evidence type distribution
    evidence_types = {"imaging": 0, "lab": 0, "ecg": 0, "vitals": 0, "note": 0}
    abnormal_count = 0
    for c in all_cases:
        for ev in c.evidence:
            evidence_types[ev.type] = evidence_types.get(ev.type, 0) + 1
            if ev.is_abnormal:
                abnormal_count += 1

    # Diagnosis keywords (top diagnoses if any)
    diagnosis_keywords: dict[str, int] = {}
    for c in all_cases:
        if c.diagnosis and c.diagnosis.primary_diagnosis:
            diag = c.diagnosis.primary_diagnosis
            diagnosis_keywords[diag] = diagnosis_keywords.get(diag, 0) + 1

    top_diagnoses = sorted(diagnosis_keywords.items(), key=lambda x: x[1], reverse=True)[:5]

    return {
        "total": total,
        "pending": pending,
        "in_review": in_review,
        "diagnosed": diagnosed,
        "closed": closed,
        "priority_breakdown": priority_counts,
        "evidence_types": evidence_types,
        "abnormal_evidence_count": abnormal_count,
        "top_diagnoses": [{"name": k, "count": v} for k, v in top_diagnoses],
    }

