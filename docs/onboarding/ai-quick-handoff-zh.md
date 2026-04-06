# MedAgent AI 快速接手文档 (AI Onboarding Protocol)

**本文档专为后续介入开发的 AI 智能体（Agent）或大语言模型（LLM）编写，而非普通终端用户。**
核心目的是帮助新接入的 AI 快速构建全景上下文，精准避坑，并严格遵守项目的架构操守与执行规范。

---

## 1. 核心架构与物理隔离拓扑 🏛️

本项目是一个不断演进的多模态医疗智能工作台。当前处于 **微服务化与管线极简重构期**。请谨防陈旧文档的误导：

### 1.1 核心服务网格 (Active Control Plane)
- **`1_core_orchestrator/`**：系统的“心脏”与总线调度层。
  - **后端 (FastAPI Gateway)**: 串联业务数据库 (`case_db`)、LangGraph 诊断流 (`deerflow`) 与多模态解析器 (Analyzers)。
    - *架构红线*: `packages/harness/deerflow/` (状态机引擎层) 绝对禁止导入 `app/` (实际业务网关层) 的代码。
  - **前端 (Next.js)**: 沉浸式医生诊断工作台 (Workspace / Queue / Brain UI 等高定界面)。
- **`2_mcp_ragflow_lite/`**：私有轻量级医学文献与知识库 RAG 服务。不要与里面嵌套的 `ragflow/ragflow` 上游源码混淆，我们主要修改并使用的是 Lite 层的 API (`api/app.py`)。

### 1.2 高性能视觉认知设施 (Vision & OCR Pipelines)
- **医学文档解析管线 (`analyzers/lab_ocr.py` & `paddle_ocr.py`)**：
  - *架构演进*: 全面抛弃基于硬编码探针(`ocr_patterns.py`)的“格式嗅探+后处理”旧模式。现彻底采用 **通用大一统清洗 (Universal Layout Formatting)** 策略，依靠强大的 System Prompt 配合 `Pro/Qwen/Qwen2.5-7B-Instruct` 大脑，实现高度动态自适应对齐。
  - *数据清洗铁律*: 医疗结构化数据在输出时，**极其严格地禁止包裹 LaTeX 语法** (如 `\(\uparrow\)`，`\(\mu\)` ) 以防前端图表库的数学渲染器崩溃，强制采用纯文本 Unicode 符号。
  - *极强可观测性*: 所有结构化解析会在系统数据目录下，强制自动伴生生成侧边车文件 (`.raw_ocr.txt` 与 `.qwen_cleaned.md`)。排错时借此隔离观察“底层视觉瞎眼”与“上层文本清洗幻觉”。
- **病灶影像级空间挂载 (`3_mcp_medical_vision/`)**：
  - 此目录建设中已非“空壳”。正逐步纳入 `mcp_chest_xray` (YOLO 权重推理)、`brain_tumor_pipeline` 等外挂服务。注意隔离其作为纯独立微服务存在的边界。

---

## 2. 架构决策与开发调试哲学 📐

作为高阶 AI，你不仅是代码实现者，更是**系统架构共同维护体系的一环**。
执行进阶任务时，请必须遵循 `@[/architecture]` 及 `@[/systematic-debugging]` 核心决策框架：

1. **谋定后动 (Systematic Planning)**
   - 面对横跨前后端、引入新生态特性、或改变持久化状态机拓扑的复杂动作，必须输出 **实施方案计划 (Implementation Plan)**，如有核心变动需编写 **ADR (Architecture Decision Record)**（存于 `docs/plans/`）。
2. **极简主义优先法则 (Simplicity First)**
   - 绝不提前引入非必要的复杂化抽象。
   - **“如果一个问题能通过调整 Prompt 优雅而稳定地解决，就绝不在业务代码层追加生硬死板的正则后处理 Hack”**。
3. **铁腕系统排障流 (Systematic Debugging)**
   - **全面禁止抛硬币式试错（Guess & Check）！**
   - 遭遇任何 `Traceback` 脱轨或输出错位，须严格走四步闭环：**收集完整错误栈及现象 → 查看上下游伴生的证据文件（如原始文本与终态文本对比） → 做出确定性归因 (Root Cause) → 定向、极简斩除病根**。

---

## 3. 持久化与生命周期 (State & Persistence)

本项目已摆脱单薄的“对话记忆”，是一个真正可溯源持久化的复杂医疗级应用：
- **诊断病例总控舱 (`cases.db`)**:
  - 管理整个患者诊疗闭环的全量切片数据：`case_id`、主诉信息、草表笔记、以及最重要的 **影像检验佐证收集录（Evidence Desk）**。
  - 在 `1_core_orchestrator/backend/app/gateway/services/case_db.py` 查阅其复杂的 SQLite ORM 和级联关系。切勿将本系统与 LangGraph 底层原生的 Thread Schema 混淆覆盖。
- **物理沙盒与数字孪生目录**:
  - 医生上传的一切实体材料会固定落位于 `.deer-flow/threads/[thread_id]/user-data/uploads/` 并在同一层级孵化出衍生物（脑瘤 3D 坐标数组、血常规清洗表等），确保证据链时刻具备抗篡改追溯性。

---

## 4. 端口与网络拓扑速记字典 🔌

在需要注入命令行校验环境状态时，注意以下预设微服务挂载点：
- **前端医生核心沉浸面板 (Web App)**：`http://127.0.0.1:3000`
- **中枢指挥网关 (FastAPI Gateway)**：`http://127.0.0.1:8001`
- **轻型医学知识库检索引擎 (RAGFlow Lite)**：`http://127.0.0.1:9380`
- **LangGraph Agentic Flow 时序控制台**：`http://127.0.0.1:2024`

*(若遇网络不通，请立即核查 `1_core_orchestrator/scripts/serve.sh` 启动时序锁的并发情况。)*

---

## 5. 每日编码斩切自检红线 🔪

敲下你的虚拟键盘前，大声在你的思维流中默念：
1. **[防幻觉检查]**：对于我将要修改的新模块包，我是否已经用 `view_file` 命令确认过它真实的文件级存在？
2. **[视觉感知盲区边界]**：如果 OCR 流在某列遗失了某个“向下的箭头 ↓”，我会优先检查 `.raw_ocr.txt`。我要明白如果第一级视觉感知模型（VLM）的视网膜没捕捉到，第二级文字清洗模型再聪明也无法凭空捏造。绝对不能甩锅发懵！
3. **[测试校验护城河]**：我所作的系统级更改是否通过了对应语言环境的 `pytest` 或 `pnpm typecheck` 质量检查以排除低级语法碎屑污染？

> **THE IRON LAW**: *Codes don't lie, but obsolete documentation might.* Always verify the physical file reality, embrace simplicity, investigate root causes ruthlessly avoiding hacks, and execute systematically.
