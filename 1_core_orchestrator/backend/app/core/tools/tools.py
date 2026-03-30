import logging

from langchain.tools import BaseTool

from app.core.config import get_app_config
from app.core.reflection import resolve_variable
# [P0-DISABLED] view_image_tool 已停用。P3阶段取消注释恢复。
# from app.core.tools.builtins import ask_clarification_tool, present_file_tool, view_image_tool
from app.core.tools.builtins import ask_clarification_tool, present_file_tool, save_analysis_result_tool
from app.core.tools.builtins.rag_retrieve import rag_retrieve_tool
from app.core.tools.builtins.tool_search import reset_deferred_registry

logger = logging.getLogger(__name__)

BUILTIN_TOOLS = [
    present_file_tool,
    ask_clarification_tool,
    save_analysis_result_tool,  # [Phase7] 非阻塞异步存储，替代旧的 submit_for_review
    rag_retrieve_tool,          # [ADR-014] 知识库检索 (RAGFlow Lite)
]

SUBAGENT_TOOLS = [
    # task_status_tool is no longer exposed to LLM (backend handles polling internally)
]


def get_available_tools(
    groups: list[str] | None = None,
    include_mcp: bool = True,
    model_name: str | None = None,
    subagent_enabled: bool = False,
) -> list[BaseTool]:
    """Get all available tools from config.

    Note: MCP tools should be initialized at application startup using
    `initialize_mcp_tools()` from app.core.mcp module.

    Args:
        groups: Optional list of tool groups to filter by.
        include_mcp: Whether to include tools from MCP servers (default: True).
        model_name: Optional model name to determine if vision tools should be included.
        subagent_enabled: Whether to include subagent tools (task, task_status).

    Returns:
        List of available tools.
    """
    config = get_app_config()
    loaded_tools = [resolve_variable(tool.use, BaseTool) for tool in config.tools if groups is None or tool.group in groups]

    # Conditionally add tools based on config
    builtin_tools = BUILTIN_TOOLS.copy()

    # Add subagent tools only if enabled via runtime parameter
    if subagent_enabled:
        builtin_tools.extend(SUBAGENT_TOOLS)
        logger.info("Including subagent tools (task)")

    # If no model_name specified, use the first model (default)
    if model_name is None and config.models:
        model_name = config.models[0].name

    # [P0-DISABLED] view_image_tool 条件加载已停用
    # 原逻辑：当模型supports_vision=true时，将view_image工具加入Agent工具列表
    # 停用原因：配合ViewImageMiddleware停用，阻断Base64编码进入对话上下文
    # [P3-REACTIVATE] 恢复时：
    #   1. 取消文件顶部 view_image_tool import 的注释
    #   2. 取消下方代码的注释
    #   3. 配合P2阶段视觉网关的分类结果，仅对"临床照片"类型启用
    # model_config = config.get_model_config(model_name) if model_name else None
    # if model_config is not None and model_config.supports_vision:
    #     builtin_tools.append(view_image_tool)
    #     logger.info(f"Including view_image_tool for model '{model_name}' (supports_vision=True)")

    # Get cached MCP tools if enabled
    # NOTE: We use ExtensionsConfig.from_file() instead of config.extensions
    # to always read the latest configuration from disk. This ensures that changes
    # made through the Gateway API (which runs in a separate process) are immediately
    # reflected when loading MCP tools.
    mcp_tools = []
    # Reset deferred registry upfront to prevent stale state from previous calls
    reset_deferred_registry()
    if include_mcp:
        try:
            from app.core.config.extensions_config import ExtensionsConfig
            from app.core.mcp.cache import get_cached_mcp_tools

            extensions_config = ExtensionsConfig.from_file()
            if extensions_config.get_enabled_mcp_servers():
                mcp_tools = get_cached_mcp_tools()
                if mcp_tools:
                    logger.info(f"Using {len(mcp_tools)} cached MCP tool(s)")

                    # When tool_search is enabled, register MCP tools in the
                    # deferred registry and add tool_search to builtin tools.
                    if config.tool_search.enabled:
                        from app.core.tools.builtins.tool_search import DeferredToolRegistry, set_deferred_registry
                        from app.core.tools.builtins.tool_search import tool_search as tool_search_tool

                        registry = DeferredToolRegistry()
                        for t in mcp_tools:
                            registry.register(t)
                        set_deferred_registry(registry)
                        builtin_tools.append(tool_search_tool)
                        logger.info(f"Tool search active: {len(mcp_tools)} tools deferred")
        except ImportError:
            logger.warning("MCP module not available. Install 'langchain-mcp-adapters' package to enable MCP tools.")
        except Exception as e:
            logger.error(f"Failed to get cached MCP tools: {e}")

    logger.info(f"Total tools loaded: {len(loaded_tools)}, built-in tools: {len(builtin_tools)}, MCP tools: {len(mcp_tools)}")
    return loaded_tools + builtin_tools + mcp_tools
