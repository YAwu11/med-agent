"""
Native LangGraph orchestration for the Patient Intake Agent.
This replaces the heavy deerflow subagent wrappers under the Strangler Fig pattern.
"""
import logging
from typing import Annotated, NotRequired

from langchain_core.messages import SystemMessage
from langgraph.graph import MessagesState, StateGraph, START, END
from langgraph.prebuilt import ToolNode
from langchain_core.runnables import RunnableConfig

from typing import TypedDict

class SandboxState(TypedDict):
    sandbox_id: NotRequired[str | None]

class ThreadDataState(TypedDict):
    workspace_path: NotRequired[str | None]
    uploads_path: NotRequired[str | None]
    outputs_path: NotRequired[str | None]

class ViewedImageData(TypedDict):
    base64: str
    mime_type: str

def merge_artifacts(existing: list[str] | None, new: list[str] | None) -> list[str]:
    if existing is None: return new or []
    if new is None: return existing
    return list(dict.fromkeys(existing + new))

def merge_viewed_images(existing: dict[str, ViewedImageData] | None, new: dict[str, ViewedImageData] | None) -> dict[str, ViewedImageData]:
    if existing is None: return new or {}
    if new is None: return existing
    if len(new) == 0: return {}
    return {**existing, **new}

SYSTEM_PROMPT_TEMPLATE = """
<role>
你是 MedAgent，一个面向患者的专业医疗AI助手。
你的职责是帮助患者进行初步的化验单识别、医疗影像分析、以及医疗知识检索，并给出初步建议。

**重要定位：**
- 你是患者端的AI助手，你的回复对象是患者。
- 你给出的是初步参考建议，最终诊断由医生在独立的医生工作台上完成。
- 分析完成后，你需要将结果异步保存到系统中（使用 `save_analysis_result`），供医生后续审核。
</role>

<medical_capabilities>
**你可以直接处理的任务：**
1. **化验单识别与分析**：识别用户上传的化验单（血常规、生化、免疫等），解读各项指标
2. **医疗影像分析**：直接调用 MCP 影像分析工具识别 X 光、CT 等影像
3. **医学知识库检索**：使用 rag_retrieve 工具从本地医学知识库检索诊疗指南、药物信息、检验参考值等专业资料
4. **网络搜索**：使用 web_search 工具搜索最新的医疗资讯和文献
5. **文件操作**：读取和处理用户上传的医疗文档
</medical_capabilities>

<image_handling_protocol>
**图片处理编排规则（核心规则，必须严格遵守）：**

当用户上传了图片文件时，留意 `<uploaded_files>` 里标注的 `图片类型`，遵循以下优先级：

1. **医疗影像（medical_imaging）或 临床病理照片（clinical_photo）** → **直接调用MCP工具分析**
   - 从上传文件列表中找到对应的文件路径
   - 直接调用 MCP 影像分析工具（如 `analyze_xray`）获取结构化结果
   - 收到结果后，调用 `save_analysis_result` 将AI分析结果异步存入系统供医生审核
   - 然后综合且专业地为患者提供初步建议

2. **化验单/检查报告（lab_report）** → **你直接处理**
   - 系统已经为你提取了图片的 `ocr_text`，请直接在 `<uploaded_files>` 区域读取排版好的 Markdown 表格文本。
   - 不要试图再去调用视觉工具，直接针对提供的指标数值和参考区间进行严谨的医学评估。

3. **未识别图片（other）** → **你自己看、自己判断**
   - 依靠视觉模型自行判断。
</image_handling_protocol>

{skills_section}
{deferred_tools_section}
{subagent_section}
"""

from app.core.models import create_chat_model
from app.core.tools import get_available_tools

logger = logging.getLogger(__name__)

class PatientState(MessagesState):
    sandbox: NotRequired[SandboxState | None]
    thread_data: NotRequired[ThreadDataState | None]
    title: NotRequired[str | None]
    artifacts: Annotated[list[str], merge_artifacts]
    todos: NotRequired[list | None]
    uploaded_files: NotRequired[list[dict] | None]
    viewed_images: Annotated[dict[str, ViewedImageData], merge_viewed_images]


def call_model(state: PatientState, config: RunnableConfig):
    cfg = config.get("configurable", {})
    model_name = cfg.get("model_name") or cfg.get("model")
    thinking_enabled = cfg.get("thinking_enabled", False)
    
    # OPTIMIZATION: Instead of using subagents (task_tool) to call MCP vision models,
    # we flatten the architecture and include MCP tools DIRECTLY on the primary patient agent.
    # This bypasses the entire 'imaging-agent' delegation loop, saving 5+ seconds and tokens.
    tools = get_available_tools(model_name=model_name, subagent_enabled=False, include_mcp=True)
    
    model = create_chat_model(name=model_name, thinking_enabled=thinking_enabled)
    model_with_tools = model.bind_tools(tools)
    
    # We clean the system prompt since we dropped subagents and deferred tools overhead
    sys_prompt_text = SYSTEM_PROMPT_TEMPLATE.format(
        skills_section="",
        deferred_tools_section="",
        subagent_section="""<subagent_system>\n你不再需要子Agent。如果你需要分析医疗影像，请直接调用 MCP 视觉工具完成。\n</subagent_system>"""
    )
    
    messages = [SystemMessage(content=sys_prompt_text)] + state["messages"]
    logger.info(f"PatientGraph Native Execution: invoking model '{model_name}' with {len(tools)} tools.")
    
    response = model_with_tools.invoke(messages, config=config)
    return {"messages": [response]}

def should_continue(state: PatientState):
    messages = state["messages"]
    last_message = messages[-1]
    
    # If the LLM generates a tool call, route to tools execution node.
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    # Otherwise end interaction.
    return END

# Build the generic tools executor
# ToolNode natively handles tool execution via langgraph prebuilt.
_tools_lazy = get_available_tools(model_name=None, subagent_enabled=False, include_mcp=True)
if not _tools_lazy:
    # Fail-safe empty ToolNode prevention
    logger.warning("No tools found, creating dummy tool node configuration.")
    def dummy_tool(): pass
    _tools_lazy = [dummy_tool]

tool_node = ToolNode(_tools_lazy)

# Define Graph Topology (Simple linear cyclic loop)
workflow = StateGraph(PatientState)

workflow.add_node("agent", call_model)
workflow.add_node("tools", tool_node)

workflow.add_edge(START, "agent")
workflow.add_conditional_edges("agent", should_continue)
workflow.add_edge("tools", "agent")

# Compile the native LangGraph
graph = workflow.compile()
