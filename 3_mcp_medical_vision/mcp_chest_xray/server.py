#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
MCP Vision Server — 医学影像 AI 分析 MCP 服务
基于 Pipeline V3 (YOLOv8 + PSPNet + DenseNet121 + MedSAM)

启动: python server.py
"""

import os
import sys
import json
import asyncio
import logging
from typing import Any

from starlette.applications import Starlette
from starlette.routing import Route, Mount
from starlette.requests import Request
from starlette.responses import Response
from mcp.server import Server
from mcp.server.sse import SseServerTransport
from mcp.types import Tool, TextContent
import concurrent.futures

# Add parent directory to path for torchxrayvision imports
SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SERVICE_DIR)
sys.path.insert(0, os.path.join(PROJECT_ROOT, "torchxrayvision"))
sys.path.insert(0, SERVICE_DIR)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("mcp-chest-xray-sse")

# Lazy import engine to avoid loading models at import time
_engine = None

def get_engine():
    global _engine
    if _engine is None:
        import engine as eng
        _engine = eng
        # [P0] Pre-load all models at first engine access
        _engine.warmup_models()
    return _engine


# ============================================================
# MCP Server Setup
# ============================================================
mcp_server = Server("mcp-chest-xray-sse")

# [CRITICAL PROTECTION] Global Dedicated Thread for GPU Concurrency
# We use max_workers=1 instead of asyncio.Lock() to prevent Concurrent OOMs.
# If a client disconnects, asyncio cancels the await, but the OS thread cleanly finishes 
# its workload sequentially without releasing a lock prematurely to a concurrent request.
_gpu_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)


@mcp_server.list_tools()
async def list_tools():
    return [
        Tool(
            name="analyze_xray",
            description=(
                "对胸部X光片进行全流程AI分析。"
                "包括: YOLOv8病灶检测(14类)、PSPNet解剖定位(中英文)、"
                "DenseNet121疾病分类(18种概率)、MedSAM精细分割。"
                "返回结构化JSON报告，包含病灶区域、解剖位置、置信度、双肺多发判定等。"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "image_path": {
                        "type": "string",
                        "description": "胸片文件的绝对路径 (支持 jpg/png/bmp)"
                    },
                    "enable_sam": {
                        "type": "boolean",
                        "description": "是否启用MedSAM精细轮廓分割 (默认false，开启可获得更精确轮廓)",
                        "default": False
                    }
                },
                "required": ["image_path"]
            }
        )
    ]


@mcp_server.call_tool()
async def call_tool(name: str, arguments: dict):
    try:
        if name == "analyze_xray":
            image_path = arguments["image_path"]
            enable_sam = arguments.get("enable_sam", False)  # [P0] Default OFF for speed

            if not os.path.exists(image_path):
                return [TextContent(type="text", text=json.dumps({
                    "error": f"Image not found: {image_path}"
                }))]

            logger.info(f"SSE Analyzing: {image_path} (SAM={enable_sam})")
            engine = get_engine()
            loop = asyncio.get_running_loop()
            logger.info("Queued for GPU inference...")
            result = await loop.run_in_executor(
                _gpu_executor, lambda: engine.analyze(image_path, enable_sam=enable_sam)
            )

            logger.info(f"SSE Done: {result.get('summary', {}).get('total_findings', 0)} findings")
            return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]
        else:
            return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]
    except Exception as e:
        logger.error(f"SSE Tool error: {e}", exc_info=True)
        return [TextContent(type="text", text=json.dumps({"error": str(e)}, ensure_ascii=False))]


# ============================================================
# Starlette App — Following MCP SDK Official Pattern
# ============================================================
sse_transport = SseServerTransport("/messages/")

async def handle_sse(request: Request):
    """SSE endpoint — client connects here to receive server-sent events."""
    async with sse_transport.connect_sse(
        request.scope, request.receive, request._send
    ) as streams:
        await mcp_server.run(
            streams[0], streams[1], mcp_server.create_initialization_options()
        )
    return Response()

async def handle_health(request: Request):
    return Response(content='{"status":"ok"}', media_type="application/json")


app = Starlette(
    debug=False,
    routes=[
        Route("/sse", endpoint=handle_sse),
        Mount("/messages/", app=sse_transport.handle_post_message),
        Route("/health", endpoint=handle_health),
    ],
)

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting Cloud-Ready MCP SSE Server on port 8002...")
    uvicorn.run(app, host="0.0.0.0", port=8002)

