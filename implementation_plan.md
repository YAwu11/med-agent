# 患者端挂号链路加固实施记录（2026-04-05）

> 本文档已从“待实施方案”同步为“当前已落地实现说明”。如需继续扩展，请以这里描述的实际架构为准。

---

## 目标

本轮改造的目标是把患者端挂号与病历更新链路收敛为一条稳定路径，并补齐上传分析完成后的 AI 触发能力：

1. 修复确认挂号时患者信息丢失。
2. 统一患者信息字段名，移除过期键名。
3. 表单保存改为 diff-only PATCH。
4. 由聊天页统一负责患者表单保存后的 AI 通知。
5. 为 `patient_intake.json` 增加轻量 `_field_meta`，同时避免进入模型上下文。
6. 移除 agent 侧正式挂号工具暴露，只保留预览。
7. 增加线程级上传分析 SSE 事件，并在患者聊天页做幂等消费。

---

## 当前架构

### 1. 单一正式挂号路径

- Agent 只能调用 `preview_appointment` 生成挂号预览。
- 正式建档与提交统一由 `POST /api/threads/{thread_id}/confirm-appointment` 完成。
- `schedule_appointment` 模块文件仍保留在仓库中，但已不再注册到活跃 builtin tools。

### 2. 患者信息字段统一

- 前端共享字段定义集中在 `frontend/src/core/patient/patientInfoSchema.ts`。
- 当前 canonical keys 使用：`medical_history`、`allergies`。
- 已移除活跃 UI 中的旧键名：`past_history`、`allergy_history`。

### 3. 表单保存只发送变更字段

- `MedicalRecordCard` 在保存前通过 `computeDirtyFields` 计算差异。
- `PATCH /api/threads/{thread_id}/patient-intake` 仅接收本次变更字段。
- 若无差异，则前端不发请求，也不触发后续 AI nudge。

### 4. AI 通知的正确 owner

- `MedicalRecordCard` 只负责收集差异并在保存成功后触发 `onPatientInfoSaved`。
- `MedicalRecordDrawer` 只做透传。
- 真正调用 `sendMessage` 的 owner 是聊天页 `frontend/src/app/workspace/chats/[thread_id]/page.tsx`。
- 不再通过消息渲染组件（如 `message-list-item.tsx`）注入副作用。

### 5. `_field_meta` 写入、保留与过滤

- 患者表单 PATCH 会写入 `_field_meta[field] = { source: "patient", updated_at }`。
- Agent 调用 `update_patient_info` 会写入 `_field_meta[field] = { source: "agent", updated_at }`。
- 字段被清空或删除时，对应 `_field_meta` 会同步删除。
- `confirm_appointment` 重写 `patient_intake.json` 时会保留现有 `_field_meta`。
- `patient_record_context` 在注入模型上下文前会过滤 `_field_meta`。
- `PATCH /patient-intake` 的响应已做净化，不会把 `_field_meta` 回灌到前端组件状态。

### 6. 上传分析完成事件通道

- 后端新增线程级 SSE 通道：`GET /api/threads/{thread_id}/events`。
- 上传分析完成后，`uploads.py` 会发布 `upload_analyzed` 事件。
- 事件载荷包含：

```json
{
  "type": "upload_analyzed",
  "thread_id": "thread-1",
  "event_id": "upload-123:2026-04-05T12:00:00+00:00",
  "upload_id": "upload-123",
  "filename": "cbc.png",
  "analysis_kind": "ocr"
}
```

- 前端通过 `frontend/src/core/api/thread-events.ts` 订阅该通道。
- 聊天页使用内存内 `seenEventIdsRef` 与待发送队列做当前会话内幂等去重。
- 事件去重仅覆盖当前页面会话，跨刷新持久化仍不在本轮范围内。

---

## 已落地文件

### Backend

