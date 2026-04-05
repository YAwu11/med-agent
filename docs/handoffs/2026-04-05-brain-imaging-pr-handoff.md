# 脑部影像链路 PR 交接文档

> 目的：把 2026-04-05 脑部影像 NIfTI 识别链路相关改动整理成可执行的最小提交集，并提供可直接复用的 PR 标题、正文和验证命令。

## 1. 当前分支现实

- 当前工作分支是 `clean-push-20260405`。
- 该分支相对 `main` 已经包含更早的 OCR、HITL、医生端工作台等提交，不只包含脑部影像这一条线。
- 如果要发一个聚焦“脑部影像闭环”的 PR，建议从 `main` 新切一个分支，然后按下面的提交集挑文件提交，或从现有分支上拆出一个 follow-up 分支。

## 2. 建议的最小提交集

### 提交 A

建议提交信息：`feat(backend): lock brain imaging contract and patient projection`

目标：固定脑影像 report/evidence 合同，打通医生复核、病例摘要、挂号预览和患者 record snapshot 的后端投影。

建议纳入文件：

- `1_core_orchestrator/backend/app/core/tools/builtins/preview_appointment.py`
- `1_core_orchestrator/backend/app/gateway/routers/appointment.py`
- `1_core_orchestrator/backend/app/gateway/routers/brain_report.py`
- `1_core_orchestrator/backend/app/gateway/routers/cases.py`
- `1_core_orchestrator/backend/app/gateway/routers/imaging_reports.py`
- `1_core_orchestrator/backend/app/gateway/routers/uploads.py`
- `1_core_orchestrator/backend/app/gateway/services/analyzers/__init__.py`
- `1_core_orchestrator/backend/app/gateway/services/analyzers/brain_mcp.py`
- `1_core_orchestrator/backend/app/gateway/services/analyzers/brain_tumor_reporter.py`
- `1_core_orchestrator/backend/app/gateway/services/analyzers/xray_mcp.py`
- `1_core_orchestrator/backend/app/gateway/services/brain_nifti_pipeline.py`
- `1_core_orchestrator/backend/app/gateway/services/case_db.py`
- `1_core_orchestrator/backend/app/gateway/services/mcp_brain_client.py`
- `1_core_orchestrator/backend/packages/harness/deerflow/agents/lead_agent/prompt.py`
- `1_core_orchestrator/backend/tests/test_brain_mcp_live.py`
- `1_core_orchestrator/backend/tests/test_uploads_router.py`
- `1_core_orchestrator/backend/README.md`
- `1_core_orchestrator/backend/CLAUDE.md`

建议暂存命令：

```powershell
git add 1_core_orchestrator/backend/app/core/tools/builtins/preview_appointment.py
git add 1_core_orchestrator/backend/app/gateway/routers/appointment.py
git add 1_core_orchestrator/backend/app/gateway/routers/brain_report.py
git add 1_core_orchestrator/backend/app/gateway/routers/cases.py
git add 1_core_orchestrator/backend/app/gateway/routers/imaging_reports.py
git add 1_core_orchestrator/backend/app/gateway/routers/uploads.py
git add 1_core_orchestrator/backend/app/gateway/services/analyzers/__init__.py
git add 1_core_orchestrator/backend/app/gateway/services/analyzers/brain_mcp.py
git add 1_core_orchestrator/backend/app/gateway/services/analyzers/brain_tumor_reporter.py
git add 1_core_orchestrator/backend/app/gateway/services/analyzers/xray_mcp.py
git add 1_core_orchestrator/backend/app/gateway/services/brain_nifti_pipeline.py
git add 1_core_orchestrator/backend/app/gateway/services/case_db.py
git add 1_core_orchestrator/backend/app/gateway/services/mcp_brain_client.py
git add 1_core_orchestrator/backend/packages/harness/deerflow/agents/lead_agent/prompt.py
git add 1_core_orchestrator/backend/tests/test_brain_mcp_live.py
git add 1_core_orchestrator/backend/tests/test_uploads_router.py
git add 1_core_orchestrator/backend/README.md
git add 1_core_orchestrator/backend/CLAUDE.md
```

### 提交 B

建议提交信息：`feat(med-vision): wire real brain 3d pipeline and startup helpers`

目标：接入真实脑部 3D pipeline、补本地启动辅助和运行期依赖。

建议纳入文件：

- `3_mcp_medical_vision/brain_tumor_pipeline/engine_3d.py`
- `3_mcp_medical_vision/brain_tumor_pipeline/requirements.txt`
- `3_mcp_medical_vision/brain_tumor_pipeline/resources/`
- `3_mcp_medical_vision/brain_tumor_pipeline/test_engine_3d_pytest.py`
- `scripts/start/start_all_with_mcp.ps1`

建议暂存命令：

```powershell
git add 3_mcp_medical_vision/brain_tumor_pipeline/engine_3d.py
git add 3_mcp_medical_vision/brain_tumor_pipeline/requirements.txt
git add 3_mcp_medical_vision/brain_tumor_pipeline/resources
git add 3_mcp_medical_vision/brain_tumor_pipeline/test_engine_3d_pytest.py
git add scripts/start/start_all_with_mcp.ps1
```

