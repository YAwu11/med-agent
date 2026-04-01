from datetime import datetime

from deerflow.skills import load_skills


# [Phase7] 子Agent调度部分已完全移除。主Agent直接调用MCP工具。
# 保留函数签名供 apply_prompt_template 兼容调用，但返回空字符串。
def _build_subagent_section(max_concurrent: int) -> str:
    """[Phase7-DISABLED] Subagent section removed. Main agent calls tools directly."""
    return ""


SYSTEM_PROMPT_TEMPLATE = """
<role>
你是 MedAgent，一个专业的医疗AI助手。
你的职责是帮助用户进行化验单识别、医疗影像分析、以及医疗知识检索。
你直接调用可用的工具来完成任务，不需要委派给任何子Agent。
</role>

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

<working_directory existed="true">
- 用户上传文件: `/mnt/user-data/uploads` - 用户上传的文件（自动列出）
- 工作目录: `/mnt/user-data/workspace` - 临时文件工作目录
- 输出文件: `/mnt/user-data/outputs` - 最终交付物保存位置

**文件管理：**
- 上传的文件会自动列在 <uploaded_files> 区域
- 使用 `read_file` 工具读取上传的文件
- PDF、PPT、Excel、Word 文件旁会有转换后的 Markdown 版本 (*.md)
- 最终输出使用 `present_file` 工具呈现
</working_directory>

<response_style>
- 专业准确：使用规范的医学术语，同时保持易懂
- 结构清晰：分析结果分条列出，重点标注异常值
- 安全提醒：始终提醒AI分析仅供参考，最终诊断需由专业医生做出
- 使用中文回复
</response_style>

<critical_reminders>
- 图片处理：系统已自动完成影像分析，你只需阅读 `<uploaded_files>` 中的结果为患者解读。仅当 CLIP 误分类（标签为 other）且你判断确实是医学影像时，才主动调用 `analyze_xray`
- 化验单直接分析：如果用户上传了化验单文本/PDF，直接读取 OCR 结果进行分析
- 知识检索：使用 rag_retrieve 工具从本地知识库检索，或使用 web_search 搜索公网资料
- 输出文件：最终交付物必须保存到 `/mnt/user-data/outputs`
- 并行工具调用：尽量并行调用多个工具以提升效率
- 免责声明：每次医疗分析结果末尾必须加上免责声明
- 始终回复：思考过程是内部的，你必须始终提供可见的回复
- 初步建议：你给出的是初步AI建议，最终诊断由医生在独立的审核台上完成
</critical_reminders>
"""


def get_skills_prompt_section(available_skills: set[str] | None = None) -> str:
    """Generate the skills prompt section with available skills list.

    Returns the <skill_system>...</skill_system> block listing all enabled skills,
    suitable for injection into any agent's system prompt.
    """
    skills = load_skills(enabled_only=True)

    try:
        from deerflow.config import get_app_config

        config = get_app_config()
        container_base_path = config.skills.container_path
    except Exception:
        container_base_path = "/mnt/skills"

    if not skills:
        return ""

    if available_skills is not None:
        skills = [skill for skill in skills if skill.name in available_skills]

    skill_items = "\n".join(
        f"    <skill>\n        <name>{skill.name}</name>\n        <description>{skill.description}</description>\n        <location>{skill.get_container_file_path(container_base_path)}</location>\n    </skill>" for skill in skills
    )
    skills_list = f"<available_skills>\n{skill_items}\n</available_skills>"

    return f"""<skill_system>
你可以使用以下医疗技能来处理专业任务。每个技能包含针对特定医疗场景的最佳实践和工作流程。

**使用方式：**
1. 当用户请求匹配某个技能时，使用 `read_file` 读取技能文件
2. 按照技能中的指引执行任务

**技能目录：** {container_base_path}

{skills_list}

</skill_system>"""


def get_agent_soul(agent_name: str | None) -> str:
    """Medical scenario does not use SOUL.md. Returns empty string."""
    return ""


def get_deferred_tools_prompt_section() -> str:
    """Generate <available-deferred-tools> block for the system prompt.

    Lists only deferred tool names so the agent knows what exists
    and can use tool_search to load them.
    Returns empty string when tool_search is disabled or no tools are deferred.
    """
    from deerflow.tools.builtins.tool_search import get_deferred_registry

    try:
        from deerflow.config import get_app_config

        if not get_app_config().tool_search.enabled:
            return ""
    except FileNotFoundError:
        return ""

    registry = get_deferred_registry()
    if not registry:
        return ""

    names = "\n".join(e.name for e in registry.entries)
    return f"<available-deferred-tools>\n{names}\n</available-deferred-tools>"


def apply_prompt_template(subagent_enabled: bool = False, max_concurrent_subagents: int = 3, *, agent_name: str | None = None, available_skills: set[str] | None = None) -> str:
    # [Phase7] subagent_enabled 参数保留签名兼容，但始终忽略
    subagent_section = ""
    subagent_reminder = ""

    # Get skills section
    skills_section = get_skills_prompt_section(available_skills)

    # Get deferred tools section (tool_search)
    deferred_tools_section = get_deferred_tools_prompt_section()

    # Format the prompt with dynamic skills (no soul, no memory, no subagent)
    prompt = SYSTEM_PROMPT_TEMPLATE.format(
        skills_section=skills_section,
        deferred_tools_section=deferred_tools_section,
        subagent_section=subagent_section,
        subagent_reminder=subagent_reminder,
    )

    return prompt + f"\n<current_date>{datetime.now().strftime('%Y-%m-%d, %A')}</current_date>"
