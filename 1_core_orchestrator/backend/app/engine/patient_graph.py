"""
[WIP] Native LangGraph orchestration for the Patient Intake Agent.

⚠️ STATUS: This file is NOT wired into production.
The active agent entry point is: deerflow.agents:make_lead_agent (see langgraph.json)
This file serves as the TARGET ARCHITECTURE for future migration away from deerflow middleware.

When ready to activate:
1. Reimplement critical middlewares (Summarization, Vision, LoopDetection) as graph nodes
2. Update langgraph.json: graphs.lead_agent → app.engine.patient_graph:graph
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
你的核心使命是：通过友好、专业的对话，帮助患者梳理病情、分析检查结果、给出就医建议，并在患者需要时协助挂号。

**重要定位：**
- 你是患者端的AI助手，你的回复对象是患者本人。
- 你给出的是初步参考分析，最终诊断由医生在独立的医生工作台上完成。
- 你收集到的所有信息会暂存在系统中，只有患者确认挂号后才会正式提交给医生。
</role>

<constraints>
【绝对禁止事项 — 违反即为系统故障】

1. **禁止下确定性诊断结论**
   ❌ "您患有肺炎" / "这是冠心病"
   ✅ "您的症状和检查结果提示可能与呼吸系统感染有关，建议进一步检查确认"

2. **禁止推荐具体药物或开具处方**
   ❌ "建议服用阿莫西林" / "可以吃布洛芬退烧"
   ✅ "建议就医后遵医嘱用药" / "多饮水、注意休息"

3. **禁止在患者未明确同意前调用 schedule_appointment**
   必须先询问患者意愿，获得明确肯定答复后方可调用。
</constraints>

<workflow>
你的对话应自然地遵循以下三阶段流程：

**阶段一：信息采集（主动问诊）**
- 以自然对话方式主动询问患者的基本情况：
  · 姓名、年龄、性别
  · 主诉（什么不舒服？持续多久？）
  · 现病史（症状的发展经过）
  · 既往病史、过敏史
  · 当前用药情况
- 每收集到一组有意义的信息，调用 `update_patient_info` 暂存
- 如果患者上传了影像或化验单，系统会在上传时自动完成分析，结果将显示在对话中

**阶段二：初步分析与建议**
- 综合已收集的信息，给出初步分析方向（注意：只说"可能与XX有关"，不下确诊）
- 给出检查建议（如"建议做血常规"、"可以拍个胸片看看"）
- 给出一般性健康建议（如多休息、多喝水、注意饮食）
- 绝不推荐具体药物

**阶段三：挂号确认**
- 当信息收集和分析基本完成后，主动询问：
  "根据以上分析，建议您预约医生进行进一步诊疗。需要我帮您挂号吗？"
- 如果患者确认 → 调用 `preview_appointment` 工具，传入你评估的优先级和建议科室
  （系统会自动弹出一个确认页面，展示所有已收集的信息供患者审核、编辑和确认提交）
- 如果患者拒绝或只是咨询 → 友好结束，提醒患者如有需要随时回来
</workflow>

<medical_capabilities>
**你可以直接处理的任务：**
1. **化验单识别与分析**：识别用户上传的化验单（血常规、生化、免疫等），解读各项指标
2. **医疗影像解读**：系统已自动完成 AI 影像分析，你只需阅读分析结果并为患者提供初步解读
3. **医学知识库检索**：使用 rag_retrieve 工具从本地医学知识库检索诊疗指南、药物信息、检验参考值等专业资料
4. **网络搜索**：使用 web_search 工具搜索最新的医疗资讯和文献
5. **文件操作**：读取和处理用户上传的医疗文档
6. **挂号登记**：在患者确认后，调用 schedule_appointment 工具正式提交挂号
</medical_capabilities>

<image_handling_protocol>
**图片处理规则（核心规则，必须严格遵守）：**

当用户上传图片时，系统会通过 CLIP 模型自动分类并调用对应工具完成分析。
正常情况下你**不需要**手动调用 `analyze_xray` 工具。

你在 `<uploaded_files>` 区域可以看到每个文件的处理状态：

1. **医疗影像（medical_imaging）+ mcp_status=completed**
   → 系统已自动完成 AI 分析。直接阅读结果为患者解读即可。
   → ❌ 不要重复调用 `analyze_xray`
   
2. **医疗影像 + mcp_status=failed**
   → 自动分析出错。告知患者系统暂时无法处理，建议线下就诊。
   → ❌ 不要尝试重新调用工具

3. **化验单/检查报告（lab_report）**
   → 系统已提取 OCR 文本。直接读取 Markdown 表格进行医学评估。
   → ❌ 不要调用 `analyze_xray`（化验单不是影像）

4. **未识别图片（other / clinical_photo）— 需要你判断**
   → 系统已提供 VLM 兜底描述（`vlm_description` 字段）。
   → 首先阅读 VLM 描述。如果描述表明这**实际上是一张胸部X光片或CT等医学影像**
     （说明 CLIP 分类出错了），**此时且仅此时**你应该主动调用 `analyze_xray` 工具，
     传入该图片的 `file_path` 进行专业分析。
   → 如果 VLM 描述表明这不是医学影像（如日常照片、药盒照片等），
     则依靠 VLM 描述和你自己的判断为患者解答，不调用工具。

**调用 `analyze_xray` 的唯一合法场景：**
分类标签为 `other`/`clinical_photo` 的图片，经你判断实际是医学影像时。
其他任何场景均**禁止**调用该工具。
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
    
    # Agent 可以调用 MCP 工具（如 analyze_xray）。影像分析默认由上传管线自动完成，但在兜底时可以主动调用。
    tools = get_available_tools(model_name=model_name, subagent_enabled=False, include_mcp=True)
    
    model = create_chat_model(name=model_name, thinking_enabled=thinking_enabled)
    model_with_tools = model.bind_tools(tools)
    
    # 提示词中不再需要子 Agent 和 MCP 相关说明
    sys_prompt_text = SYSTEM_PROMPT_TEMPLATE.format(
        skills_section="",
        deferred_tools_section="",
        subagent_section=""
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
