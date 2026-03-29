# Unified Doctor Desk — Final Design Document (v4)

> 本文档是最终定稿版。所有之前的 v1/v2/v3 方案均以此为准。

---

## 0. 一句话总纲

> **患者端 = 精简版 DeerFlow Agent（收集资料 + 初步建议，不阻塞等医生）。**
> **医生端 = 纯后台大屏 + 轻量 ReAct Agent（审核资料、查知识库、出报告）。**
> **两端共享同一个数据库和后端 API，通过 Thread ID 异步互通数据。**

---

## 1. 系统架构总览

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
│  lead_agent          │     │                          │
│  - RAGFlow 搜索      │     │  /doctor/cases           │
│  - 基础问答/收集     │     │  /doctor/generate-report │
│  - ❌不再阻塞等医生  │     │  (轻量ReAct→RAGFlow)     │
└─────────┬────────────┘     └──────────┬──────────────┘
          │                             │
          ▼                             ▼
┌──────────────────────────────────────────────────────┐
│              共享数据库 (SQLite/Postgres)              │
│  threads | imaging_reports | lab_reports | cases      │
└──────────────────────────────────────────────────────┘
```

---

## 2. 患者端：DeerFlow 医疗场景精简方案

### 2.1 定位变更

**Before (旧设计)**：患者上传图片 → Agent调用YOLO → `submit_for_review` 阻塞等医生审核 → 医生改完才回复患者。
**After (新设计)**：患者上传图片 → Agent 自动调用分析工具 → **立刻给患者初步建议** → 同时异步存报告到DB → 医生在自己的大屏上看到待审记录，**完全异步**。

### 2.2 中间件精简清单

经源码审计，当前 DeerFlow 加载了 **15 个中间件**。按医疗场景需求裁剪如下：

| 中间件 | 保留？ | 理由 |
|--------|--------|------|
| `ThreadDataMiddleware` | ✅ 保留 | 注入 thread_id，核心基础设施 |
| `UploadsMiddleware` | ✅ 保留 | 患者上传图片/化验单必须 |
| `SandboxMiddleware` | ❌ **移除** | 代码沙箱，医疗场景不需要执行代码 |
| `DanglingToolCallMiddleware` | ✅ 保留 | 修复消息缺失，稳定性保障 |
| `GuardrailMiddleware` | ✅ 保留 | 安全护栏，医疗场景必须 |
| `ToolErrorHandlingMiddleware` | ✅ 保留 | 工具出错兜底 |
| `SummarizationMiddleware` | ⚠️ 可选 | 长对话摘要，视对话长度决定 |
| `TodoMiddleware` | ❌ **移除** | 任务列表，患者端不需要 |
| `TokenUsageMiddleware` | ⚠️ 可选 | 监控令牌消耗 |
| `TitleMiddleware` | ✅ 保留 | 自动命名对话，有用 |
| `ConditionalVisionMiddleware` | ✅ 保留 | 医学影像Base64注入，核心 |
| `ReadAndBurnMiddleware` | ✅ 保留 | 清理Base64节省Token |
| `DeferredToolFilterMiddleware` | ❌ **移除** | 动态工具发现，医疗工具是固定的 |
| `SubagentLimitMiddleware` | ❌ **移除** | 子Agent限流，不再使用子Agent |
| `LoopDetectionMiddleware` | ✅ 保留 | 防止无限循环 |
| `ClarificationMiddleware` | ✅ 保留 | 追问患者信息 |

**精简结果**：15 → 10（去掉沙箱、TodoList、动态工具发现、子Agent限流、view_image中间件）

### 2.3 工具精简清单

| 工具 | 保留？ | 理由 |
|------|--------|------|
| `present_file_tool` | ✅ 保留 | 向患者展示文件（如初步分析图） |
| `ask_clarification_tool` | ✅ 保留 | 追问症状信息 |
| `submit_for_review_tool` | ❌ **移除** | 不再阻塞等医生，改为异步存DB |
| `task_tool` (子Agent) | ❌ **移除** | 不需要子Agent |
| `view_image_tool` | ⚠️ 按需 | 已在P0阶段停用 |
| RAGFlow 搜索工具 | ✅ **新增** | 查医学知识库回答患者 |
| 影像分析工具 (MCP) | ✅ 保留 | 调用YOLO/DenseNet分析 |

### 2.4 患者端新工作流

```
患者："我胸口疼，这是我的X光片"
  ↓
