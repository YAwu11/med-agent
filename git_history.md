dfee3fb [2026-03-29 19:22:02 +0800] feat(doctor): P3 patient queue API and dashboard integration
80f018c [2026-03-29 19:18:51 +0800] feat(doctor): P2 doctor dashboard shell - layout, sidebar, header, mocks
d244437 [2026-03-29 19:09:59 +0800] feat(frontend): P1 portal page + patient-side cleanup - remove doctor components from chat
4bb2d5a [2026-03-29 19:06:02 +0800] refactor(deerflow): P0 medical simplification - replace blocking HITL with async save, update patient prompt
b6ecdd3 [2026-03-29 18:00:24 +0800] fix: enable MCP tool access for main agent (include_mcp=False -> True)
d5f2eff [2026-03-29 17:51:51 +0800] refactor(P1): clean patient-side frontend - strip imaging review from chat-box, remove doctor components from exports
0514160 [2026-03-29 17:49:59 +0800] refactor(P0): gut DeerFlow internals - remove sub-agents, sandbox, blocking HITL, rewrite prompt
092eebd [2026-03-29 17:44:07 +0800] chore: pre-refactor backup - Phase 6 complete, Phase 7 design docs finalized
39f36cd [2026-03-29 16:15:33 +0800] feat(imaging): implement Interactive Dumbbell Chart and dynamic AI probability tools for Phase 5
b808b08 [2026-03-29 01:16:41 +0800] chore: 全量同步 - config.yaml/ragflow-lite优化/架构文档/LLM追踪
c318676 [2026-03-29 01:12:48 +0800] perf(P0): 极速优化 - 模型单例化/轻量Agent/HITL返回格式修复
cc0f65a [2026-03-28 23:17:26 +0800] feat(imaging): integrate MCP vision hitl review and new finding structure
dcdd1f9 [2026-03-27 20:59:41 +0800] chore: 提交剩余修改 — 前端组件修复 + 依赖锁文件更新 + 测试脚本
4cdcb62 [2026-03-27 20:50:38 +0800] feat(middleware): UploadsMiddleware 支持 .meta.json sidecar 读取 + ReadAndBurnMiddleware 优化
376a962 [2026-03-27 13:24:49 +0800] feat(vision): 完善图像分拣管道 — 多图批量上传支持 + 自动视觉判断
