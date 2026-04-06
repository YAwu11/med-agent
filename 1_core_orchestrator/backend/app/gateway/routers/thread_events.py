from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.gateway.services.thread_events import stream_thread_events


router = APIRouter(prefix="/api/threads/{thread_id}", tags=["thread-events"])


@router.get("/events")
async def thread_event_stream(thread_id: str):
    return StreamingResponse(
        stream_thread_events(thread_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )