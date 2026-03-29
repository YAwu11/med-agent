# Phase 7 终极方案：MedAgent 双端分离重构

> **Git 备份点**: `092eebd` (main) — 已 push 至 GitHub，随时可回滚。

---

## 一、总纲（一句话版）

**患者端**保留 DeerFlow 框架的 UI 外壳和流式对话能力，但**砍掉子 Agent**，主 Agent 直接调工具，速度提升 3-5 倍。
**医生端**全新搭建专业后台大屏，**不走 DeerFlow**，用轻量 ReAct Agent（LangChain）一键出报告。
两端共享同一个数据库，通过 Thread ID 异步互通。

---

## 二、系统架构图

```
┌──────────────────────────────────────────────────────┐
│                   Next.js Monolith                    │
│                                                      │
│  /workspace (患者端)           /doctor (医生端)        │
│  ┌──────────────────┐        ┌─────────────────────┐ │
│  │  聊天对话框       │        │  后台控制台大屏      │ │
│  │  消息气泡         │        │  患者队列表格        │ │
│  │  文件上传         │        │  BboxCanvas 审核台   │ │
│  │  Agent 流式回复   │        │  化验单/病历编辑器   │ │
│  │  初步AI建议       │        │  ✨AI综合报告按钮    │ │
│  └──────┬───────────┘        └──────┬──────────────┘ │
└─────────┼───────────────────────────┼────────────────┘
          │                           │
          ▼                           ▼
┌─────────────────────┐     ┌──────────────────────────┐
│  DeerFlow (精简版)   │     │  FastAPI (Doctor API)     │
│  lead_agent 直接调工具│     │  /doctor/generate-report │
│  ❌ 无子Agent        │     │  轻量ReAct → RAGFlow     │
│  ❌ 无阻塞等医生     │     │                          │
└─────────┬────────────┘     └──────────┬──────────────┘
          │                             │
          ▼                             ▼
┌──────────────────────────────────────────────────────┐
│              共享数据库 (SQLite/Postgres)              │
│  threads | imaging_reports | lab_reports | cases      │
└──────────────────────────────────────────────────────┘
```

---

## 三、患者端改造：精简 DeerFlow

### 3.1 保留什么（外壳）
- ✅ 聊天 UI（消息气泡、流式输出、文件上传）
- ✅ LangGraph Checkpointer（对话持久化）
- ✅ lead_agent 主循环（一个 Agent 直接调工具）
- ✅ 核心中间件：ThreadData、Uploads、Guardrail、ToolErrorHandling、Vision、ReadAndBurn、LoopDetection、Clarification、Title

### 3.2 移除什么（内脏）
- ❌ `task_tool`（子 Agent 调度器）— 速度慢的元凶
- ❌ `submit_for_review_tool`（阻塞式等医生审核）
- ❌ `SandboxMiddleware`（代码沙箱，医疗不需要）
- ❌ `TodoMiddleware`（任务列表）
- ❌ `SubagentLimitMiddleware`（子Agent限流）
- ❌ `DeferredToolFilterMiddleware`（动态工具发现）

### 3.3 重写系统提示词（⚠️ 审查发现的关键遗漏）
`prompt.py` 中有 ~120 行指令告诉 Agent "把影像委派给 imaging-agent"。
**必须重写为**："你自己直接调用 MCP 影像工具分析，不要委派。"

### 3.4 精简后患者端工作流
```
患者："我胸口疼，这是我的X光片"
  → 主Agent 直接调 MCP 影像工具（不经子Agent，省 5-10 秒）
  → 主Agent 调 RAGFlow 查医学知识
  → 立刻回复："初步分析发现右肺可疑阴影，建议尽快就诊。"
  → 异步存 DB（status: pending_review），供医生后续审核
```

---

## 四、医生端建设：全新后台大屏

