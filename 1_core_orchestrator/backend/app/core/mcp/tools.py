"""Load MCP tools using langchain-mcp-adapters."""

import asyncio
import atexit
import concurrent.futures
import logging
import re
from collections.abc import Callable
from typing import Any

from langchain_core.tools import BaseTool

from app.core.config.extensions_config import ExtensionsConfig
from app.core.config.paths import VIRTUAL_PATH_PREFIX, get_paths
from app.core.mcp.client import build_servers_config
from app.core.mcp.oauth import build_oauth_tool_interceptor, get_initial_oauth_headers

logger = logging.getLogger(__name__)

# Global thread pool for sync tool invocation in async environments
_SYNC_TOOL_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=10, thread_name_prefix="mcp-sync-tool")

# Register shutdown hook for the global executor
atexit.register(lambda: _SYNC_TOOL_EXECUTOR.shutdown(wait=False))


# ── Virtual → Host path translation for MCP tools ───────────────────────
# MCP servers run natively on the host (Windows), but the LLM often passes
# virtual sandbox paths like /mnt/user-data/uploads/xxx.png.
# This function deterministically translates them to real host paths so
# the MCP server can locate the files.

_VIRTUAL_UPLOADS_RE = re.compile(r"^/mnt/user-data/uploads/(.+)$")


