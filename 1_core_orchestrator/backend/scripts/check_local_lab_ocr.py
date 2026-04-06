from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


from app.gateway.services.local_lab_ocr_runtime import get_local_lab_ocr_runtime_status


def main() -> int:
    parser = argparse.ArgumentParser(description="Report local lab OCR runtime availability.")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of human-readable text.")
    args = parser.parse_args()

    status = get_local_lab_ocr_runtime_status()

    if args.json:
        print(json.dumps(status.to_dict(), ensure_ascii=False))
    else:
        print(f"[Local OCR] mode={status.mode}")
        print(f"[Local OCR] available={'yes' if status.available else 'no'}")
        if status.missing_modules:
            print(f"[Local OCR] missing={', '.join(status.missing_modules)}")
        print(f"[Local OCR] summary={status.summary}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())