"""
Cases REST API router with SSE real-time push.

Provides endpoints for:
- Case CRUD (create, list, get, update status)
- Evidence management (list, add)
- Diagnosis submission
- SSE stream for real-time queue updates
- Statistics aggregation
"""

from __future__ import annotations

import asyncio
import json
from loguru import logger
import time
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from deerflow.patient_record_context import build_patient_record_snapshot

from app.gateway.models.case import (
    AddEvidenceRequest,
    CaseStatus,
    CreateCaseRequest,
    Priority,
    SubmitDiagnosisRequest,
    UpdatePatientInfoRequest,
    UpdateStatusRequest,
)
from app.gateway.services import case_db


router = APIRouter(prefix="/api", tags=["cases"])

# ── SSE Event Bus ──────────────────────────────────────────
# Simple in-process pub/sub for SSE. Sufficient for single-server MVP.

_sse_subscribers: list[asyncio.Queue] = []


def _build_summary_readiness(case) -> dict:
    snapshot = build_patient_record_snapshot(case.patient_thread_id)
    guidance = snapshot.get("guidance") or {}
    return {
        "ready_for_synthesis": bool(guidance.get("ready_for_ai_summary")),
        "stage": guidance.get("stage") or "collecting_info",
        "status_text": guidance.get("status_text") or "病例信息尚未准备完成。",
        "next_action": guidance.get("next_action") or "请先补充信息或等待资料解析完成。",
        "blocking_reasons": guidance.get("blocking_reasons") or [],
        "missing_required_fields": guidance.get("missing_required_fields") or [],
        "pending_files": guidance.get("pending_files") or [],
        "failed_files": guidance.get("failed_files") or [],
    }


def _map_brain_review_status(raw_status: str | None) -> str:
    normalized = (raw_status or "").strip().lower()
    if normalized == "reviewed":
        return "已复核"
    if normalized in {"pending_review", "pending_doctor_review"}:
        return "待医生复核"
    if normalized in {"processing", "queued", "running"}:
        return "处理中"
    if normalized in {"failed", "error"}:
        return "处理失败"
    return "已完成"


def _summarize_structured_findings(findings: object) -> str:
    if not isinstance(findings, list):
        return ""
    labels: list[str] = []
    for item in findings[:5]:
        if isinstance(item, dict):
            label = str(item.get("label") or item.get("class") or item.get("disease") or "").strip()
        else:
            label = str(item).strip()
        if label:
            labels.append(label)
    return "；".join(labels)


def _format_brain_evidence(structured_data: dict) -> list[str]:
    lines = ["**脑 MRI 3D 分析**"]
    lines.append(f"- 医生审核状态: {_map_brain_review_status(structured_data.get('status'))}")
    spatial_info = structured_data.get("spatial_info") if isinstance(structured_data.get("spatial_info"), dict) else {}
    location = spatial_info.get("location") if isinstance(spatial_info, dict) else None
    if location:
        lines.append(f"- 关键定位: {location}")
    findings_text = _summarize_structured_findings(structured_data.get("findings"))
    if findings_text:
        lines.append(f"- 关键发现: {findings_text}")
    report_text = structured_data.get("report_text")
    if report_text:
        lines.append(f"**空间报告:** {report_text}")
    return lines


def _format_evidence_sections(ev) -> list[str]:
    sections: list[str] = []
    structured_data = ev.structured_data if isinstance(ev.structured_data, dict) else {}
    is_brain_mri = structured_data.get("pipeline") == "brain_nifti_v1" or structured_data.get("viewer_kind") == "brain_spatial_review"

    if is_brain_mri:
        sections.extend(_format_brain_evidence(structured_data))

    if ev.ai_analysis:
        sections.append(f"**AI 分析结果:**\n{ev.ai_analysis}")
    if structured_data and not is_brain_mri:
        import json as _json

        sections.append(f"**结构化数据:**\n```json\n{_json.dumps(structured_data, ensure_ascii=False, indent=2)}\n```")
    if ev.doctor_annotation:
        sections.append(f"**医生批注:** {ev.doctor_annotation}")

    return sections

def _broadcast_event(event_type: str, data: dict):
    """Push an event to all connected SSE subscribers."""
    payload = json.dumps({"type": event_type, **data}, ensure_ascii=False, default=str)
    dead: list[asyncio.Queue] = []
    for q in _sse_subscribers:
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        _sse_subscribers.remove(q)

# ── Case CRUD ──────────────────────────────────────────────

@router.post("/cases")
async def create_case(req: CreateCaseRequest):
    """Create a new diagnostic case from patient intake."""
    case = case_db.create_case(req)
    _broadcast_event("new_case", {
        "case_id": case.case_id,
        "priority": case.priority.value,
        "chief_complaint": case.patient_info.chief_complaint or "未填写",
    })
    return case.model_dump()

