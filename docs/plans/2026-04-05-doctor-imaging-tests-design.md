# Doctor Imaging Tests Design

## Goal

把医生端影像审核补测试这件事一次做完整：

- 给 frontend 子树接入可运行的 Vitest + Testing Library 基座。
- 为 `ImagingViewer` 增加组件测试，锁住结果渲染与保存请求契约。
- 在 backend 增加一条更接近真实流程的链路回归，覆盖脑 MRI 四序列上传到医生复核保存的关键路径。

## Confirmed Reality

- `1_core_orchestrator/frontend` 当前没有测试框架，只有 `lint` 和 `typecheck`。
- `ImagingViewer` 当前的关键风险点不是绘图细节，而是：
  - `doctor_result` / `ai_result` 嵌套结构的渲染优先级。
  - 缺失 finding id 时的前端兜底归一化。
  - 保存时必须提交 `{ doctor_result: ... }` 包装体，而不是裸 JSON。
- backend 已经有 `test_uploads_router.py` 和 `test_imaging_reports_router.py`，适合继续往路由/服务契约方向补回归，而不是临时再造一套 e2e 框架。

## Chosen Approach

采用“前端组件测试 + 后端链路回归”的双层方案：

1. 前端引入最小 Vitest 基座，只支持当前需要的 jsdom 组件测试。
2. 组件测试集中验证 `ImagingViewer` 的两个核心行为：
   - 能渲染 summary / 概率 / rejected 等非 bbox 信息。
   - 点击保存时向后端发送正确的 `{ doctor_result: ... }` 请求，并保留结构化结果。
3. 后端链路回归不追求浏览器级 e2e，而是用 FastAPI TestClient + 临时目录拼出“上传四序列 -> 生成脑 MRI placeholder evidence -> 保存医生复核结果”的完整主链路。

## Trade-offs

### Option A: 只补后端测试

- 优点：实现快，依赖少。
- 缺点：锁不住前端保存契约和渲染回归，正好会漏掉这次最近修过的点。

### Option B: 前端上 Playwright 真 e2e

- 优点：更接近真实用户操作。
- 缺点：当前仓库没有前端测试基础设施，也没有稳定的 doctor review 测试种子数据和启动编排；这次范围会被拖大。

### Option C: Vitest 组件测试 + FastAPI 链路回归

- 优点：成本最小，但能同时锁住前端契约和后端链路。
- 缺点：不能覆盖 Konva 复杂交互和整站浏览器编排。

推荐采用 Option C。

## Test Scope

### Frontend

- `ImagingViewer` 使用 `initialStructuredData` 时，能正确展示：
  - summary
  - densenet probabilities
  - rejected candidates
- `ImagingViewer` 在 finding 缺失 `id` 时会自动归一化。
- 点击“保存修改”后，请求体必须是 `{ doctor_result: ... }`。

### Backend

- 上传 `t1/t1ce/t2/flair` 四个 NIfTI 文件后，自动建证据逻辑应把 MRI placeholder 标记成 `ready_for_analysis=True`。
- 生成的影像 evidence 应带有稳定的 `report_id` 与 `brain_nifti_v1` 契约字段。
- 医生保存复核结果时，写回文件和病例 evidence 的 `doctor_result` 应保持一致。

## Success Criteria

- frontend 可以运行 `pnpm test`，并至少有 `ImagingViewer` 的稳定组件测试。
- backend 新增一条脑 MRI 上传到复核保存的链路回归并通过。
- README / CLAUDE 同步说明新的测试命令和覆盖范围。