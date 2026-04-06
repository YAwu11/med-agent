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
from loguru import logger
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
    
    # P0: Hitl Imaging Reports Persistence
    _conn.execute("""
        CREATE TABLE IF NOT EXISTS reports (
            report_id          TEXT PRIMARY KEY,
            patient_thread_id  TEXT NOT NULL,
            image_path         TEXT NOT NULL,
            ai_result          TEXT NOT NULL,
            doctor_result      TEXT,
            status             TEXT NOT NULL DEFAULT 'pending_review',
            created_at         TEXT NOT NULL,
            updated_at         TEXT NOT NULL
        )
    """)
    _conn.execute("""
        CREATE TABLE IF NOT EXISTS report_audit_log (
            audit_id           INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id          TEXT NOT NULL,
            doctor_id          TEXT,
            action             TEXT NOT NULL,
            old_value          TEXT,
            new_value          TEXT,
            created_at         TEXT NOT NULL
        )
    """)
    _conn.commit()
    logger.info(f"Case DB initialized at {_DB_PATH}")
    return _conn

# ── CRUD ──────────────────────────────────────────────────

def create_case(req: CreateCaseRequest) -> Case:
    """Create a new case from a patient intake."""
    case = Case(
        patient_thread_id=req.patient_thread_id or "",  # placeholder, overwritten below
        priority=req.priority,
        patient_info=req.patient_info,
        evidence=req.evidence,
    )
    # [ADR-037] ID 统一策略：
    # 1. 患者端挂号：传入 case_id = thread_id，两端使用同一个 ID
    # 2. 医生端手动建档：不传 case_id 也不传 thread_id，强制 thread_id = case_id
    if req.case_id:
        case.case_id = req.case_id
    if not req.patient_thread_id:
        case.patient_thread_id = case.case_id
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

def delete_case(case_id: str) -> bool:
    """Delete case by case_id."""
    with _lock:
        conn = _get_conn()
        cursor = conn.execute("DELETE FROM cases WHERE case_id = ?", (case_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted

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

def submit_diagnosis(case_id: str, req: SubmitDiagnosisRequest) -> Case | None:
    """Submit a doctor's diagnosis and transition the case to 'diagnosed'.

    Creates a DoctorDiagnosis record, attaches it to the Case, and sets
    case.status = diagnosed. This is the formal conclusion of the diagnostic loop.
    """
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
    if req.evidence_id:
        item.evidence_id = req.evidence_id

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

def update_evidence_data(case_id: str, evidence_id: str, updates: dict) -> Case | None:
    """Update specific fields of an existing evidence item within a case."""
    case = get_case(case_id)
    if case is None:
        return None

    updated = False
    for item in case.evidence:
        if item.evidence_id == evidence_id:
            for k, v in updates.items():
                if hasattr(item, k):
                    setattr(item, k, v)
                    updated = True
            break
            
    if updated:
        case.updated_at = datetime.now(timezone.utc)
        with _lock:
            conn = _get_conn()
            conn.execute(
                "UPDATE cases SET data = ?, updated_at = ? WHERE case_id = ?",
                (case.model_dump_json(), case.updated_at.isoformat(), case_id),
            )
            conn.commit()
    return case

def remove_evidence(case_id: str, evidence_id: str) -> Case | None:
    """Remove an evidence item from a case by its ID."""
    case = get_case(case_id)
    if case is None:
        return None

    initial_len = len(case.evidence)
    case.evidence = [item for item in case.evidence if item.evidence_id != evidence_id]
    
    if len(case.evidence) == initial_len:
        return None  # No matching evidence found to remove

    case.updated_at = datetime.now(timezone.utc)
    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE cases SET data = ?, updated_at = ? WHERE case_id = ?",
            (case.model_dump_json(), case.updated_at.isoformat(), case_id),
        )
        conn.commit()
    return case

def update_patient_info(thread_id: str, info_dict: dict) -> Case | None:
    """Update patient info on an existing Case. Returns None if no Case exists.
    
    [ADR-020] No longer auto-creates a Case. Case creation is exclusively
    handled by the frontend appointment confirmation flow when the patient confirms.
    """
    target_case = get_case_by_thread(thread_id)
    
    if not target_case:
        # No case exists yet — patient hasn't confirmed scheduling
        return None
        
    # Update existing case
    info_model = target_case.patient_info
    for k, v in info_dict.items():
        if hasattr(info_model, k) and v is not None:
            setattr(info_model, k, v)
            
    target_case.updated_at = datetime.now(timezone.utc)
    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE cases SET data = ?, updated_at = ? WHERE case_id = ?",
            (target_case.model_dump_json(), target_case.updated_at.isoformat(), target_case.case_id),
        )
        conn.commit()
    return target_case