def _translate_virtual_path(value: str) -> str:
    """Translate a /mnt/user-data/uploads/... virtual path to the real host path.

    Scans all thread upload directories to find the actual file.
    Returns the original value unchanged if no match is found.
    """
    m = _VIRTUAL_UPLOADS_RE.match(value)
    if not m:
        return value

    filename = m.group(1)
    paths = get_paths()
    threads_dir = paths.base_dir / "threads"

    if not threads_dir.exists():
        return value

    # Scan thread directories (most recent first) to find the file
    for thread_dir in sorted(threads_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        candidate = thread_dir / "user-data" / "uploads" / filename
        if candidate.is_file():
            real_path = str(candidate).replace("\\", "/")
            logger.info(f"[MCP-PathTranslate] Translated virtual path to host: {value} -> {real_path}")
            return real_path

    logger.warning(f"[MCP-PathTranslate] Could not find host file for: {value}")
    return value


def _translate_tool_args(kwargs: dict[str, Any]) -> dict[str, Any]:
    """Translate any virtual /mnt/ paths in tool keyword arguments."""
    translated = {}
    for key, val in kwargs.items():
        if isinstance(val, str) and val.startswith("/mnt/user-data/"):
            translated[key] = _translate_virtual_path(val)
        else:
            translated[key] = val
    return translated


def _make_async_tool_wrapper(coro: Callable[..., Any], tool_name: str) -> Callable[..., Any]:
    """Build an asynchronous wrapper for an asynchronous tool coroutine.

    Args:
        coro: The tool's asynchronous coroutine.
        tool_name: Name of the tool (for logging).

    Returns:
        An asynchronous function that translates paths before calling the underlying coroutine.
    """

async def _maybe_intercept_hitl(tool_name: str, result: Any, translated_kwargs: dict[str, Any]) -> Any:
    """Check if the tool call should be intercepted for HITL review.
    
    IMPORTANT: MCP tools use response_format='content_and_artifact', so the
    original `result` is a tuple: (content_list, artifact). We MUST return
    data in the same tuple format, otherwise LangChain raises ValueError.
    """
    # MCP tools often have prefixes like 'server--tool', so use endswith
    if not tool_name.endswith("analyze_xray"):
        return result

    try:
        import asyncio
        import json
        import uuid
        from app.core.config.paths import get_paths
        
        # Remember original format to preserve it on return
        is_tuple = isinstance(result, tuple)
        
        # Extract the thread_id directly from the translated absolute file path
        image_path = str(translated_kwargs.get("image_path", ""))
        thread_id = None
        parts = image_path.replace("\\", "/").split("/")
        
        if "threads" in parts and "user-data" in parts:
            thread_idx = parts.index("threads")
            if len(parts) > thread_idx + 1:
                thread_id = parts[thread_idx + 1]
            
        if not thread_id:
            logger.warning(f"[HITL-Auto] Could not extract thread_id from path: {image_path}")
            return result

        report_id = str(uuid.uuid4())[:8]
        paths = get_paths()
        paths.ensure_thread_dirs(thread_id)
        reports_dir = paths.sandbox_user_data_dir(thread_id) / "imaging-reports"
        reports_dir.mkdir(parents=True, exist_ok=True)
        report_file = reports_dir / f"{report_id}.json"
        
        try:
            # LangChain MCP tool coroutines return a tuple: (content, artifact)
            # where content is a list of dicts: [{'type': 'text', 'text': '{"json": "here"}'}]
            content = result[0] if is_tuple else result
            
            json_text = ""
            if isinstance(content, list):
                texts = []
                for item in content:
                    if hasattr(item, "text"):
                        texts.append(item.text)
                    elif isinstance(item, dict) and "text" in item:
                        texts.append(item["text"])
                    else:
                        texts.append(str(item))
                json_text = "\n".join(texts)
            else:
                json_text = str(content)

            # Sometimes the returned text itself is a string representation of a list of dicts
            # due to double casting. Safe extraction via eval if it looks like python literal
            if json_text.startswith("([{") or json_text.startswith("[{"):
                import ast
                try:
                    parsed = ast.literal_eval(json_text)
                    if isinstance(parsed, tuple):
                        parsed = parsed[0]
                    if isinstance(parsed, list) and len(parsed) > 0 and isinstance(parsed[0], dict):
                        json_text = parsed[0].get("text", json_text)
                except:
                    pass

            ai_result = json.loads(json_text)
        except Exception as e:
            logger.warning(f"[HITL-Auto] Failed to parse analysis result as JSON: {e}. Falling back to raw text.")
            ai_result = {"raw_text": str(result)}
            
        report_data = {
            "report_id": report_id,
            "thread_id": thread_id,
            "status": "pending_review",
            "image_path": image_path,
            "ai_result": ai_result,
            "doctor_result": None,
        }
        report_file.write_text(json.dumps(report_data, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info(f"[HITL-Auto] Intercepted {tool_name}. Report {report_id} written, blocking for doctor review...")
        
        # Poll until doctor submits review
        poll_interval = 2.0
        while True:
            try:
                if not report_file.exists():
                    logger.error(f"[HITL-Auto] Report file {report_file} vanished during polling!")
                    return result
                    
                data = json.loads(report_file.read_text(encoding="utf-8"))
                if data.get("status") == "reviewed":
                    logger.info(f"[HITL-Auto] Report {report_id} reviewed by doctor")
                    reviewed_data = data.get("doctor_result") or data.get("ai_result", {})
                    reviewed_json = json.dumps(reviewed_data, ensure_ascii=False)
                    
                    # CRITICAL: Preserve the original tuple format.
                    # MCP tools use response_format='content_and_artifact'.
                    # LangChain expects (content_str, artifact) — NOT a plain str.
                    if is_tuple:
                        return (reviewed_json, result[1] if len(result) > 1 else None)
                    return reviewed_json
            except Exception as e:
                logger.warning(f"[HITL-Auto] Error reading report file: {e}")
            
            await asyncio.sleep(poll_interval)
            
    except Exception as e:
        logger.error(f"[HITL-Auto] Critical failure in review interception: {e}", exc_info=True)
        return result

def _make_async_tool_wrapper(coro: Callable[..., Any], tool_name: str) -> Callable[..., Any]:
    """Build an asynchronous wrapper for an asynchronous tool coroutine."""

    async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
        translated_kwargs = _translate_tool_args(kwargs)
        try:
            result = await coro(*args, **translated_kwargs)
            return await _maybe_intercept_hitl(tool_name, result, translated_kwargs)
        except Exception as e:
            logger.error(f"Error invoking MCP tool '{tool_name}' via async wrapper: {e}", exc_info=True)
            raise

    return async_wrapper

def _make_sync_tool_wrapper(coro: Callable[..., Any], tool_name: str) -> Callable[..., Any]:
    """Build a synchronous wrapper that also supports HITL interception."""

    def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        # We reuse the async wrapper logic to ensure consistency
        awrap = _make_async_tool_wrapper(coro, tool_name)

        try:
            if loop is not None and loop.is_running():
                future = _SYNC_TOOL_EXECUTOR.submit(asyncio.run, awrap(*args, **kwargs))
                return future.result()
            else:
                return asyncio.run(awrap(*args, **kwargs))
        except Exception as e:
            logger.error(f"Error invoking MCP tool '{tool_name}' via sync wrapper: {e}", exc_info=True)
            raise

    return sync_wrapper


async def get_mcp_tools() -> list[BaseTool]:
    """Get all tools from enabled MCP servers.

    Returns:
        List of LangChain tools from all enabled MCP servers.
    """
    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient
    except ImportError:
        logger.warning("langchain-mcp-adapters not installed. Install it to enable MCP tools: pip install langchain-mcp-adapters")
        return []

    # NOTE: We use ExtensionsConfig.from_file() instead of get_extensions_config()
    # to always read the latest configuration from disk. This ensures that changes
    # made through the Gateway API (which runs in a separate process) are immediately
    # reflected when initializing MCP tools.
    extensions_config = ExtensionsConfig.from_file()
    servers_config = build_servers_config(extensions_config)

    if not servers_config:
        logger.info("No enabled MCP servers configured")
        return []

    try:
        # [CRITICAL FIX] Bypass system proxy for local MCP servers
        # If the user has a local proxy (e.g. Clash on 7890), httpx will route
        # localhost traffic through it, causing '502 Bad Gateway' when the proxy
        # fails to connect to the local port (e.g. 8002).
        import os
        no_proxy_parts = [p for p in os.environ.get("NO_PROXY", "").split(",") if p]
        for local_host in ["localhost", "127.0.0.1", "::1"]:
            if local_host not in no_proxy_parts:
                no_proxy_parts.append(local_host)
        os.environ["NO_PROXY"] = ",".join(no_proxy_parts)
        # Also set lowercase for httpx compatibility
        os.environ["no_proxy"] = os.environ["NO_PROXY"]

        # Create the multi-server MCP client
        logger.info(f"Initializing MCP client with {len(servers_config)} server(s)")

        # Inject initial OAuth headers for server connections (tool discovery/session init)
        initial_oauth_headers = await get_initial_oauth_headers(extensions_config)
        for server_name, auth_header in initial_oauth_headers.items():
            if server_name not in servers_config:
                continue
            if servers_config[server_name].get("transport") in ("sse", "http"):
                existing_headers = dict(servers_config[server_name].get("headers", {}))
                existing_headers["Authorization"] = auth_header
                servers_config[server_name]["headers"] = existing_headers

        tool_interceptors = []
        oauth_interceptor = build_oauth_tool_interceptor(extensions_config)
        if oauth_interceptor is not None:
            tool_interceptors.append(oauth_interceptor)

        client = MultiServerMCPClient(servers_config, tool_interceptors=tool_interceptors, tool_name_prefix=True)

        # Get all tools from all servers
        tools = await client.get_tools()
        logger.info(f"Successfully loaded {len(tools)} tool(s) from MCP servers")
        
        # Patch tools: translate virtual /mnt/ paths AND support sync invocation.
        # CRITICAL: The subagent runs in an async event loop, so it calls
        # tool.coroutine() directly (not tool.func()). We MUST wrap the
        # coroutine to intercept and translate /mnt/ paths, otherwise
        # the MCP server will receive virtual paths it cannot resolve.
        for tool in tools:
            original_coroutine = getattr(tool, "coroutine", None)
            if original_coroutine is not None:
                # Wrap coroutine with path translation (async path)
                tool.coroutine = _make_async_tool_wrapper(original_coroutine, tool.name)
                # Also provide a sync fallback
                if getattr(tool, "func", None) is None:
                    tool.func = _make_sync_tool_wrapper(original_coroutine, tool.name)

        return tools

    except Exception as e:
        logger.error(f"Failed to load MCP tools: {e}", exc_info=True)
        return []
