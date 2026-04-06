# Doctor Imaging Review Closure Design

## Goal

把医生端影像审核链路一次性收口：

- 胸部 X 光分析失败时不再静默丢失结果。
- 胸片页面完整展示病灶框、结构化摘要、DenseNet 疾病概率和被过滤候选。
- 胸片查看器缩小到更适合医生审核的信息密度。
- 脑 MRI 上传入口从“通用附件上传”升级为“通用上传 + 四序列引导上传”。

## Confirmed Reality

- 胸片 MCP 服务当前在首次分析时会因为 `_warmed_up` 未初始化而抛出 `NameError`，导致前端只能看到空画布或残缺状态。
- 网关 `analyze-cv` 路由把 `densenet_probs` 从错误字段读取，后端原始结果里的 `summary`、`rejected`、`densenet_probs` 没有被完整透传。
- 前端 `ImagingViewer` 只把 `findings` 当成核心数据，保存和导出也只保留 `findings`，会把其他 AI 返回信息丢掉。
- 医生端当前只有统一的“补充医疗附件”入口，没有脑 MRI 四序列引导、缺失序列提示或明确的上传契约。

## Chosen Approach

采用“契约收口 + 双场景 UI 增强”方案：

1. 先修胸片后端可用性和返回契约，保证前端永远能拿到稳定结构。
2. 再把胸片前端从“单一大图 + 病灶框列表”升级为“紧凑影像区 + 结果信息卡”。
3. 最后把脑 MRI 上传改成引导模式：允许分批上传，但持续提示当前缺失的 `t1 / t1ce(or t1c) / t2 / flair`，集齐后再自然进入 3D 分析。

## UX Direction

### Chest X-Ray Viewer

- 主图高度明显缩小，避免挤压结果区。
- 主图下方拆成三类信息：
  - 病灶结果：保留可编辑 bbox 与医生修订。
  - 疾病概率：展示 DenseNet top probabilities。
  - 系统摘要：展示 total findings、双肺分布、disease breakdown、rejected 候选。
- 结果卡保持医生优先，AI 信息只做结构化辅助，不抢主操作位。

### Brain MRI Upload

- 保留通用“补充医疗附件”入口。
- 新增“脑 MRI 四序列上传”入口，带清晰说明。
- 支持分批上传，但在医生端显示当前病例已收集序列和缺失序列。
- 如果上传二维截图或非 NIfTI，继续保留 notice 分支，但前端要把原因讲清楚。

## Data Contract

胸片审核前端需要稳定消费以下字段：

- `image_path`
- `findings`
- `summary`
- `densenet_probs`
- `rejected`
- `pipeline`
- `disclaimer`
- `status`

其中 `doctor_result` 覆盖 `ai_result` 的规则保持不变，但保存时必须保留未编辑字段，不能因为医生只修改 bbox 就把概率和摘要清空。

## Success Criteria

- 医生点击“一键AI诊断”后，胸片页能稳定看到病灶框、概率列表和摘要，不再只剩 bbox。
- 胸片主图比例变小，信息区无需滚动到很深才能看到关键结果。
- 脑 MRI 上传入口能明确提示四序列要求，并在未集齐时显示缺失项。
- 后端测试覆盖胸片 MCP 初始化、CV 路由格式化契约和脑 MRI 引导状态投影；前端至少通过目标文件 lint 和 typecheck。