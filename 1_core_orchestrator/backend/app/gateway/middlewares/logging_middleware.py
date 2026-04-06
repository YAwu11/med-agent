import time
from fastapi import Request
from loguru import logger
from asgi_correlation_id import correlation_id

async def loguru_requests_middleware(request: Request, call_next):
    """
    Loguru 全栈日志请求耗时计算。
    配合 asgi_correlation_id 使用，可以将每次请求生命周期包裹进带有特定 RequestID 的上下文中。
    """
    # 请求抵达时赋予日志 ID 标记
    client_ip = request.client.host if request.client else "unknown"
    req_path = request.url.path
    
    # 忽略过载且价值低的心跳类探测日志，让控制台更干净
    if req_path in ("/", "/health", "/cases/stream"):
        return await call_next(request)

    req_id = correlation_id.get() or "unknown_req"
    logger.info(f"📥 REQUEST  | {request.method} {req_path} (Client: {client_ip})")
    
    start_time = time.time()
    try:
        response = await call_next(request)
        process_time = time.time() - start_time
        logger.info(f"📤 RESPONSE | {request.method} {req_path} | Status: {response.status_code} | Took: {process_time:.3f}s")
        return response
    except Exception as e:
        process_time = time.time() - start_time
        logger.error(f"💥 CRASH   | {request.method} {req_path} | Failed after {process_time:.3f}s: {e}")
        raise
