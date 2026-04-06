import os
import json
import asyncio
import httpx
from loguru import logger
from typing import Dict, Any, Optional

BRAIN_MCP_SERVER_URL = "http://localhost:8003/sse"

# [CRITICAL FIX] 绕过系统级代理（Clash/V2ray 等），防止本地回环请求被网关拦截导致 502 Bad Gateway
if "127.0.0.1" in BRAIN_MCP_SERVER_URL or "localhost" in BRAIN_MCP_SERVER_URL:
    existing_no_proxy = os.environ.get("NO_PROXY", "")
    new_no_proxy = "127.0.0.1,localhost"
    if existing_no_proxy and new_no_proxy not in existing_no_proxy:
        os.environ["NO_PROXY"] = f"{new_no_proxy},{existing_no_proxy}"
    elif not existing_no_proxy:
        os.environ["NO_PROXY"] = new_no_proxy

async def analyze_brain_tumor_nifti_mcp(nifti_dir: str, original_filename: str) -> Optional[Dict[str, Any]]:
    """
    通过 HTTP/SSE 协议调用脑瘤 MCP 微服务进行 3D NIfTI 分割分析。
    采用延长 Timeout (600s) 以容忍长时间的渲染与配准。
    """
    from mcp.client.sse import sse_client 
    from mcp.client.session import ClientSession

    logger.info(f"[BrainMCP Client] Connecting to {BRAIN_MCP_SERVER_URL} for NIfTI analysis")

    try:
        # Increase the connection timeout for heavy 3D compute workloads
        kwargs = {
            "timeout": 600.0
        }
        
        async with sse_client(BRAIN_MCP_SERVER_URL, **kwargs) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()

                tools = await session.list_tools()
                tool_names = [t.name for t in tools.tools]

                if "analyze_brain_tumor_nifti" not in tool_names:
                    logger.error("[BrainMCP Client] Tool 'analyze_brain_tumor_nifti' not found in server.")
                    return None

                logger.info(f"[BrainMCP Client] Calling tool 'analyze_brain_tumor_nifti' for {nifti_dir}")
                
                result = await session.call_tool(
                    "analyze_brain_tumor_nifti",
                    arguments={
                        "nifti_dir": nifti_dir,
                        "original_filename": original_filename
                    }
                )

                if result and result.content:
                    text_content = result.content[0].text
                    try:
                        parsed = json.loads(text_content)
                        if "error" in parsed:
                            logger.error(f"[BrainMCP Client] Server returned error: {parsed['error']}")
                            return None
                        return parsed
                    except json.JSONDecodeError:
                        logger.error(f"[BrainMCP Client] Failed to parse JSON response: {text_content}")
                        return None
                        
        return None

    except Exception as e:
        logger.error(f"[BrainMCP Client] Failed to communicate with Brain MCP Server: {e}")
        return None
