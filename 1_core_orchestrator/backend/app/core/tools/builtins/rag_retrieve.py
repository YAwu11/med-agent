"""
rag_retrieve — 原生 LangChain 工具，调用 RAGFlow Lite 知识库检索

ADR-014: 通过 HTTP 直接调用 RAGFlow Lite 的 /api/tool/retrieve 端点
ADR-016: enable_web_search 硬编码 False，网络搜索由 Tavily 独立负责

NOTE: 使用 aiohttp 替代 httpx，因为 httpx 0.28+ 的连接管理
      在 Windows 上与 uvicorn --reload 模式不兼容（空 502）。
"""
import logging
import os

import aiohttp
from langchain.tools import tool

from deerflow.runtime_errors import FatalToolExecutionError

logger = logging.getLogger(__name__)

RAGFLOW_URL = os.getenv("RAGFLOW_URL", "http://127.0.0.1:9380")


def _raise_fatal_rag_error(message: str) -> None:
    raise FatalToolExecutionError(message)


@tool("rag_retrieve", parse_docstring=True)
async def rag_retrieve_tool(
    query: str,
    kb_ids: list[str] = [],
    mode: str = "hybrid",
    top_k: int = 5,
    folder: str = "",
) -> str:
    """从医学知识库中检索与问题相关的文档片段和诊疗指南。

    支持三种检索模式:
    - fast: 低延迟混合检索，适合简单问答 (~200ms)
    - hybrid: 含知识图谱推理，适合需要关联推理的场景 (~500ms，默认)
    - deep: 含 CRAG 纠错路由，最准确但较慢 (~1-3s)

    kb_ids 留空则搜索全部知识库。可通过 folder 参数按科室过滤(如 "/影像科")。

    Args:
        query: 要检索的医学问题
        kb_ids: 知识库 ID 列表，留空则搜索全部知识库
        mode: 检索模式，可选 fast / hybrid / deep
        top_k: 返回的最相关文档片段数量
        folder: 按文件夹过滤知识库范围(如 "/影像科")，留空搜全部
    """
    if not query or not query.strip():
        return "请提供具体的检索问题。"

    payload = {
        "query": query.strip(),
        "kb_ids": kb_ids if kb_ids else [],
        "mode": mode if mode in ("fast", "hybrid", "deep") else "hybrid",
        "top_k": top_k,
        "folder": folder,
        "enable_web_search": False,  # ADR-016: 网络搜索由 Tavily 负责
    }

    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                f"{RAGFLOW_URL}/api/tool/retrieve",
                json=payload,
            ) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    logger.error(f"rag_retrieve HTTP {resp.status}: {text[:200]}")
                    _raise_fatal_rag_error(
                        f"知识库检索服务不可用，RAGFlow Lite 返回 HTTP {resp.status}。"
                        f" 请检查 {RAGFLOW_URL} 是否可访问，并确认 9380 端口服务已启动。"
                    )

                data = await resp.json()

        answer_context = data.get("answer_context", "")
        if not answer_context or answer_context.strip() == "":
            return "知识库中未找到与该问题相关的内容。"

        # 附加元数据摘要供 Agent 参考
        metadata = data.get("metadata", {})
        latency = metadata.get("latency_ms", 0)
        source_count = metadata.get("source_count", 0)
        used_mode = metadata.get("mode", mode)
        crag_info = ""
        if metadata.get("crag_score"):
            crag_info = f"\nCRAG 评分: {metadata['crag_score']} | 原因: {metadata.get('crag_reason', '')}"

        footer = f"\n\n---\n检索模式: {used_mode} | 来源数: {source_count} | 耗时: {latency}ms{crag_info}"
        return answer_context + footer

    except TimeoutError:
        logger.warning(f"rag_retrieve timeout connecting to {RAGFLOW_URL}")
        _raise_fatal_rag_error(
            f"知识库检索服务响应超时。请检查 {RAGFLOW_URL} 是否健康，并确认本地 RAG 服务没有卡死。"
        )
    except aiohttp.ClientError as e:
        logger.error(f"rag_retrieve connection error: {e}")
        _raise_fatal_rag_error(
            f"知识库检索服务连接失败：{e}。请确认 RAGFlow Lite 已启动，并监听 {RAGFLOW_URL}。"
        )
    except Exception as e:
        logger.error(f"rag_retrieve unexpected error: {e}", exc_info=True)
        _raise_fatal_rag_error(
            f"知识库检索发生内部错误：{e}。当前运行已中断，请先修复 RAG 服务后再重试。"
        )