def update_patient_info_by_case(case_id: str, info_dict: dict) -> Case | None:
    """Update patient info on an existing Case by case_id (doctor-side).
    
    Unlike update_patient_info() which uses thread_id, this version is used
    by the doctor workbench to directly edit patient data on an existing case.
    Only non-None fields in info_dict are applied (partial update).
    """
    case = get_case(case_id)
    if not case:
        return None
    
    info_model = case.patient_info
    for k, v in info_dict.items():
        if hasattr(info_model, k) and v is not None:
            setattr(info_model, k, v)
    
    case.updated_at = datetime.now(timezone.utc)
    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE cases SET data = ?, updated_at = ? WHERE case_id = ?",
            (case.model_dump_json(), case.updated_at.isoformat(), case_id),
        )
        conn.commit()
    return case

def get_case_by_thread(thread_id: str) -> Case | None:
    """Find the active Case for a given patient thread_id.
    
    Used by route guards and the appointment confirmation flow to check
    whether a formal Case already exists for this conversation thread.
    """
    with _lock:
        conn = _get_conn()
        row = conn.execute(
            "SELECT data FROM cases WHERE patient_thread_id = ? LIMIT 1",
            (thread_id,)
        ).fetchone()
    if row:
        return Case.model_validate_json(row[0])
    return None

def update_case_evidence_from_report(thread_id: str, report_id: str, doctor_result: dict) -> bool:
    """Sync the doctor's review back to the macro Case.evidence array."""
    target_case = get_case_by_thread(thread_id)
    
    if not target_case:
        return False
        
    updated = False
    for item in target_case.evidence:
        structured = item.structured_data if isinstance(item.structured_data, dict) else {}
        linked_report_id = structured.get("report_id")
        if item.evidence_id == report_id or linked_report_id == report_id:
            if item.structured_data is None or not isinstance(item.structured_data, dict):
                item.structured_data = {}
            item.structured_data.setdefault("report_id", report_id)
            item.structured_data.update(doctor_result)
            item.structured_data["status"] = str(doctor_result.get("status") or "reviewed")
            updated = True
            break
            
    if updated:
        target_case.updated_at = datetime.now(timezone.utc)
        with _lock:
            conn = _get_conn()
            conn.execute(
                "UPDATE cases SET data = ?, updated_at = ? WHERE case_id = ?",
                (target_case.model_dump_json(), target_case.updated_at.isoformat(), target_case.case_id),
            )
            conn.commit()
        return True
    return False

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

# ── Rerports & HITL Audit ─────────────────────────────────

