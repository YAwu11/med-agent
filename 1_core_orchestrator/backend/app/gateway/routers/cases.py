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
import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.gateway.models.case import (
    AddEvidenceRequest,
    CaseStatus,
    CreateCaseRequest,
    Priority,
    SubmitDiagnosisRequest,
    UpdateStatusRequest,
)
from app.gateway.services import case_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["cases"])

# ── SSE Event Bus ──────────────────────────────────────────
# Simple in-process pub/sub for SSE. Sufficient for single-server MVP.

_sse_subscribers: list[asyncio.Queue] = []


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


# ── Diagnosis ──────────────────────────────────────────────

@router.put("/cases/{case_id}/diagnosis")
async def submit_diagnosis(case_id: str, req: SubmitDiagnosisRequest):
    """Submit doctor's diagnosis. Transitions case to 'diagnosed' status."""
    case = case_db.submit_diagnosis(case_id, req)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")
    _broadcast_event("diagnosed", {
        "case_id": case_id,
        "primary_diagnosis": req.primary_diagnosis,
    })
    return case.model_dump()


# ── Statistics ──────────────────────────────────────────────

@router.get("/doctor/stats")
async def get_doctor_stats():
    """Aggregate statistics for the doctor dashboard."""
    return case_db.get_stats()


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
