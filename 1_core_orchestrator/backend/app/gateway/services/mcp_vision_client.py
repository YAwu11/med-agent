"""
Unified MCP Vision Client.

All callers (automated pipeline, manual doctor review, or Agent tool calls)
communicate with the standalone MCP Vision service (Port 8002) through this module.
"""

import os
import json
from loguru import logger


MCP_VISION_URL = os.getenv("MCP_VISION_URL", "http://127.0.0.1:8002/sse")

# [CRITICAL FIX] 绕过系统级代理（Clash/V2ray 等），防止本地回环请求被网关拦截导致 502 Bad Gateway
if "127.0.0.1" in MCP_VISION_URL or "localhost" in MCP_VISION_URL:
    existing_no_proxy = os.environ.get("NO_PROXY", "")
    new_no_proxy = "127.0.0.1,localhost"
    if existing_no_proxy:
        os.environ["NO_PROXY"] = f"{new_no_proxy},{existing_no_proxy}"
    else:
        os.environ["NO_PROXY"] = new_no_proxy

async def analyze_xray(image_path: str, enable_sam: bool = False) -> dict:
    """Invokes the standalone MCP Vision service to analyze a chest X-ray.
    
    Args:
        image_path: Absolute path to the local image file.
        enable_sam: Whether to enable accurate MedSAM segmentation.
        
    Returns:
        A structured analysis dict containing 'summary', 'findings', etc.
        
    Raises:
        ConnectionError: If the MCP Vision service is down.
        RuntimeError: If the analysis process fails on the server.
    """
    # Import locally to avoid requiring MCP SDK if this client is never called
    from mcp.client.sse import sse_client
    from mcp.client.session import ClientSession

    try:
        async with sse_client(MCP_VISION_URL) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool("analyze_xray", {
                    "image_path": image_path,
                    "enable_sam": enable_sam,
                })
                
                data = json.loads(result.content[0].text)
                if "error" in data:
                    raise RuntimeError(data["error"])
                return data
    except Exception as e:
        logger.error(f"MCP Vision call failed: {e}")
        raise

async def check_health() -> bool:
    """Check if the standalone MCP Vision service is online."""
    import httpx
    health_url = MCP_VISION_URL.replace("/sse", "/health")
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(health_url)
            return resp.status_code == 200
    except Exception:
        return False
