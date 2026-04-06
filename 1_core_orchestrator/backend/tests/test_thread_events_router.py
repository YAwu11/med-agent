import asyncio
import json


def test_thread_event_stream_emits_connected_and_published_events():
    from app.gateway.services.thread_events import publish_thread_event, stream_thread_events

    async def _assert_stream() -> None:
        generator = stream_thread_events("thread-1")

        connected_line = await anext(generator)
        connected_payload = json.loads(connected_line.removeprefix("data: ").strip())
        assert connected_payload["type"] == "connected"
        assert connected_payload["thread_id"] == "thread-1"

        publish_thread_event(
            "thread-1",
            {
                "type": "upload_analyzed",
                "event_id": "upload-123:2026-04-05T12:00:00Z",
                "upload_id": "upload-123",
                "filename": "cbc.png",
                "analysis_kind": "ocr",
            },
        )

        event_line = await asyncio.wait_for(anext(generator), timeout=1.0)
        event_payload = json.loads(event_line.removeprefix("data: ").strip())
        assert event_payload == {
            "type": "upload_analyzed",
            "thread_id": "thread-1",
            "event_id": "upload-123:2026-04-05T12:00:00Z",
            "upload_id": "upload-123",
            "filename": "cbc.png",
            "analysis_kind": "ocr",
        }

        await generator.aclose()

    asyncio.run(_assert_stream())