精简版 DeerFlow Agent:
  1. 调用 RAGFlow → 查询"胸痛鉴别诊断"
  2. 调用 MCP影像工具 → YOLO识别X光片
  3. 综合回复患者："初步分析发现右肺有一处可疑阴影，
     建议您尽快前往医院呼吸科就诊做进一步检查。"
  4. 异步：将AI分析结果存入DB (status: pending_review)
  ↓
患者收到即时建议，不需要等待任何医生操作
```

---

## 3. 医生端：纯后台 + 轻量 ReAct Agent

### 3.1 定位

- 完全独立的后台管理系统风格
- 没有聊天框，没有消息气泡
- 医生打开大屏 → 看到待处理的病例列表 → 点击进入审核 → 修改证据 → AI出报告 → 签发

### 3.2 轻量 ReAct Agent

```python
# 后端 /doctor/generate-report 端点伪代码
from langchain.agents import create_react_agent

tools = [search_ragflow]  # 只给知识库搜索工具
agent = create_react_agent(llm, tools, max_iterations=5)

result = agent.invoke({
    "input": f"""
    患者信息：{patient_info}
    影像分析结果（医生已确认）：{imaging_json}
    化验单数据（医生已确认）：{lab_json}
    医生附加嘱托：{doctor_notes}
    
    请基于以上信息和你的医学知识库，出具一份完整的综合诊断报告。
    """
})
```

---

## 4. 组件归属清单

| 组件 | 归属 | 操作 |
|------|------|------|
| `bbox-canvas.tsx` | **医生端** | 移到 `components/doctor/` |
| `findings-list.tsx` | **医生端** | 移到 `components/doctor/` |
| `imaging-review-panel.tsx` | **医生端** | 移到 `components/doctor/` |
| `imaging-viewer-panel.tsx` | **医生端** | 移到 `components/doctor/` |
| `diagnostic-dashboard.tsx` | **医生端** | 移到 `components/doctor/` |
| `chat-box.tsx` | **患者端** | 清理掉所有影像审核逻辑 |
| `imaging-trigger.tsx` | **患者端** | 保留 |
| `input-box.tsx` | **患者端** | 保留 |

---

## 5. 路由设计

```
app/
├─ page.tsx                         ← 入口门户
├─ workspace/                       ← 患者端（现有，清理后保留）
│   └─ chats/[thread_id]/page.tsx   ← 纯聊天
├─ doctor/                          ← 医生端（全新）
│   ├─ layout.tsx                   ← 侧边栏 + HITL开关
│   ├─ dashboard/page.tsx           ← 统计大盘 + 患者队列
│   └─ workspace/[thread_id]/page.tsx ← 三栏审核台
```

---

## 6. 后端变更

### 新增端点
| 端点 | 用途 |
|------|------|
| `GET /api/doctor/cases` | 患者列表 |
| `GET /api/doctor/cases/{tid}` | 患者详情 |
| `POST /api/doctor/generate-report` | 轻量ReAct出报告 |
| `GET/PUT /api/doctor/supervision-mode` | HITL开关 |

### 修改 DeerFlow
1. 从 `BUILTIN_TOOLS` 中移除 `submit_for_review_tool`
2. 从 `_build_middlewares` 中移除 `SandboxMiddleware`、`TodoMiddleware`、`SubagentLimitMiddleware`、`DeferredToolFilterMiddleware`
3. 新增异步存DB的工具（替代 `submit_for_review`），不阻塞Agent

---

## 7. 可配置 HITL (cHITL)

医生端 Header 上的开关：
- **OFF**：患者端Agent跑完自动存结果，医生可以随时查看但不阻塞
- **ON**：患者端Agent在完成分析后暂停，医生必须先审核再让系统给患者回复

---

## 8. 开发优先级

1. **P0 — DeerFlow 精简**：移除无用中间件和工具，替换 `submit_for_review` 为异步存储
2. **P1 — 路由分流 + 患者端清理**：入口门户，清理chat-box中的影像审核控件
3. **P2 — 医生端外壳**：Layout + Sidebar + Header
4. **P3 — 医生端患者队列**：Dashboard + 数据表格
5. **P4 — 医生端审核台**：三栏布局，复用迁移后的 BboxCanvas
6. **P5 — 轻量 ReAct Agent**：后端 `/generate-report` 接入 RAGFlow
7. **P6 — cHITL 开关**：实现全局监管模式