- `1_core_orchestrator/backend/app/gateway/routers/appointment.py`
- `1_core_orchestrator/backend/app/gateway/routers/uploads.py`
- `1_core_orchestrator/backend/app/gateway/routers/thread_events.py`
- `1_core_orchestrator/backend/app/gateway/services/thread_events.py`
- `1_core_orchestrator/backend/app/gateway/app.py`
- `1_core_orchestrator/backend/app/core/tools/builtins/update_patient_info.py`
- `1_core_orchestrator/backend/app/core/tools/builtins/save_analysis_result.py`
- `1_core_orchestrator/backend/app/core/tools/tools.py`
- `1_core_orchestrator/backend/packages/harness/deerflow/tools/tools.py`
- `1_core_orchestrator/backend/packages/harness/deerflow/patient_record_context.py`
- `1_core_orchestrator/backend/packages/harness/deerflow/agents/lead_agent/prompt.py`
- `1_core_orchestrator/backend/app/gateway/services/case_db.py`

### Frontend

- `1_core_orchestrator/frontend/src/core/patient/patientInfoSchema.ts`
- `1_core_orchestrator/frontend/src/core/patient/patientInfoUpdates.ts`
- `1_core_orchestrator/frontend/src/core/api/thread-events.ts`
- `1_core_orchestrator/frontend/src/components/workspace/AppointmentPreview.tsx`
- `1_core_orchestrator/frontend/src/components/workspace/MedicalRecordCard.tsx`
- `1_core_orchestrator/frontend/src/components/workspace/MedicalRecordDrawer.tsx`
- `1_core_orchestrator/frontend/src/app/workspace/chats/[thread_id]/page.tsx`

### Tests

- `1_core_orchestrator/backend/tests/test_appointment_router.py`
- `1_core_orchestrator/backend/tests/test_update_patient_info_tool.py`
- `1_core_orchestrator/backend/tests/test_patient_record_context.py`
- `1_core_orchestrator/backend/tests/test_registration_tool_contract.py`
- `1_core_orchestrator/backend/tests/test_thread_events_router.py`
- `1_core_orchestrator/backend/tests/test_uploads_router.py`
- `1_core_orchestrator/frontend/src/core/patient/patientInfoSchema.test.ts`
- `1_core_orchestrator/frontend/src/core/patient/patientInfoUpdates.test.ts`
- `1_core_orchestrator/frontend/src/components/workspace/__tests__/MedicalRecordCard.test.tsx`
- `1_core_orchestrator/frontend/src/core/api/thread-events.test.ts`

---

## 已完成验证

### Backend focused regression

- `tests/test_appointment_router.py`
- `tests/test_update_patient_info_tool.py`
- `tests/test_patient_record_context.py`
- `tests/test_registration_tool_contract.py`
- `tests/test_thread_events_router.py`
- `tests/test_uploads_router.py`

### Frontend focused regression

- `src/core/patient/patientInfoSchema.test.ts`
- `src/core/patient/patientInfoUpdates.test.ts`
- `src/components/workspace/__tests__/MedicalRecordCard.test.tsx`
- `src/core/api/thread-events.test.ts`
- `pnpm lint`
- `pnpm typecheck`

---

## 仍需人工 Smoke 的场景

以下步骤尚未在浏览器里做人工端到端确认：

1. 在患者聊天页修改两个字段并保存，确认请求体只包含变更字段。
2. 确认保存后只出现一次 AI 回复。
3. 打开挂号预览，确认展示的是 canonical fields。
4. 确认挂号后，病例与 `patient_intake.json` 都保留患者信息。
5. 上传检查材料，等待分析完成，确认聊天中只收到一次上传分析触发消息。

---

## 与旧方案相比的关键修正

- 不再通过 `message-list-item.tsx` 挂接表单保存后的发送逻辑。
- 不再复用病例队列 SSE (`cases.py`) 做患者线程分析通知，而是使用独立的 thread-scoped SSE 通道。
- `_field_meta` 不仅写入，而且在 agent context 注入与 PATCH 响应两侧都做了隔离。
- `schedule_appointment` 不再是活跃 runtime path。
