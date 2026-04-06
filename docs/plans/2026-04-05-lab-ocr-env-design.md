# Lab OCR Environment Closure Design

## Goal

把化验单 OCR 的运行模式收口成一套明确规则：默认环境只要完成 backend `uv sync` 就能稳定工作；若需要本地 `PPStructureV3` 加速/增强，则通过显式安装入口把本地 Paddle 依赖装进 `backend/.venv`，并且所有启动脚本、环境检查、文档都以同一套状态说明为准。

## Confirmed Reality

- 统一启动入口当前全部绑定项目内 `.venv\Scripts\python.exe`，不是系统 `python`。
- `backend/.venv` 当前没有 `paddleocr`、`paddlepaddle`、`paddlex`。
- `uv sync` 只会安装 `backend/pyproject.toml` 中的依赖，而这些本地 OCR 依赖目前不在其中。
- 因此，本地 `PPStructureV3` 不能被当成默认必备能力；默认模式必须依赖现有云端 `PaddleOCR-VL` 回退保证可用性。

## Chosen Approach

采用“双模式收口”：

1. 默认模式：保留现有“本地优先，失败回退云端”的行为，保证任何只跑 `uv sync` 的机器都能正常识别。
2. 本地增强模式：增加显式的本地 OCR 依赖清单、安装脚本和检测脚本，把“是否启用本地 `PPStructureV3`”变成可见状态，而不是隐式依赖某个历史环境。
3. 入口统一：桌面控制台、PowerShell 启动脚本、README、CLAUDE 都基于同一检测逻辑展示“本地 OCR 可用 / 不可用 / 当前将回退云端”。

## Design Notes

- 不把 Paddle 依赖直接塞进默认 `uv sync`，避免 Windows 上的重型依赖安装拖垮默认初始化路径。
- 增加一个 Python 侧的本地 OCR 运行时检查模块，作为脚本和文档说明的单一事实来源。
- 增加一个单独的可选安装脚本，专门向 `backend/.venv` 安装本地 OCR 依赖。
- 桌面控制台和 `scripts/start/start_all_with_mcp.ps1` 只负责消费状态，不自行维护重复的“缺什么包”判断。

## Success Criteria

- 用户只跑 `uv sync` 时，化验单依然可识别，且入口脚本能清楚说明当前走的是云端回退模式。
- 用户执行一次本地 OCR 安装脚本后，`backend/.venv` 能被检测为“本地 OCR 可用”。
- 所有环境检查文案、启动文案和后端文档都一致，不再暗示“`uv sync` 后自动拥有本地 `PPStructureV3`”。