### 4.1 页面路由
```
app/doctor/
├─ layout.tsx              ← 深色侧边栏 + Header + 人工监管模式开关
├─ dashboard/page.tsx      ← 统计大盘 + 患者队列表格
└─ workspace/[id]/page.tsx ← 三栏审核台
```

### 4.2 三栏审核台布局
| 左栏 (25%) | 中栏 (50%) | 右栏 (25%) |
|-----------|-----------|-----------|
| 患者基本信息 | BboxCanvas 影像标注 | 报告编辑器 |
| 主诉摘要 | 化验单指标可视化 | ✨AI出报告按钮 |
| 上传的病历 | 鉴别诊断滑块 | 医生附加嘱托 |

### 4.3 AI 出报告（轻量 ReAct Agent）
```python
# 后端 /doctor/generate-report
tools = [search_ragflow]
agent = create_react_agent(llm, tools, max_iterations=5)
result = agent.invoke({"input": f"患者资料：{data}\n请出具诊断报告"})
```
- 不走 DeerFlow，不走 LangGraph
- 1 个工具（RAGFlow 搜索），最多 5 次迭代
- 同步 HTTP 返回，3-5 秒出结果

---

## 五、组件迁移表

| 组件 | 当前位置 | 目标 | 操作 |
|------|---------|------|------|
| `bbox-canvas.tsx` | `workspace/artifacts/` | `components/doctor/imaging/` | 迁移 |
| `findings-list.tsx` | `workspace/artifacts/` | `components/doctor/imaging/` | 迁移 |
| `imaging-review-panel.tsx` | `workspace/artifacts/` | `components/doctor/imaging/` | 迁移 |
| `imaging-viewer-panel.tsx` | `workspace/artifacts/` | `components/doctor/imaging/` | 迁移 |
| `diagnostic-dashboard.tsx` | `workspace/artifacts/` | `components/doctor/dashboard/` | 迁移 |
| `chat-box.tsx` | `workspace/chats/` | 原地 | 清理影像审核逻辑（~80行） |

---

## 六、后端变更

### 需要修改的文件
| 文件 | 改动 |
|------|------|
| `tools/tools.py` | 从 BUILTIN_TOOLS 移除 submit_for_review_tool；删除 SUBAGENT_TOOLS |
| `tools/builtins/__init__.py` | 移除 submit_for_review_tool 导出 |
| `agents/lead_agent/agent.py` | 删除 SandboxMiddleware（1行） |
| `agents/lead_agent/prompt.py` | **重写系统提示词**（核心改动） |

### 需要新建的文件
| 文件 | 用途 |
|------|------|
| `app/gateway/routers/doctor.py` | 医生端专用 API（cases、generate-report、supervision-mode） |

### 不需要删除的文件（保留为死代码，避免 import 链断裂）
- `submit_for_review.py`、`task_tool.py`、`imaging_agent.py`、`medical_knowledge_agent.py`

---

## 七、开发排期（7 步）

| 阶段 | 内容 | 预估工作量 |
|------|------|----------|
| **P0** | DeerFlow 精简：移除工具 + 重写 Prompt | 中 |
| **P1** | 入口门户 + 患者端 chat-box 清理 | 小 |
| **P2** | 医生端外壳：Layout + Sidebar + Header | 中 |
| **P3** | 医生端患者队列：Dashboard + 数据表格 | 中 |
| **P4** | 医生端三栏审核台：迁移 BboxCanvas | 大 |
| **P5** | 轻量 ReAct Agent：/generate-report + RAGFlow | 中 |
| **P6** | 可配置 HITL 开关 | 小 |

---

## 八、风险与缓解

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| Prompt 重写后 Agent 行为异变 | 中 | P0 完成后立刻端到端测试患者对话 |
| 组件迁移后 import 路径断裂 | 低 | 迁移时同步更新所有引用 |
| 医生端新 API 无认证 | 低 | 暂用简单 token，P6 后可升级 RBAC |
| Git 回滚需求 | 无 | 备份点 `092eebd` 已推送 |
