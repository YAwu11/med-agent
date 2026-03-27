"""Inspect Baidu OCR response structure."""
import asyncio
import glob
import json
import os
import sys

sys.path.insert(0, ".")
os.environ["BAIDU_OCR_API_KEY"] = "Gn3w8s06Q5MplI3s6luApbkt"
os.environ["BAIDU_OCR_SECRET_KEY"] = "iMSXQ2IP0aWhci0yATt9pwct1nPTgaUV"

from app.gateway.services.baidu_ocr import fetch_medical_report_ocr

async def main():
    files = glob.glob(r".deer-flow\threads\*\user-data\uploads\*.png")
    for f in files:
        if ".ocr.md" in f or "enhanced" in f:
            continue
        print(f"Testing: {os.path.basename(f)}")
        result = await fetch_medical_report_ocr(f)
        if result:
            print(f"Top-level keys: {list(result.keys())}")
            for k, v in result.items():
                if isinstance(v, list):
                    print(f"  {k}: list of {len(v)} items")
                    if v:
                        print(f"    First item type: {type(v[0])}")
                        print(f"    First item: {json.dumps(v[0], ensure_ascii=False)[:300]}")
                elif isinstance(v, dict):
                    print(f"  {k}: dict with keys {list(v.keys())}")
                else:
                    print(f"  {k}: {v}")
        break  # Test first file only

asyncio.run(main())
