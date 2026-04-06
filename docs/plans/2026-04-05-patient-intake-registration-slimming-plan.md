# Patient Intake Registration Slimming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将患者端收缩为“信息采集 + 病例维护 + 挂号确认”助手，移除患者端 RAG 与资料二次解读职责，所有上传资料在挂号后统一进入医生端专业分析路线，并为未来视觉分诊模型预留结构化接入点。

**Architecture:** 保留现有 LangGraph、线程、病例快照和挂号确认链路，不重写主框架；通过收缩主 Agent 的提示词、工具集合和 middleware，并同步简化患者端前端，完成患者端职责重定义。上传链路不删除，但患者端不再消费解析状态或分析文本，后续视觉模型只输出结构化分诊信号，由系统和医生端消费。

**Tech Stack:** LangGraph, FastAPI, Next.js, React, TypeScript, Vitest, Pytest, SQLite

---

## Scope

- In:
  - 患者端主 Agent 去除 `rag_retrieve` 与资料解读职责
  - 患者端仅保留 `update_patient_info`、`read_patient_record`、`show_medical_record`、`preview_appointment`、可选 `ask_clarification`
  - 患者端页面收敛为聊天 + 单一病例页 + 挂号确认
  - 患者端不再展示上传解析状态、系统通知驱动的资料回流、患者可见分析结果
  - 上传后数据继续保留，并在挂号后进入医生端分析链路
  - 预留未来视觉模型输出“完整结构化分诊结果”的后端接入点

- Out:
  - 医生端专业分析界面的重构
  - 新视觉模型的实际接入实现
  - 新建独立 graph 或新服务
  - 重写病例数据库或挂号数据库结构

## Key Decisions

1. 不重写 DeerFlow，不新增第二个 graph，仍基于现有主 Agent 做职责收缩。
2. 患者端彻底移除 `rag_retrieve`，不再基于上传资料给患者输出解释性文本。
3. 患者端上传能力保留，但只承担资料接收与归档，不承担解释反馈。
4. 未来视觉模型输出采用“完整结构化分诊结果，患者端仅显示精简字段，医生端消费全量”。
5. 患者端 UI 只保留一个统一病例页作为核心操作面，不再保留资料状态栏和复杂系统通知链路。

## Rollout Strategy

1. 先做后端 Agent 收缩，保证模型行为先变轻。
2. 再做患者端前端瘦身，去掉无用展示和复杂编排。
3. 然后调整上传后路由与医生端接管时机。
4. 最后增加“视觉分诊结构化结果”占位契约与回归测试。

## Validation Gates

1. 患者端主 Agent 不再暴露 `rag_retrieve`。
2. 患者端对上传资料不再输出解释性文本或状态通知。
3. 患者端仍能完整完成信息采集、病例查看/编辑、挂号确认。
4. 挂号后病例与上传资料仍能在医生端路径中继续分析和流转。
5. 回归测试覆盖主 Agent、病例页、挂号确认和上传后接管行为。

### Task 1: 收缩患者端主 Agent 的职责边界

