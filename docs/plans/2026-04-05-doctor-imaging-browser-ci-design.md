# Doctor Imaging Browser And CI Design

## Goal

把医生端影像审核的测试补到“组件 + 浏览器 + CI”三层闭环：

- 在前端加一条真实浏览器级回归，验证医生影像审核页面在浏览器里能正确展示结构化结果并发出正确保存请求。
- 在仓库里补上 CI，让 frontend 和 backend 的关键影像回归自动跑起来。

## Confirmed Reality

- 当前 frontend 已经有 Vitest 组件测试，但还没有浏览器级回归。
- 仓库根目录没有 `.github/workflows`，也就是还没有 GitHub Actions 工作流。
- `ImagingViewer` 的真实风险点仍然是：
  - 浏览器端能否看到 summary / probabilities / rejected cards。
  - 点击保存时是否发送 `{ doctor_result: ... }`。
  - 缺失 finding `id` 时保存前是否被归一化。
- 医生完整页面链路依赖后台病例、鉴权和多个工作台状态；直接做全站级 e2e 成本高，而且会把这次任务拖成环境编排问题。

## Chosen Approach

采用“mock 页面承载真实组件 + Playwright 拦截保存请求 + GitHub Actions 分层执行”的方案：

1. 在 frontend 新增一个只用于测试的 mock 页面，直接挂载 `ImagingViewer`，给它注入稳定的 `threadId`、`reportId` 和结构化结果。
2. 用 Playwright 打开这个页面，在真实浏览器里断言：
   - 结构化摘要、DenseNet 概率、过滤候选都能显示。
   - 点击保存时，请求体是 `{ doctor_result: ... }`，并且 finding `id` 已经补齐。
3. 新增 GitHub Actions workflow：
   - frontend job 跑 `pnpm test`、`pnpm lint`、`pnpm typecheck`、`pnpm build` 和 `pnpm test:e2e`。
   - backend job 跑影像相关定向 pytest。

## Trade-offs

### Option A: 直接做医生全站 Playwright

- 优点：更接近真实使用路径。
- 缺点：需要病例种子、医生入口状态和更多 API 编排，这次范围会失控。

### Option B: 只把 Vitest 放进 CI

- 优点：最省事。
- 缺点：仍然没有浏览器级保障，拦不住真实 DOM、网络拦截和按钮交互层面的回归。

### Option C: mock 页面 + Playwright + 分层 CI

- 优点：浏览器级成本最低，同时能把 CI 补齐。
- 缺点：它测试的是“医生影像审核核心壳层”，不是整站 queue -> case -> review 的完整流程。

推荐 Option C。

## Success Criteria

- frontend 可以运行 `pnpm test:e2e`，并稳定通过一条医生影像审核浏览器级回归。
- 根目录新增 GitHub Actions workflow，自动执行 frontend 和 backend 的影像关键检查。
- 文档同步说明 Playwright 命令和 CI 覆盖范围。