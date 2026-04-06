# 病历增量上下文设计稿

## 目标

把当前“每次用户发言都注入整份病例快照”的方式改成“平时只给 AI 看增量，诊断前再主动读取全量病例”，同时保留你希望的上传状态感知能力：

- 患者侧前端立即出现一条居中系统提示条，让患者看到“补充了什么字段 / 上传了什么资料 / 哪份资料识别完成了”。
- 真正发给 AI 的更新信息与前端系统提示分离；前端提示不展示敏感字段值，隐藏 delta 才带具体内容。
- 聊天区不再因为这些系统同步动作出现明显顿挫感或刷出一堆对用户无意义的提示。

## 现状确认

基于当前源码，现状是这样的：

1. backend/packages/harness/deerflow/patient_record_context.py 负责构造完整病例快照。
2. backend/packages/harness/deerflow/agents/middlewares/patient_record_middleware.py 会在每个新的人类消息前面拼接完整 patient_record 块。
3. backend/app/core/tools/builtins/show_medical_record.py 只是 UI 展示工具，不是给 AI 做诊断前全量读取的工具。
4. backend/app/core/tools/builtins/update_patient_info.py 是患者侧 AI 当前唯一的结构化写入工具，只能改表单字段，不能改原始化验单或影像结果。
5. backend/app/gateway/routers/uploads.py 现在只在分析完成后发 upload_analyzed 事件，没有“刚上传成功但仍在处理中”的线程事件。
6. frontend/src/app/workspace/chats/[thread_id]/page.tsx 目前把 upload_analyzed 事件转成一条普通 sendMessage，因此会直接进入可见聊天流。
7. frontend/src/core/messages/utils.ts 和消息渲染链路里，目前没有“发给 AI 但默认不展示给用户”的隐藏消息语义。
8. frontend 已经能通过线程 state 更新接口持久化 thread values，因此“系统提示条”不必伪装成普通聊天消息，也可以跨刷新保留。

## 决策

采用“病例快照单一真相源 + 增量事件驱动 + 诊断前按需全量读取”的方案。

### 1. 病例快照仍然是唯一真相源

不新增第二份病历数据模型。仍然以这些现有来源拼装快照：

- patient_intake.json
- uploads 目录下的原始上传文件
- .meta.json / .ocr.md
- imaging-reports 下的分析结果

这样做的原因是：

- 最小改动，不需要重做病例存储层。
- 化验单、OCR、医学影像的处理中 / 完成态，本来就在这个快照里已经能推出来。
- 医生端和患者端后面都可以继续复用同一份快照。

### 2. 收集阶段采用“系统提示 + source-aware delta”双通道

收集阶段不再把“给患者看的提示”和“给 AI 的上下文”混在一条消息里，而是按来源拆开：

1. 患者手动修改表单：
  - 前端系统提示：只展示新增 / 修改 / 删除了哪些字段，不展示具体值。
  - 隐藏 delta：发给 AI，包含具体字段值，便于 AI 继续收集和推理。
2. AI 自己调用工具修改表单：
  - 前端系统提示：展示“哪些字段新增 / 修改 / 删除成功”。
  - 不回灌 delta 给 AI，因为这次变更本来就是 AI 发起的，重复发送只会造成自我回声。
3. 患者上传化验单 / 医学影像：
  - 前端系统提示：立即展示“患者上传了什么资料，当前识别中”。
  - 暂不把 processing 状态作为 delta 发给 AI。
4. 化验单 / 医学影像识别完成：
  - 前端系统提示：展示“什么什么识别完成”。
  - 隐藏 delta：直接把识别后的结构化结果或摘要送给 AI。

AI 在日常问诊收集阶段只接收真正有必要的 delta，而不是整份病例。

推荐的文本格式：

```text
<patient_record_delta revision="12">
- 化验单 cbc.png 已识别完成，摘要：白细胞升高；中性粒细胞升高。
- 患者更新了主诉：胸闷伴胸痛 2 天。
</patient_record_delta>
```

同时保留结构化表示，便于前端、测试和后续事件复用：

