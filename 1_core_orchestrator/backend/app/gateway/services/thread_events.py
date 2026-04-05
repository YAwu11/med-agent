import asyncio
import json
import time
from collections import defaultdict
from collections.abc import AsyncGenerator
from datetime import datetime, timezone


_thread_subscribers: dict[str, list[asyncio.Queue[str]]] = defaultdict(list)


def publish_thread_event(thread_id: str, data: dict) -> None:
    payload = json.dumps({"thread_id": thread_id, **data}, ensure_ascii=False, default=str)
    subscribers = _thread_subscribers.get(thread_id, [])
    dead: list[asyncio.Queue[str]] = []

    for queue in subscribers:
        try:
            queue.put_nowait(payload)
        except asyncio.QueueFull:
            dead.append(queue)

    for queue in dead:
        subscribers.remove(queue)

    if not subscribers:
        _thread_subscribers.pop(thread_id, None)


async def stream_thread_events(thread_id: str) -> AsyncGenerator[str, None]:
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=100)
    _thread_subscribers[thread_id].append(queue)

    try:
        yield (
            f"data: {json.dumps({'type': 'connected', 'thread_id': thread_id, 'timestamp': datetime.now(timezone.utc).isoformat()}, ensure_ascii=False)}\n\n"
        )

        while True:
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=30.0)
                yield f"data: {payload}\n\n"
            except asyncio.TimeoutError:
                yield f": keepalive {int(time.time())}\n\n"
    except asyncio.CancelledError:
        pass
    finally:
        subscribers = _thread_subscribers.get(thread_id)
        if subscribers and queue in subscribers:
            subscribers.remove(queue)
        if subscribers == []:
            _thread_subscribers.pop(thread_id, None)