### 提交 C

建议提交信息：`feat(frontend): surface brain mri review across doctor patient and artifacts`

目标：把脑影像结果完整展示到医生工作台、患者病历卡、挂号预览和 artifact 面板，并补齐前端 env / 启动校验文档。

建议纳入文件：

- `1_core_orchestrator/frontend/src/components/doctor/BrainSpatialReview.tsx`
- `1_core_orchestrator/frontend/src/components/doctor/EvidenceDesk.tsx`
- `1_core_orchestrator/frontend/src/components/doctor/ImagingViewer.tsx`
- `1_core_orchestrator/frontend/src/components/workspace/AppointmentPreview.tsx`
- `1_core_orchestrator/frontend/src/components/workspace/MedicalRecordCard.tsx`
- `1_core_orchestrator/frontend/src/components/workspace/artifacts/artifact-file-detail.tsx`
- `1_core_orchestrator/frontend/src/components/workspace/artifacts/brain-artifact-viewer.tsx`
- `1_core_orchestrator/frontend/README.md`
- `1_core_orchestrator/frontend/CLAUDE.md`
- `1_core_orchestrator/frontend/.env.example`
- `docs/plans/2026-04-05-brain-imaging-contract.md`
- `docs/plans/2026-04-05-brain-imaging-patient-artifact.md`
- `docs/handoffs/2026-04-05-brain-imaging-pr-handoff.md`

建议暂存命令：

```powershell
git add 1_core_orchestrator/frontend/src/components/doctor/BrainSpatialReview.tsx
git add 1_core_orchestrator/frontend/src/components/doctor/EvidenceDesk.tsx
git add 1_core_orchestrator/frontend/src/components/doctor/ImagingViewer.tsx
git add 1_core_orchestrator/frontend/src/components/workspace/AppointmentPreview.tsx
git add 1_core_orchestrator/frontend/src/components/workspace/MedicalRecordCard.tsx
git add 1_core_orchestrator/frontend/src/components/workspace/artifacts/artifact-file-detail.tsx
git add 1_core_orchestrator/frontend/src/components/workspace/artifacts/brain-artifact-viewer.tsx
git add 1_core_orchestrator/frontend/README.md
git add 1_core_orchestrator/frontend/CLAUDE.md
git add 1_core_orchestrator/frontend/.env.example
git add docs/plans/2026-04-05-brain-imaging-contract.md
git add docs/plans/2026-04-05-brain-imaging-patient-artifact.md
git add docs/handoffs/2026-04-05-brain-imaging-pr-handoff.md
```

## 3. 不建议放进这次 PR 的内容

- `Dataset002_BRATS19/`

原因：这是训练/导出产物，体积大、噪音高，而且不属于“脑部影像链路代码闭环”本身。若确实需要保留，建议单独走模型资产或数据产物提交流程。

## 4. 建议 PR 标题

`feat: 打通脑部影像 NIfTI 识别到医生/患者/Artifact 全链路`

## 5. 建议 PR 正文

```md
## Summary
- 固定脑影像 report / evidence 合同，统一医生复核、病例摘要、挂号预览与患者侧 snapshot 的字段投影
- 限定脑部分析仅支持 NIfTI 上传，并接入真实 3D pipeline 与脑部 MCP smoke 验证
- 在医生工作台、患者病历卡、挂号预览和 artifact 面板展示脑 MRI 结果，补齐本地 env / 启动校验文档

## Test Plan
- [x] `PYTHONPATH=. PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 pytest tests/test_imaging_reports_router.py tests/test_uploads_router.py tests/test_patient_record_context.py tests/test_appointment_router.py tests/test_cases_router.py -q`
- [x] `RUN_BRAIN_MCP_LIVE=1 PYTHONPATH=. PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 pytest tests/test_brain_mcp_live.py -q`
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `BETTER_AUTH_SECRET="local-build-placeholder-secret-32chars" pnpm build`

## Notes
- Better Auth build warning can be silenced locally with `BETTER_AUTH_URL=http://localhost:3000`.
- `Dataset002_BRATS19/` should stay out of this PR unless model assets are being reviewed together.
```

## 6. 建议发布前再跑一次的命令

后端：

```powershell
Set-Location 1_core_orchestrator/backend
$env:PYTHONPATH = "."
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = "1"
pytest tests/test_imaging_reports_router.py tests/test_uploads_router.py tests/test_patient_record_context.py tests/test_appointment_router.py tests/test_cases_router.py -q
```

脑部 MCP 实烟：

```powershell
Set-Location 1_core_orchestrator/backend
$env:RUN_BRAIN_MCP_LIVE = "1"
$env:PYTHONPATH = "."
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = "1"
pytest tests/test_brain_mcp_live.py -q
```

前端：

```powershell
Set-Location 1_core_orchestrator/frontend
pnpm lint
pnpm typecheck
$env:BETTER_AUTH_SECRET = "local-build-placeholder-secret-32chars"
pnpm build
```