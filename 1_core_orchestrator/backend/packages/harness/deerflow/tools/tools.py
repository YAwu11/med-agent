import logging

from langchain.tools import BaseTool

from deerflow.config import get_app_config
from deerflow.reflection import resolve_variable
# [P0-DISABLED] view_image_tool 已停用。P3阶段取消注释恢复。
# from deerflow.tools.builtins import ask_clarification_tool, present_file_tool, task_tool, view_image_tool
from deerflow.tools.builtins import ask_clarification_tool, present_file_tool
# [Phase7] submit_for_review_tool 和 task_tool 已移除
from deerflow.tools.builtins.tool_search import reset_deferred_registry

# [Strangler Fig Migration] 临时反向依赖 app.core 获取最新核心工具
from app.core.tools.builtins.rag_retrieve import rag_retrieve_tool
from app.core.tools.builtins.update_patient_info import update_patient_info_tool
from app.core.tools.builtins.preview_appointment import preview_appointment_tool
from app.core.tools.builtins.show_medical_record import show_medical_record_tool
from app.core.tools.builtins.read_patient_record import read_patient_record_tool

logger = logging.getLogger(__name__)

PATIENT_INTAKE_BUILTIN_TOOLS = [
    ask_clarification_tool,
    update_patient_info_tool,
    show_medical_record_tool,
    read_patient_record_tool,
    preview_appointment_tool,
]

BUILTIN_TOOLS = [
    present_file_tool,
    ask_clarification_tool,
    # [Strangler Fig Migration] 挂载 app.core 侧最新的业务工具
    update_patient_info_tool,       # 患者信息提取
    preview_appointment_tool,       # 挂号预览
    show_medical_record_tool,       # 病历单展示
    read_patient_record_tool,       # 诊断前读取完整病例快照
    rag_retrieve_tool,              # 知识库检索 (RAGFlow Lite)
]


def get_available_tools(
    groups: list[str] | None = None,
    include_mcp: bool = True,
    model_name: str | None = None,
    subagent_enabled: bool = False,
    profile: str | None = None,
) -> list[BaseTool]:
    """Get all available tools from config.

    Note: MCP tools should be initialized at application startup using
    `initialize_mcp_tools()` from deerflow.mcp module.

    Args:
        groups: Optional list of tool groups to filter by.
        include_mcp: Whether to include tools from MCP servers (default: True).
        model_name: Optional model name to determine if vision tools should be included.
        subagent_enabled: Whether to include subagent tools (task, task_status).

    Returns:
        List of available tools.
    """
    config = get_app_config()

    if profile == "patient_intake":
        logger.info("Using patient-intake tool profile with %s tools", len(PATIENT_INTAKE_BUILTIN_TOOLS))
        return PATIENT_INTAKE_BUILTIN_TOOLS.copy()

    loaded_tools = [resolve_variable(tool.use, BaseTool) for tool in config.tools if groups is None or tool.group in groups]

    # Conditionally add tools based on config
    builtin_tools = BUILTIN_TOOLS.copy()

    # [Phase7] 子Agent工具已移除，主Agent直接调用MCP工具

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
            from deerflow.config.extensions_config import ExtensionsConfig
            from deerflow.mcp.cache import get_cached_mcp_tools

            extensions_config = ExtensionsConfig.from_file()
            if extensions_config.get_enabled_mcp_servers():
                mcp_tools = get_cached_mcp_tools()
                if mcp_tools:
                    logger.info(f"Using {len(mcp_tools)} cached MCP tool(s)")

                    # When tool_search is enabled, register MCP tools in the
                    # deferred registry and add tool_search to builtin tools.
                    if config.tool_search.enabled:
                        from deerflow.tools.builtins.tool_search import DeferredToolRegistry, set_deferred_registry
                        from deerflow.tools.builtins.tool_search import tool_search as tool_search_tool

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