@router.get("/cases")
async def list_cases(
    status: CaseStatus | None = None,
    priority: Priority | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """List cases with optional status/priority filters."""
    cases = case_db.list_cases(status=status, priority=priority, limit=limit, offset=offset)
    counts = case_db.get_stats()
    return {
        "cases": [c.model_dump() for c in cases],
        "total": counts["total"],
        "counts": counts,
    }

# ── SSE Real-Time Stream ──────────────────────────────────

@router.get("/cases/stream")
async def case_event_stream():
    """
    SSE endpoint for real-time case queue updates.

    Events:
    - new_case: A new patient case was created
    - status_change: A case changed status
    - new_evidence: New evidence was added to a case
    - diagnosed: A case received a doctor diagnosis
    """
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _sse_subscribers.append(queue)

    async def event_generator():
        try:
            # Send initial heartbeat
            yield f"data: {json.dumps({'type': 'connected', 'timestamp': datetime.now(timezone.utc).isoformat()})}\n\n"

            while True:
                try:
                    # Wait for events with a 30s heartbeat timeout
                    payload = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {payload}\n\n"
                except asyncio.TimeoutError:
                    # Send keepalive ping
                    yield f": keepalive {int(time.time())}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if queue in _sse_subscribers:
                _sse_subscribers.remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@router.get("/cases/{case_id}")
async def get_case(case_id: str):
    """Get full case details including all evidence and diagnosis."""
    case = case_db.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")
    return case.model_dump()

@router.patch("/cases/{case_id}/status")
async def update_case_status(case_id: str, req: UpdateStatusRequest):
    """Update case status (e.g., pending → in_review)."""
    case = case_db.update_case_status(case_id, req.status)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")
    _broadcast_event("status_change", {
        "case_id": case_id,
        "new_status": req.status.value,
    })
    return case.model_dump()

@router.delete("/cases/{case_id}")
async def delete_case(case_id: str):
    """Delete a case by case_id."""
    deleted = case_db.delete_case(case_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")
    _broadcast_event("case_deleted", {"case_id": case_id})
    return {"status": "ok", "message": "Case deleted successfully"}

# ── Diagnosis Submission ──────────────────────────────────

@router.put("/cases/{case_id}/diagnosis")
async def submit_diagnosis(case_id: str, req: SubmitDiagnosisRequest):
    """Submit a doctor's diagnosis for a case.

    Sets the case status to 'diagnosed', stores the diagnosis fields,
    and broadcasts a 'diagnosed' SSE event so patient-side pages refresh.
    """
    case = case_db.submit_diagnosis(case_id, req)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")
    _broadcast_event("diagnosed", {
        "case_id": case_id,
        "primary_diagnosis": req.primary_diagnosis,
    })
    return case.model_dump()

# ── Patient Info Editing ───────────────────────────────────

@router.patch("/cases/{case_id}/patient-info")
async def update_patient_info(case_id: str, req: UpdatePatientInfoRequest):
    """Update patient demographics/vitals on an existing case (doctor-side)."""
    info_dict = req.model_dump(exclude_none=True)
    if not info_dict:
        raise HTTPException(status_code=400, detail="No fields to update")
    case = case_db.update_patient_info_by_case(case_id, info_dict)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")
    _broadcast_event("patient_info_updated", {"case_id": case_id})
    return case.model_dump()

# ── Evidence ───────────────────────────────────────────────

@router.get("/cases/{case_id}/evidence")
async def list_evidence(case_id: str):
    """Get all evidence items for a case."""
    case = case_db.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")
    return {"evidence": [e.model_dump() for e in case.evidence], "total": len(case.evidence)}

@router.post("/cases/{case_id}/evidence")
async def add_evidence(case_id: str, req: AddEvidenceRequest):
    """Append a new evidence item to an existing case."""
    case = case_db.add_evidence(case_id, req)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")
    _broadcast_event("new_evidence", {
        "case_id": case_id,
        "evidence_type": req.type,
        "title": req.title,
    })
    return {"status": "ok", "total_evidence": len(case.evidence)}

from app.gateway.models.case import UpdateEvidenceRequest

@router.patch("/cases/{case_id}/evidence/{evidence_id}")
async def update_evidence(case_id: str, evidence_id: str, req: UpdateEvidenceRequest):
    """Update specific fields of an existing evidence item."""
    update_dict = req.model_dump(exclude_none=True)
    if not update_dict:
        raise HTTPException(status_code=400, detail="No fields to update")
        
    case = case_db.update_evidence_data(case_id, evidence_id, update_dict)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Case {case_id} or evidence {evidence_id} not found")
        
    _broadcast_event("evidence_updated", {"case_id": case_id, "evidence_id": evidence_id})
    return case.model_dump()

@router.delete("/cases/{case_id}/evidence/{evidence_id}")
async def delete_evidence(case_id: str, evidence_id: str):
    """Delete a specific evidence item from a case."""
    case = case_db.remove_evidence(case_id, evidence_id)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Case {case_id} or evidence {evidence_id} not found")
        
    _broadcast_event("evidence_deleted", {"case_id": case_id, "evidence_id": evidence_id})
    return {"status": "ok", "message": "Evidence deleted successfully", "case": case.model_dump()}

# ── Statistics ──────────────────────────────────────────────

@router.get("/doctor/stats")
async def get_doctor_stats():
    """Aggregate statistics for the doctor dashboard."""
    return case_db.get_stats()

# ── Case Summary for AI Synthesis (Gap④) ──────────────────

@router.get("/cases/{case_id}/summary-readiness")
async def get_case_summary_readiness(case_id: str):
    case = case_db.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")

    readiness = _build_summary_readiness(case)
    return {
        "case_id": case_id,
        **readiness,
    }

@router.get("/cases/{case_id}/summary")
async def get_case_summary(case_id: str):
    """[Gap④] 聚合病例所有信息，生成结构化摘要供 AI 综合诊断消费。

    将 patient_info、所有 evidence（含 OCR 文本、影像审核 JSON）、
    医生批注等汇总为一段完整的 Markdown 文本，前端可直接注入到 AI Chat。
    """
    case = case_db.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")

    readiness = _build_summary_readiness(case)
    if not readiness["ready_for_synthesis"]:
        raise HTTPException(
            status_code=409,
            detail={
                "message": readiness["status_text"],
                **readiness,
            },
        )

    p = case.patient_info
    sections = []

    # 1. 患者基本信息
    sections.append("## 患者基本信息")
    info_lines = []
    if p.name: info_lines.append(f"- 姓名: {p.name}")
    if p.age: info_lines.append(f"- 年龄: {p.age}岁")
    if p.sex: info_lines.append(f"- 性别: {p.sex}")
    if p.height_cm: info_lines.append(f"- 身高: {p.height_cm}cm")
    if p.weight_kg: info_lines.append(f"- 体重: {p.weight_kg}kg")
    sections.append("\n".join(info_lines) if info_lines else "- 无基本信息")

    # 2. 生命体征
    vitals = []
    if p.temperature: vitals.append(f"- 体温: {p.temperature}°C")
    if p.heart_rate: vitals.append(f"- 心率: {p.heart_rate} bpm")
    if p.blood_pressure: vitals.append(f"- 血压: {p.blood_pressure} mmHg")
    if p.spo2: vitals.append(f"- 血氧: {p.spo2}%")
    if vitals:
        sections.append("## 生命体征")
        sections.append("\n".join(vitals))

    # 3. 病史
    if p.chief_complaint:
        sections.append(f"## 主诉\n{p.chief_complaint}")
    if p.present_illness:
        sections.append(f"## 现病史\n{p.present_illness}")
    if p.medical_history:
        sections.append(f"## 既往史\n{p.medical_history}")
    if p.allergies:
        sections.append(f"## 过敏与用药\n{p.allergies}")

    # 4. 临床证据汇总
    if case.evidence:
        sections.append(f"## 临床证据 ({len(case.evidence)} 项)")
        for i, ev in enumerate(case.evidence, 1):
            ev_header = f"### {i}. [{ev.type.upper()}] {ev.title}"
            if ev.is_abnormal:
                ev_header += " ⚠️ 异常"
            sections.append(ev_header)
            sections.extend(_format_evidence_sections(ev))

    # 5. 已有诊断（如有）
    if case.diagnosis:
        sections.append("## 已有诊断结论")
        sections.append(f"- 主诊断: {case.diagnosis.primary_diagnosis}")
        if case.diagnosis.secondary_diagnoses:
            sections.append(f"- 次要诊断: {', '.join(case.diagnosis.secondary_diagnoses)}")
        if case.diagnosis.treatment_plan:
            sections.append(f"- 治疗方案: {case.diagnosis.treatment_plan}")

    summary_text = "\n\n".join(sections)

    return {
        "case_id": case_id,
        "summary": summary_text,
        "evidence_count": len(case.evidence),
        "has_diagnosis": case.diagnosis is not None,
        "summary_readiness": readiness,
    }

# ── Patient-Side Case Lookup ───────────────────────────────

@router.get("/cases/by-thread/{thread_id}")
async def get_case_by_thread(thread_id: str):
    """Look up a case by the patient's LangGraph thread_id.

    Used by the patient status page to retrieve their case and diagnosis
    without needing to know the internal case_id.
    """
    case = case_db.get_case_by_thread(thread_id)
    if case is None:
        raise HTTPException(status_code=404, detail=f"No case found for thread {thread_id}")
    return case.model_dump()

