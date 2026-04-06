#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
MCP Brain Tumor Vision Server — 脑部 3D NIfTI 分析 MCP 服务
基于 Python MCP (Model Context Protocol) 架构解耦。

启动: python server.py
"""

import os
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

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("mcp-brain-tumor-sse")

_engine = None

def get_engine():
    global _engine
    if _engine is None:
        import engine_3d as eng
        _engine = eng
    return _engine

mcp_server = Server("mcp-brain-tumor-sse")

@mcp_server.list_tools()
async def list_tools():
    return [
        Tool(
            name="analyze_brain_tumor_nifti",
            description=(
                "对脑部 3D MRI 数据包 (NIfTI格式) 进行人工智能切片与分析。"
                "包括: nnU-Net 3D 体素级肿瘤分割、ANTs 空间影像配准与 MNI 坐标系统换算。"
                "返回体积量化、脑区重叠度的空间结构化数据及对比图渲染路径。"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "nifti_dir": {
                        "type": "string",
                        "description": "包含 T1, T1ce, T2, FLAIR 等序列的 .nii.gz 文件夹的绝对路径"
                    },
                    "original_filename": {
                        "type": "string",
                        "description": "原始上传文件名或标识符"
                    }
                },
                "required": ["nifti_dir"]
            }
        )
    ]

@mcp_server.call_tool()
async def call_tool(name: str, arguments: dict):
    try:
        if name == "analyze_brain_tumor_nifti":
            nifti_dir = arguments["nifti_dir"]
            original_filename = arguments.get("original_filename", "unknown")

            if not os.path.exists(nifti_dir):
                logger.error(f"Directory not found: {nifti_dir}")
                return [TextContent(type="text", text=json.dumps({
                    "error": f"NIfTI directory not found: {nifti_dir}"
                }))]

            logger.info(f"SSE Analyzing NIfTI Directory: {nifti_dir}")
            engine = get_engine()
            
            # Since the NIfTI analysis contains heavily synchronous C calls (nibabel, ants), 
            # we should run it in a threadpool to prevent Starlette event loop blocking.
            loop = asyncio.get_running_loop()
            
            # call the async wrapper inside engine
            # engine.run_pipeline is expected to be an async function
            result = await engine.run_pipeline(nifti_dir, original_filename)

            logger.info(f"SSE Done: generated spatial info successfully")
            return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]
        else:
            return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]
    except Exception as e:
        logger.error(f"SSE Tool error: {e}", exc_info=True)
        return [TextContent(type="text", text=json.dumps({"error": str(e)}, ensure_ascii=False))]

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
    logger.info("Starting Brain Tumor 3D Pipeline MCP Server on port 8003...")
    uvicorn.run(app, host="0.0.0.0", port=8003)