```json
{
  "kind": "patient_record_delta",
  "revision": 12,
  "changes": [
    {
      "type": "upload_status_changed",
      "filename": "cbc.png",
      "from_status": "processing",
      "to_status": "completed",
      "summary": "白细胞升高；中性粒细胞升高"
    }
  ]
}
```

### 3. 诊断 / 复诊断时由 AI 主动读全量病例

新增只读工具 read_patient_record，给 AI 在以下场景主动调用：

- 准备给出综合判断
- 新资料到达后准备重新判断
- 医生要求基于完整病例重新总结

这个工具返回完整快照，可选 mode：

- summary: 精简结构化摘要
- full: 全量结构化信息
- diagnosis: 为模型优化过的诊断视图

show_medical_record 继续只负责 UI 卡片，不混用职责。

### 4. 上传状态走“双事件”

新增并统一两类线程事件：

- upload_received：文件已落库，当前状态 processing
- upload_analyzed：分析完成，状态 completed 或 failed，并附摘要信息

这样患者可以第一时间看到“有新资料进来了”，而 AI 只在真正拿到可用结果时收到更新。

这也正好符合你要的链路：

1. 上传化验单
2. 前端立刻展示系统提示：患者上传了化验单，识别中
3. OCR/分析完成
4. 前端再展示系统提示：化验单识别完成
5. 后端 delta 自动送 AI：这份化验单识别完成，得到哪些结果

### 5. 系统提示与隐藏 delta 分离

这是这次设计里最关键的一点。

如果仍然用普通 human message 去同时承载“给患者看的提示”和“给 AI 的上下文”，聊天区会继续出现顿挫感，而且消息职责会混乱。

做法：

- 可见系统提示：持久化到 thread values，例如 `system_notices`。
- 隐藏 delta：仍然走 sendMessage / 线程消息流，但打 `context_event.hidden_in_ui = true` 标记。

系统提示的数据结构建议为：

```json
{
  "id": "notice-12",
  "kind": "patient_info_updated",
  "text": "患者修改了：主诉、现病史",
  "created_at": "2026-04-05T10:00:00Z",
  "anchor_message_id": "ai-msg-88",
  "ai_delivery": "pending"
}
```

其中：

- `text` 是给患者看的文案，不展示字段具体值。
- `anchor_message_id` 用来把这条 notice 渲染到当前 AI 回复下方。
- `ai_delivery` 表示这条 notice 是否还关联后续 delta 投递。

### 6. 隐藏 delta 通过“上下文消息”送给 AI，不进入用户可见聊天气泡

做法：

- 前端继续通过既有 sendMessage 进入同一条线程，保证 Agent 侧不用重做入口。
- 但给这类消息打上 additional_kwargs.context_event 标记，例如：

```json
{
  "context_event": {
    "kind": "patient_record_delta",
    "hidden_in_ui": true,
    "revision": 12,
    "source": "upload_analyzed"
  }
}
```

- MessageList / groupMessages 默认过滤 hidden_in_ui 的 human 消息，不渲染成聊天气泡。
- Agent 仍然能收到这条消息，并把它当作病例增量上下文。

这样既保留了“自动把 delta 发给 AI”的能力，也不会打断真实聊天体验。

时序要求是：

- 系统提示一出现就立刻展示在前端。
- 如果 AI 当前正在流式回复，隐藏 delta 先排队，等这轮回复完成后自动发给 AI。
- 不管 delta 有没有发出去，系统提示都必须先显示。

### 7. middleware 保留兜底，不再每轮注入全量

patient_record_middleware 不再把整份 patient_record 拼在每次消息前。

改成两件事：

- 如果当前消息本身就是 context_event delta，则不重复再拼一次。
- 如果因为某些原因前端没把 delta 发出去，但快照 revision 已变化，则在下一次真实用户发言前补一段最小 delta 兜底。

因此 middleware 从“主通道”改成“补偿通道”。

### 8. 原始证据保持只读

第一阶段不新增“修改化验单原文”或“修改影像原始结果”工具。

理由：

- 原始证据是 OCR / 影像分析产物，应该保留只读事实属性。
- 患者侧 AI 当前真正该写入的是病历表单结构化字段，而不是篡改原始化验单。
- 若未来要支持纠错，应该新增“证据解读备注 / 医生复核结论”层，而不是直接覆盖原始上传结果。

