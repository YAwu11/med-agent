import json
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
INPUT_DIR = REPO_ROOT / 'LLM_output'
OUTPUT_FILE = SCRIPT_DIR / 'output' / 'read_log.txt'


with OUTPUT_FILE.open('w', encoding='utf-8') as out:
    files = sorted(INPUT_DIR.glob('*.json'), key=lambda item: item.stat().st_mtime)
    for f in files[-5:]:
        with f.open(encoding='utf-8') as handle:
            data = json.load(handle)
        msgs = data.get('outputs', {}).get('messages', [])
        if not msgs:
            msgs = data.get('inputs', {}).get('messages', [])
        out.write(f"\n--- {f.name} ({len(msgs)} msgs) ---\n")
        for m in msgs[-4:]:
            role = m.get('type', m.get('role', 'unknown'))
            name = m.get('name', '')
            content = m.get('content', '')
            if isinstance(content, list): content = str(content)
            out.write(f"[{role}] {name}: {content[:300].replace(chr(10), ' ')}\n")
            if m.get('tool_calls'):
                out.write(f"  Tools: {[t.get('name') for t in m.get('tool_calls')]}\n")