**Files:**
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/tools/tools.py`
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/agents/lead_agent/agent.py`
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/agents/lead_agent/prompt.py`
- Test: `1_core_orchestrator/backend/tests/test_lead_agent_model_resolution.py`
- Test: `1_core_orchestrator/backend/tests/test_custom_agent.py`
- Create: `1_core_orchestrator/backend/tests/test_patient_intake_agent_profile.py`

**Step 1: 写失败测试，锁定患者端允许的工具集合**

在 `test_patient_intake_agent_profile.py` 中新增测试：
- 主 Agent 工具集合不包含 `rag_retrieve`
- 主 Agent 工具集合保留 `update_patient_info`、`read_patient_record`、`show_medical_record`、`preview_appointment`
- 当模型开启 thinking 配置时，患者端 profile 仍强制走非 thinking 模式

**Step 2: 运行测试确认失败**

Run: `backend/.venv/Scripts/python.exe -m pytest 1_core_orchestrator/backend/tests/test_patient_intake_agent_profile.py -v`

Expected: FAIL，出现 `rag_retrieve` 仍在患者端工具列表中，或缺少 profile 逻辑。

**Step 3: 实现最小收缩逻辑**

实现要点：
- 在 `tools.py` 中把业务工具列表拆成“患者端登记工具集合”和其他集合，避免继续把所有工具默认挂给主 Agent。
- 在 `agent.py` 中加入明确的患者端 profile 分支，不要靠 prompt 硬约束工具行为。
- 在 `prompt.py` 中重写系统提示词，只保留信息采集、病例查看、挂号确认、上传接收提醒，不再出现影像/化验单/知识库解读规则。

**Step 4: 运行测试确认通过**

Run: `backend/.venv/Scripts/python.exe -m pytest 1_core_orchestrator/backend/tests/test_patient_intake_agent_profile.py 1_core_orchestrator/backend/tests/test_lead_agent_model_resolution.py 1_core_orchestrator/backend/tests/test_custom_agent.py -v`

Expected: PASS

**Step 5: Commit**

`git add 1_core_orchestrator/backend/packages/harness/deerflow/tools/tools.py 1_core_orchestrator/backend/packages/harness/deerflow/agents/lead_agent/agent.py 1_core_orchestrator/backend/packages/harness/deerflow/agents/lead_agent/prompt.py 1_core_orchestrator/backend/tests/test_patient_intake_agent_profile.py 1_core_orchestrator/backend/tests/test_lead_agent_model_resolution.py 1_core_orchestrator/backend/tests/test_custom_agent.py`

`git commit -m "refactor: slim patient agent to intake and registration only"`

### Task 2: 去掉患者端不必要的 middleware 与自动上下文注入

**Files:**
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/agents/middlewares/tool_error_handling_middleware.py`
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/agents/lead_agent/agent.py`
- Create: `1_core_orchestrator/backend/tests/test_patient_intake_middlewares.py`

**Step 1: 写失败测试，锁定患者端 middleware 组合**

测试覆盖：
- 保留 `ThreadDataMiddleware`
- 保留 `ToolErrorHandlingMiddleware`
- 保留 `DanglingToolCallMiddleware`
- 可选保留 `ClarificationMiddleware`
- 不再挂 `UploadsMiddleware`
- 不再挂 `PatientRecordMiddleware`
- 不再挂 `ConditionalVisionMiddleware`、`ReadAndBurnMiddleware`
- 不再挂 `SummarizationMiddleware`、`TitleMiddleware`、`TodoMiddleware`、`TokenUsageMiddleware`

**Step 2: 运行测试确认失败**

Run: `backend/.venv/Scripts/python.exe -m pytest 1_core_orchestrator/backend/tests/test_patient_intake_middlewares.py -v`

Expected: FAIL

**Step 3: 实现最小 middleware builder 分支**

实现要点：
- 在现有 builder 上增加患者端轻量模式，而不是重写整个中间件系统。
- 让病例信息获取走显式 `read_patient_record`，而不是依赖 `PatientRecordMiddleware` 自动注入。
- 保持工具错误 fail-fast 逻辑不变。

**Step 4: 运行测试确认通过**

Run: `backend/.venv/Scripts/python.exe -m pytest 1_core_orchestrator/backend/tests/test_patient_intake_middlewares.py 1_core_orchestrator/backend/tests/test_tool_error_handling_middleware.py -v`

Expected: PASS

**Step 5: Commit**

`git add 1_core_orchestrator/backend/packages/harness/deerflow/agents/middlewares/tool_error_handling_middleware.py 1_core_orchestrator/backend/packages/harness/deerflow/agents/lead_agent/agent.py 1_core_orchestrator/backend/tests/test_patient_intake_middlewares.py`

`git commit -m "refactor: remove patient-side middleware overhead"`

### Task 3: 重构患者端聊天页为“聊天 + 单病例页”

**Files:**
- Modify: `1_core_orchestrator/frontend/src/app/workspace/chats/[thread_id]/page.tsx`
- Modify: `1_core_orchestrator/frontend/src/app/workspace/chats/[thread_id]/page.orchestration.ts`
- Modify: `1_core_orchestrator/frontend/src/components/workspace/messages/message-list-item.tsx`
- Modify: `1_core_orchestrator/frontend/src/components/workspace/MedicalRecordDrawer.tsx`
- Test: `1_core_orchestrator/frontend/src/components/workspace/__tests__/MedicalRecordDrawer.test.tsx`
- Create: `1_core_orchestrator/frontend/src/app/workspace/chats/[thread_id]/page.patient-intake.test.tsx`

**Step 1: 写失败测试，锁定患者端页面最小行为**

测试覆盖：
- 顶部仅保留“打开病历页”主入口
- 上传后不再创建 hidden notice 驱动消息发送
- 收到 `appointment_preview` 后只驱动病例页进入挂号确认态
- 聊天消息流中不再渲染独立的 `AppointmentPreview` 卡片

**Step 2: 运行测试确认失败**

Run: `cd 1_core_orchestrator/frontend; pnpm vitest run src/components/workspace/__tests__/MedicalRecordDrawer.test.tsx src/app/workspace/chats/[thread_id]/page.patient-intake.test.tsx`

Expected: FAIL

**Step 3: 实现患者端页面瘦身**

实现要点：
- 从 `page.tsx` 中删除 `PatientStatusPanel`、上传线程事件订阅、system notice 持久化和 hidden notice 回注逻辑。
- 从 `page.orchestration.ts` 中移除患者端上传事件 notice 编排与 appointment preview 之外的复杂辅助函数。
- 在 `message-list-item.tsx` 中取消 `appointment_preview` 独立卡片渲染，改为只保留病例页联动。
- `MedicalRecordDrawer.tsx` 保留为唯一病例/挂号确认 UI，但文案与状态改为“登记与挂号确认”语义。

**Step 4: 运行测试确认通过**

Run: `cd 1_core_orchestrator/frontend; pnpm vitest run src/components/workspace/__tests__/MedicalRecordDrawer.test.tsx src/app/workspace/chats/[thread_id]/page.patient-intake.test.tsx src/core/messages/utils.test.ts`

Expected: PASS

**Step 5: Commit**

`git add 1_core_orchestrator/frontend/src/app/workspace/chats/[thread_id]/page.tsx 1_core_orchestrator/frontend/src/app/workspace/chats/[thread_id]/page.orchestration.ts 1_core_orchestrator/frontend/src/components/workspace/messages/message-list-item.tsx 1_core_orchestrator/frontend/src/components/workspace/MedicalRecordDrawer.tsx 1_core_orchestrator/frontend/src/components/workspace/__tests__/MedicalRecordDrawer.test.tsx 1_core_orchestrator/frontend/src/app/workspace/chats/[thread_id]/page.patient-intake.test.tsx`

`git commit -m "refactor: simplify patient chat workflow to record and registration"`

### Task 4: 将病例页瘦身为登记表单 + 上传列表 + 挂号确认区

**Files:**
- Modify: `1_core_orchestrator/frontend/src/components/workspace/MedicalRecordCard.tsx`
- Test: `1_core_orchestrator/frontend/src/components/workspace/__tests__/MedicalRecordCard.test.tsx`
- Delete: `1_core_orchestrator/frontend/src/components/workspace/PatientStatusPanel.tsx`
- Delete: `1_core_orchestrator/frontend/src/components/workspace/__tests__/PatientStatusPanel.test.tsx`

**Step 1: 写失败测试，锁定病例页最小职责**

测试覆盖：
- 病例页仍可编辑患者信息并保存
- 病例页仅显示上传文件名/基本列表，不显示“处理中/已识别/异常摘要”等状态
- 病例页不展示 `ocr_summary`、`findings_brief`、影像异常说明等患者端分析内容
- 病例页在 `appointmentPreviewData` 存在时显示挂号确认按钮

**Step 2: 运行测试确认失败**

Run: `cd 1_core_orchestrator/frontend; pnpm vitest run src/components/workspace/__tests__/MedicalRecordCard.test.tsx`

Expected: FAIL

**Step 3: 实现病例页瘦身**

实现要点：
- 保留患者信息表单、保存逻辑、上传入口。
- 上传完成后只刷新文件列表，不呈现分析状态或系统摘要。
- 删除脑 MRI、OCR、影像复核等患者端专属逻辑分支。
- 若需要保留数据结构兼容，只在 UI 层忽略这些字段，不先动后端 snapshot 结构。

**Step 4: 运行测试确认通过**

Run: `cd 1_core_orchestrator/frontend; pnpm vitest run src/components/workspace/__tests__/MedicalRecordCard.test.tsx`

Expected: PASS

**Step 5: Commit**

`git add 1_core_orchestrator/frontend/src/components/workspace/MedicalRecordCard.tsx 1_core_orchestrator/frontend/src/components/workspace/__tests__/MedicalRecordCard.test.tsx 1_core_orchestrator/frontend/src/components/workspace/PatientStatusPanel.tsx 1_core_orchestrator/frontend/src/components/workspace/__tests__/PatientStatusPanel.test.tsx`

`git commit -m "refactor: trim patient medical record UI to intake essentials"`

### Task 5: 调整上传后数据交接，患者端不消费分析结果，医生端继续接管

**Files:**
- Modify: `1_core_orchestrator/backend/app/gateway/routers/uploads.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/appointment.py`
- Modify: `1_core_orchestrator/backend/app/gateway/services/case_db.py`
- Create: `1_core_orchestrator/backend/tests/test_patient_upload_handoff.py`
- Test: `1_core_orchestrator/backend/tests/test_appointment_router.py`

**Step 1: 写失败测试，锁定挂号前后数据交接语义**

测试覆盖：
- 患者端上传资料后，不要求患者端立即可见分析文本
- 挂号确认后，thread 关联 case 能接住历史上传资料
- 医生端仍可通过 case/thread 拿到全部 evidence 和后续分析入口

**Step 2: 运行测试确认失败**

Run: `backend/.venv/Scripts/python.exe -m pytest 1_core_orchestrator/backend/tests/test_patient_upload_handoff.py 1_core_orchestrator/backend/tests/test_appointment_router.py -v`

Expected: FAIL

**Step 3: 实现交接约束**

实现要点：
- `uploads.py` 可继续保留分析后台能力，但不要再假设患者端需要消费结果事件。
- `appointment.py` 与 `case_db.py` 明确挂号后 thread -> case 的映射与上传资料归档时机。
- 若患者端上传先于挂号发生，保证挂号成功后资料仍能在医生端 case 视角被完整看到。

**Step 4: 运行测试确认通过**

Run: `backend/.venv/Scripts/python.exe -m pytest 1_core_orchestrator/backend/tests/test_patient_upload_handoff.py 1_core_orchestrator/backend/tests/test_appointment_router.py -v`

Expected: PASS

**Step 5: Commit**

`git add 1_core_orchestrator/backend/app/gateway/routers/uploads.py 1_core_orchestrator/backend/app/gateway/routers/appointment.py 1_core_orchestrator/backend/app/gateway/services/case_db.py 1_core_orchestrator/backend/tests/test_patient_upload_handoff.py 1_core_orchestrator/backend/tests/test_appointment_router.py`

`git commit -m "refactor: hand off patient uploads to doctor workflow after registration"`

### Task 6: 预留视觉模型的结构化分诊契约

**Files:**
- Create: `1_core_orchestrator/backend/app/gateway/services/triage_contract.py`
- Modify: `1_core_orchestrator/backend/app/gateway/services/analyzer_registry.py`
- Modify: `1_core_orchestrator/backend/app/gateway/services/parallel_analyzer.py`
- Create: `1_core_orchestrator/backend/tests/test_triage_contract.py`
- Modify: `1_core_orchestrator/backend/README.md`
- Modify: `1_core_orchestrator/backend/CLAUDE.md`

**Step 1: 写失败测试，锁定结构化分诊结果格式**

测试覆盖：
- 分诊结果包含完整结构：`triage_level`、`recommended_department`、`urgent_flags`、`needs_doctor_review`、`confidence`、`patient_visible_summary`
- 患者端只允许消费精简字段
- 医生端和后台保留全量字段

**Step 2: 运行测试确认失败**

Run: `backend/.venv/Scripts/python.exe -m pytest 1_core_orchestrator/backend/tests/test_triage_contract.py -v`

Expected: FAIL

**Step 3: 实现占位契约，不接真实模型**

实现要点：
- 新增 `triage_contract.py` 定义视觉分诊结构体或 Pydantic 模型。
- 在 `analyzer_registry.py` / `parallel_analyzer.py` 中只预留 structured_data 写入位置，不接真实推理逻辑。
- 明确患者端只显示 `patient_visible_summary` 或精简字段，避免未来模型直接向患者输出完整诊断式结果。

**Step 4: 运行测试确认通过**

Run: `backend/.venv/Scripts/python.exe -m pytest 1_core_orchestrator/backend/tests/test_triage_contract.py -v`

Expected: PASS

**Step 5: Commit**

`git add 1_core_orchestrator/backend/app/gateway/services/triage_contract.py 1_core_orchestrator/backend/app/gateway/services/analyzer_registry.py 1_core_orchestrator/backend/app/gateway/services/parallel_analyzer.py 1_core_orchestrator/backend/tests/test_triage_contract.py 1_core_orchestrator/backend/README.md 1_core_orchestrator/backend/CLAUDE.md`

`git commit -m "feat: define structured visual triage contract for future patient intake"`

### Task 7: 做整体验证与发布前检查

**Files:**
- Verify: `1_core_orchestrator/backend/tests/test_patient_intake_agent_profile.py`
- Verify: `1_core_orchestrator/backend/tests/test_patient_intake_middlewares.py`
- Verify: `1_core_orchestrator/backend/tests/test_patient_upload_handoff.py`
- Verify: `1_core_orchestrator/backend/tests/test_appointment_router.py`
- Verify: `1_core_orchestrator/backend/tests/test_triage_contract.py`
- Verify: `1_core_orchestrator/frontend/src/components/workspace/__tests__/MedicalRecordDrawer.test.tsx`
- Verify: `1_core_orchestrator/frontend/src/components/workspace/__tests__/MedicalRecordCard.test.tsx`
- Verify: `1_core_orchestrator/frontend/src/app/workspace/chats/[thread_id]/page.patient-intake.test.tsx`

**Step 1: 跑后端回归切片**

Run: `backend/.venv/Scripts/python.exe -m pytest 1_core_orchestrator/backend/tests/test_patient_intake_agent_profile.py 1_core_orchestrator/backend/tests/test_patient_intake_middlewares.py 1_core_orchestrator/backend/tests/test_patient_upload_handoff.py 1_core_orchestrator/backend/tests/test_appointment_router.py 1_core_orchestrator/backend/tests/test_triage_contract.py -v`

Expected: PASS

**Step 2: 跑前端回归切片**

Run: `cd 1_core_orchestrator/frontend; pnpm vitest run src/components/workspace/__tests__/MedicalRecordDrawer.test.tsx src/components/workspace/__tests__/MedicalRecordCard.test.tsx src/app/workspace/chats/[thread_id]/page.patient-intake.test.tsx`

Expected: PASS

**Step 3: 跑类型检查与 lint**

Run: `cd 1_core_orchestrator/frontend; pnpm typecheck && pnpm lint`

Expected: PASS

**Step 4: 做手工 smoke**

手工验证路径：
- 新建患者线程
- 通过对话采集信息
- 打开病例页并手工编辑保存
- 上传资料，确认患者端不显示解析状态与解读
- 触发挂号预览并确认提交
- 在医生端查看 case 是否收到完整资料

**Step 5: Commit**

`git add -A`

`git commit -m "feat: streamline patient intake and registration workflow"`

## Rollback Plan

1. 若后端工具收缩导致患者无法挂号，优先回滚 `tools.py` 与 `prompt.py`。
2. 若前端病例页瘦身导致挂号确认失败，优先回滚 `MedicalRecordDrawer.tsx` 与 `message-list-item.tsx`。
3. 若上传后医生端接管失败，优先回滚 `uploads.py`、`appointment.py`、`case_db.py`。
4. 视觉分诊契约为新增兼容层，出现问题时可单独回滚，不影响患者端主流程。

## Open Questions

- 患者端上传后，病例页是否需要显示“资料已接收，待医生处理”的单句提示，还是完全静默只保留文件名列表？
- 挂号前是否需要一个固定的最小必填字段集合，还是继续完全由 `read_patient_record.guidance` 决定可挂号条件？
- 未来视觉模型的结构化分诊结果是写入现有 `evidence_items[].structured_data`，还是单独挂入病例快照的 `triage` 顶层字段？