## 数据流

### A. 患者修改表单

1. 前端提交 diff-only PATCH。
2. 后端更新 patient_intake.json。
3. 前端写入一条 system_notice，内容只包含变更字段名和动作类型。
4. 前端生成 hidden delta，里面带具体字段值。
5. 如果 AI 空闲则立即发送；如果 AI 正在回复则排队，回复结束后自动发送。
6. AI 继续在当前上下文中收集信息，不需要看到整份病例。

### B. AI 调用工具修改表单

1. `update_patient_info` 工具成功写入 patient_intake.json。
2. 前端根据工具结果生成一条 system_notice，例如“主诉、现病史修改成功”。
3. 不再向 AI 追加 delta，因为这次修改本身就是 AI 发起的。

### C. 患者上传化验单 / 医学影像

1. 上传接口保存文件。
2. 后端立刻发 upload_received。
3. 聊天页立刻写入一条 system_notice：患者上传了什么资料，当前识别中。
4. 后端异步/延后完成分析后发 upload_analyzed。
5. 如果状态是 completed，聊天页再写入一条 system_notice：什么什么识别完成。
6. 只有 completed 的分析结果才会被组装成 hidden delta 自动送给 AI。
7. failed 先只做 system_notice，不做第一阶段 AI delta。

### D. AI 进入诊断阶段

1. Prompt 明确要求：在给综合判断前调用 read_patient_record。
2. 工具返回完整病例快照。
3. AI 基于全量记录进行诊断或重新诊断。

## 对现有问题的直接收益

1. 避免每轮注入完整病例，降低 token 和上下文噪音。
2. 患者能立刻看到字段补充、上传中、识别完成等系统状态，而且展示位置固定在当前 AI 回复下方。
3. AI 只在真正需要的时候收到具体值或识别结果，不会被无意义的 processing 噪音反复打断。
4. 自动同步不会刷出一堆可见聊天气泡，用户体验更顺。
5. 诊断仍然保留全量阅读能力，不会因为只用 delta 而丢失全局视角。
6. 复诊断天然成立：新 delta 到来后，AI 再次调用 read_patient_record 即可。

## 不做的事

- 第一阶段不做原始证据编辑工具。
- 第一阶段不重做病例存储模型。
- 第一阶段不把 show_medical_record 和 read_patient_record 混成一个工具。

## 分阶段实施建议

### Phase 1

- backend 生成 revision + delta
- middleware 改为 delta 兜底
- 新增 read_patient_record 工具
- prompt 改写

### Phase 2

- 上传接口发 upload_received
- 线程事件协议扩展到 received / analyzed
- 前端聊天页把线程事件转成 system_notice
- 识别完成事件再转成 hidden delta 消息
- 渲染居中 system_notice 横条
- 过滤 hidden 消息不显示

### Phase 3

- update_patient_info schema 对齐完整 PatientInfo
- AI 工具写入结果转换为 system_notice
- 回归测试和文档同步

## 风险与控制

### 风险 1：delta 重复发送

控制：

- revision 单调递增
- 事件带 event_id
- 前端按 event_id 去重
- middleware 只在 revision 未确认时做兜底

### 风险 2：隐藏消息被误显示

控制：

- groupMessages 在最早阶段过滤 hidden_in_ui
- 增加单元测试，确保此类消息不会进入 MessageListItem

### 风险 3：系统提示和 AI delta 时序错位

控制：

- system_notice 先写入 thread values，再考虑 delta 投递
- notice 带 `anchor_message_id`
- delta 在 AI 忙碌时进入 pending 状态，空闲后统一 flush

### 风险 4：AI 忘记在诊断前读全量病例

控制：

- prompt 明确硬性要求
- 工具文案命名直接表达用途
- 后续可在诊断节点增加 server-side guard，但第一阶段先不扩大改动面

## 结论

按你原来的思路推进是合理的，而且和现有代码的耦合面最小：

- 患者先看到清晰的系统提示
- 只有真正有用的结果才推给 AI
- 真要诊断时再读全量
- 原始化验单和影像结果继续保持只读

这条路线既满足产品交互，也更容易把化验单和医学影像的状态解释做顺。