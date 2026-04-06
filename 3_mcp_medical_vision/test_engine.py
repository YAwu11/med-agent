# -*- coding: utf-8 -*-
import mcp_chest_xray.engine as engine
import traceback
print('Starting...')
engine.warmup_models()
path = r'E:\Dev_Workspace\01_Projects\Special\med-agent\1_core_orchestrator\backend\.deer-flow\threads\seed-thread-002\user-data\uploads\屏幕截图 2026-03-28 222234.png'
try:
    print('Run 1')
    engine.analyze(path, enable_sam=False)
    print('Run 1 Done')
    print('Run 2')
    engine.analyze(path, enable_sam=False)
    print('Run 2 Done')
except Exception as e:
    traceback.print_exc()