def sync_report_from_file(thread_id: str, file_path: Path) -> dict | None:
    """Sync a JSON file containing a report into the database."""
    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
        report_id = data.get("report_id") or data.get("id")
        if not report_id:
            return None
        
        image_path = data.get("image_path", "")
        status = data.get("status", "pending_review")
        ai_result_str = json.dumps(data.get("ai_result", {}), ensure_ascii=False)
        doc_result_raw = data.get("doctor_result")
        doc_result_str = json.dumps(doc_result_raw, ensure_ascii=False) if doc_result_raw else None
        now_str = datetime.now(timezone.utc).isoformat()
        
        with _lock:
            conn = _get_conn()
            existing = conn.execute(
                "SELECT created_at FROM reports WHERE report_id = ?",
                (report_id,),
            ).fetchone()
            created_at = existing[0] if existing else now_str
            conn.execute(
                """
                INSERT INTO reports 
                (report_id, patient_thread_id, image_path, ai_result, doctor_result, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(report_id) DO UPDATE SET
                    patient_thread_id = excluded.patient_thread_id,
                    image_path = excluded.image_path,
                    ai_result = excluded.ai_result,
                    doctor_result = excluded.doctor_result,
                    status = excluded.status,
                    updated_at = excluded.updated_at
                """,
                (report_id, thread_id, image_path, ai_result_str, doc_result_str, status, created_at, now_str)
            )
            conn.commit()

            row = conn.execute("SELECT ai_result, doctor_result, status FROM reports WHERE report_id = ?", (report_id,)).fetchone()
            
        return {
            "report_id": report_id,
            "thread_id": thread_id,
            "status": row[2] if row else status,
            "image_path": image_path,
            "ai_result": json.loads(row[0]) if row else data.get("ai_result"),
            "doctor_result": json.loads(row[1]) if row and row[1] else doc_result_raw
        }
    except Exception as e:
        logger.error(f"Failed to sync report {file_path}: {e}")
        return None

def get_reports_by_thread(thread_id: str, status: str | None = None) -> list[dict]:
    """Get reports from the database."""
    query = "SELECT report_id, image_path, ai_result, doctor_result, status, created_at FROM reports WHERE patient_thread_id = ?"
    params = [thread_id]
    if status:
        query += " AND status = ?"
        params.append(status)
        
    query += " ORDER BY created_at DESC"
    
    with _lock:
        conn = _get_conn()
        rows = conn.execute(query, params).fetchall()
        
    reports = []
    for row in rows:
        reports.append({
            "report_id": row[0],
            "thread_id": thread_id,
            "image_path": row[1],
            "ai_result": json.loads(row[2]) if row[2] else {},
            "doctor_result": json.loads(row[3]) if row[3] else None,
            "status": row[4],
            "created_at": row[5]
        })
    return reports

def get_report_by_id(report_id: str) -> dict | None:
    """Get a single report by ID from DB."""
    with _lock:
        conn = _get_conn()
        row = conn.execute("SELECT patient_thread_id, image_path, ai_result, doctor_result, status, created_at FROM reports WHERE report_id = ?", (report_id,)).fetchone()
        
    if not row:
        return None
        
    return {
        "report_id": report_id,
        "thread_id": row[0],
        "image_path": row[1],
        "ai_result": json.loads(row[2]) if row[2] else {},
        "doctor_result": json.loads(row[3]) if row[3] else None,
        "status": row[4],
        "created_at": row[5]
    }

def update_report(report_id: str, doctor_result: dict, doctor_id: str = "unknown") -> dict | None:
    """Update report with doctor modifications and trigger snapshot audit."""
    existing_report = get_report_by_id(report_id)
    if not existing_report:
        return None

    merged_doctor_result = {
        **(existing_report.get("ai_result") if isinstance(existing_report.get("ai_result"), dict) else {}),
        **(existing_report.get("doctor_result") if isinstance(existing_report.get("doctor_result"), dict) else {}),
        **doctor_result,
    }
        
    # Capture old value for audit snapshot
    old_value = existing_report["doctor_result"] if existing_report.get("doctor_result") else existing_report["ai_result"]
    new_status = "reviewed"
    
    now_str = datetime.now(timezone.utc).isoformat()
    old_value_str = json.dumps(old_value, ensure_ascii=False)
    new_value_str = json.dumps(merged_doctor_result, ensure_ascii=False)
    
    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE reports SET doctor_result = ?, status = ?, updated_at = ? WHERE report_id = ?",
            (new_value_str, new_status, now_str, report_id)
        )
        # Audit Log (Option A: whole snapshots)
        conn.execute(
            """
            INSERT INTO report_audit_log (report_id, doctor_id, action, old_value, new_value, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (report_id, doctor_id, "update_report", old_value_str, new_value_str, now_str)
        )
        conn.commit()
    
    return get_report_by_id(report_id)
