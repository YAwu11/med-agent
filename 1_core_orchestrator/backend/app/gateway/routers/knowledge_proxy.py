"""
Knowledge Proxy — Gateway 反向代理，透明转发至 RAGFlow Lite

所有 /api/knowledge/* 请求被转发到 RAGFlow Lite 的 /api/* 端点。
例: GET /api/knowledge/knowledgebase → http://127.0.0.1:9380/api/knowledgebase

NOTE: 使用 aiohttp 替代 httpx，因为 httpx 0.28+ 的连接管理在 Windows 上
      与 uvicorn --reload 模式的 reloader 进程存在兼容性问题，会收到空 502。
"""
import logging
import os

import aiohttp
from fastapi import APIRouter, Request, HTTPException, Response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])

RAGFLOW_PROXY_URL = os.getenv("RAGFLOW_URL", "http://127.0.0.1:9380")


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_ragflow(request: Request, path: str):
    """
    Reverse proxy to RAGFlow Lite backend.

    /api/knowledge/{path} → {RAGFLOW_URL}/api/{path}
    """
    url = f"{RAGFLOW_PROXY_URL}/api/{path}"

    # Preserve query params
    params = dict(request.query_params)

    # Only read body for methods that carry a payload
    body = None
    if request.method in ("POST", "PUT", "PATCH"):
        body = await request.body()

    # Only forward safe headers
    fwd_headers = {}
    ct = request.headers.get("content-type")
    if ct:
        fwd_headers["content-type"] = ct
    accept = request.headers.get("accept")
    if accept:
        fwd_headers["accept"] = accept

    logger.info(f"[KnowledgeProxy] {request.method} {url} (params={params})")

    try:
        timeout = aiohttp.ClientTimeout(total=30)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.request(
                method=request.method,
                url=url,
                data=body,
                headers=fwd_headers,
                params=params,
            ) as rag_response:
                resp_body = await rag_response.read()
                resp_ct = rag_response.headers.get("content-type", "application/json")

                logger.info(
                    f"[KnowledgeProxy] Response: {rag_response.status} from {url}"
                )

                return Response(
                    content=resp_body,
                    status_code=rag_response.status,
                    media_type=resp_ct,
                )
    except TimeoutError:
        logger.error(
            f"[KnowledgeProxy] Timeout connecting to RAGFlow at {RAGFLOW_PROXY_URL}"
        )
        raise HTTPException(
            status_code=504, detail="RAGFlow knowledge base service timeout"
        )
    except aiohttp.ClientError as exc:
        logger.error(
            f"[KnowledgeProxy] Connection error to {url}: {exc}"
        )
        raise HTTPException(
            status_code=502,
            detail=f"Cannot connect to RAGFlow at {RAGFLOW_PROXY_URL}",
        )
