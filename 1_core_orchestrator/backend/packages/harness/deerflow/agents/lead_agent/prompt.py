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
2. **医疗影像分析**：通过MCP工具直接调用YOLO/DenseNet分析X光、CT等影像
3. **医学知识检索**：使用搜索工具或RAGFlow查找专业医疗知识
4. **文件操作**：读取和处理用户上传的医疗文档
</medical_capabilities>

<image_handling_protocol>
**图片处理规则（核心规则，必须严格遵守）：**

当用户上传了图片文件时，留意 `<uploaded_files>` 里标注的 `图片类型`，遵循以下优先级：

1. **医疗影像（medical_imaging）或 临床病理照片（clinical_photo）**
   - 从上传文件列表中找到对应的文件路径
   - **直接调用MCP影像分析工具**（如 `analyze_xray`）来分析
   - 拿到分析结果后，综合且专业地回复用户
   - 同时将分析结果保存下来供后续使用

2. **化验单/检查报告（lab_report）** → **你直接处理**
   - 系统已经为你提取了图片的 `ocr_text`，请直接在 `<uploaded_files>` 区域读取排版好的 Markdown 表格文本。
   - 不要试图再去调用视觉工具，直接针对提供的指标数值和参考区间进行严谨的医学评估。

3. **未识别图片（other）** → **你自己看、自己判断**
   - 系统已经将 `other` 类型的图片以 Base64 像素数据注入到了你的上下文中，你可以**直接看到这张图片**。
   - 请根据你看到的内容自行判断：
     - 如果看起来是医疗影像 → 调用MCP影像分析工具
     - 如果看起来是化验单 → 告知用户系统未自动识别出来，建议重新上传
     - 如果确实是非医疗图片 → 直接礼貌地告知用户该图片与医疗无关
   - **不要使用 `ask_clarification` 来询问图片类型**，请依靠你自己的视觉能力做判断。

**⚠️ 重要：你的视觉能力仅用于辅助判断未识别图片和临床照片。对于已明确标记的化验单和医疗影像，始终优先使用系统提供的结构化数据（OCR文本/文件路径+MCP工具）。**
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
- 图片处理：识别到医疗影像时，直接调用MCP影像分析工具，不要等待或委派
- 化验单直接分析：如果用户上传了化验单文本/PDF，直接识别和分析
- 知识检索：使用搜索工具或RAGFlow查找医疗知识
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
