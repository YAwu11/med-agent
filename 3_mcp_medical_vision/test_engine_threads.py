# -*- coding: utf-8 -*-
import mcp_chest_xray.engine as engine
import concurrent.futures
import time
import traceback

print('Starting...')
engine.warmup_models()
path = r'E:\Dev_Workspace\01_Projects\Special\med-agent\1_core_orchestrator\backend\.deer-flow\threads\seed-thread-002\user-data\uploads\屏幕截图 2026-03-28 222234.png'

pool = concurrent.futures.ThreadPoolExecutor(max_workers=5)

def run1():
    print('  T1: Starting')
    engine.analyze(path, enable_sam=False)
    print('  T1: Done')

def run2():
    print('  T2: Starting')
    engine.analyze(path, enable_sam=False)
    print('  T2: Done')

try:
    f1 = pool.submit(run1)
    f1.result()
    print('Run 1 complete, waiting...')
    time.sleep(2)
    f2 = pool.submit(run2)
    f2.result()
    print('Run 2 complete')
except Exception as e:
    traceback.print_exc()
