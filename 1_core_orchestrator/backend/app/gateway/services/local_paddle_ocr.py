"""本地 PPStructureV3 + Qwen3.5-35B-A3B 化验单 OCR 引擎

Plan E 最终方案（benchmark 验证胜出）:
  1. 本地 PPStructureV3 提取表格 HTML
  2. 去 HTML 标签得到纯文本行
  3. 调用 SiliconFlow Qwen3.5-35B-A3B (MoE 35B 总 / 3B 激活)
     将无结构文本整理为固定 6 列 Markdown 表格

性能指标（benchmark_planE 第 8 组）:
  项目提取 98.1% | 箭头 100% | 中文名 99.3% | 数值 87.1% | 均速 9.7s

依赖:
  - paddlepaddle 3.0.0 (CPU, **不可升级** — PIR/OneDNN 崩溃)
  - paddleocr 3.4.0, paddlex 3.4.3
  - httpx (SiliconFlow API)
"""

import os
import re
import time
from html.parser import HTMLParser
from pathlib import Path

import httpx
from loguru import logger

# 必须在 paddle 之前导入 torch，防止 DLL 冲突（Windows）
try:
    import torch  # noqa: F401
except ImportError:
    pass

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

# ─── SiliconFlow API 配置 ─────────────────────────────
_API_URL = "https://api.siliconflow.cn/v1/chat/completions"
_MODEL = "Qwen/Qwen3.5-35B-A3B"

_SYSTEM_PROMPT = """\
你是医疗化验单结构化专家。我提供 OCR 从化验单图片识别出的原始文本行（无表格结构），请整理为 Markdown 表格。

输出格式（固定6列）：
| 序号 | 项目名称 | 结果 | 异常 | 单位 | 参考范围 |
- 序号从1开始。
- 项目名称：中文全称。
- 结果：纯数字或定性结果，不得包含箭头或任何其他符号。
- 异常：**只能填 ↑ 或 ↓ 或留空**。严禁使用 < > ＜ ＞ H L A N 或其他任何字符。当结果高于参考上限填 ↑，低于参考下限填 ↓，正常则留空。
- 单位和参考范围照实填写。

规则：
1. 文本中的每行可能包含多个字段，请根据数值特征和医学常识拆分归位。
2. 跳过患者信息（姓名、性别、科别等）。
3. 禁止捏造数据，禁止遗漏项目。
4. 只输出 Markdown 表格，不要任何解释。"""


# ─── PPStructureV3 单例 ──────────────────────────────
_ppstructure_engine = None


def _get_ppstructure_engine():
    """懒加载 PPStructureV3 单例（首次调用约需 10-20s 加载模型）。"""
    global _ppstructure_engine
    if _ppstructure_engine is None:
        from paddleocr import PPStructureV3
        logger.info("[LocalOCR] 正在初始化 PP-StructureV3 引擎...")
        t0 = time.time()
        _ppstructure_engine = PPStructureV3()
        logger.info(f"[LocalOCR] PP-StructureV3 初始化完成，耗时 {time.time()-t0:.1f}s")
    return _ppstructure_engine


# ---------------------------------------------------------------------------
#  HTML → 纯文本
# ---------------------------------------------------------------------------

class _CellExtractor(HTMLParser):
    """从 PPStructureV3 HTML 表格中提取纯文本行（每行 = 一个 <tr>）。"""

    def __init__(self):
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th"):
            self._cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(" ".join(self._cell).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        d = data.strip()
        if d and self._cell is not None:
            self._cell.append(d)


def _strip_html_to_text(html: str) -> str:
    """从 HTML 表格去除标签，按 <tr> 分行，单元格用双空格连接。"""
    ext = _CellExtractor()
    ext.feed(html)
    lines = []
    for row in ext.rows:
        non_empty = [c for c in row if c]
        if non_empty:
            lines.append("  ".join(non_empty))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
#  PPStructureV3 → 纯文本提取
# ---------------------------------------------------------------------------

def _extract_text_from_image(image_path: str) -> str:
    """用 PPStructureV3 推理图片，将所有区域转为纯文本。

    table 区域: HTML → _strip_html_to_text()
    figure_title / text: 直接保留
    """
    engine = _get_ppstructure_engine()
    results = engine.predict(image_path)

    if not results:
        return ""

    page = results[0]
    parsing_list = page.get('parsing_res_list', [])
    if not parsing_list:
        return ""

    text_parts: list[str] = []
    for region in parsing_list:
        label = getattr(region, 'label', None) or (region.get('label') if hasattr(region, 'get') else None) or ''
        content = getattr(region, 'content', None) or (region.get('content') if hasattr(region, 'get') else None) or ''
        if not content:
            continue

        if label == 'table' and '<table' in content.lower():
            text_parts.append(_strip_html_to_text(content))
        else:
            text_parts.append(content.strip())

    return "\n".join(p for p in text_parts if p)


# ---------------------------------------------------------------------------
#  SiliconFlow Qwen3.5-35B-A3B 调用
# ---------------------------------------------------------------------------

async def _call_qwen(user_text: str) -> tuple[str, float]:
    """调用 SiliconFlow Qwen3.5-35B-A3B，将 OCR 纯文本整理为 Markdown 表格。

    Returns:
        (markdown_content, elapsed_seconds)
    """
    api_key = os.getenv("SILICONFLOW_OCR_API_KEY", "")
    if not api_key:
        raise ValueError("SILICONFLOW_OCR_API_KEY 未配置")

    payload = {
        "model": _MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_text[:12000]},
        ],
        "temperature": 0.1,
        "max_tokens": 4096,
        "enable_thinking": False,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    t0 = time.perf_counter()
    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(_API_URL, json=payload, headers=headers)
        elapsed = time.perf_counter() - t0

        if resp.status_code != 200:
            logger.error(f"[LocalOCR] Qwen API HTTP {resp.status_code}: {resp.text[:300]}")
            return "", elapsed

        data = resp.json()
        content = data["choices"][0]["message"].get("content", "")

        # 清理 thinking 残留和 code fences
        content = re.sub(r'<think>[\s\S]*?</think>\s*', '', content)
        content = re.sub(r'^```(?:markdown)?\s*\n', '', content)
        content = re.sub(r'\n```\s*$', '', content)
        return _sanitize_abnormal_column(content.strip()), elapsed


def _sanitize_abnormal_column(markdown: str) -> str:
    """后处理：确保 Markdown 表格的"异常"列只含 ↑ ↓ 或空。

    即使 prompt 已限制，LLM 仍可能输出 <、>、H、L 等，此函数强制清理。
    """
    lines = markdown.split("\n")
    result: list[str] = []

    # 先定位异常列索引（在表头行中找"异常"）
    arrow_col = -1
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            for i, c in enumerate(cells):
                if re.search(r'异常|标记|flag', c, re.IGNORECASE):
                    arrow_col = i
                    break
            break  # 只看第一行表头

    if arrow_col < 0:
        return markdown

    for line in lines:
        stripped = line.strip()
        if not (stripped.startswith("|") and stripped.endswith("|")):
            result.append(line)
            continue

        cells = stripped.strip("|").split("|")
        if len(cells) <= arrow_col:
            result.append(line)
            continue

        # 跳过表头行和分隔行
        cell_val = cells[arrow_col].strip()
        if re.match(r'^[\s\-:]+$', cell_val) or re.search(r'异常|标记|flag', cell_val, re.IGNORECASE):
            result.append(line)
            continue

        # 只保留 ↑ ↓，其他一律清除
        cleaned = ""
        if "↑" in cell_val:
            cleaned = "↑"
        elif "↓" in cell_val:
            cleaned = "↓"
        cells[arrow_col] = f" {cleaned} "
        result.append("| " + " | ".join(c if i != arrow_col else cells[arrow_col] for i, c in enumerate(cells)) + " |")

    return "\n".join(result)


# ---------------------------------------------------------------------------
#  OCR 原始数值指纹提取（双源校验用）
# ---------------------------------------------------------------------------

def _extract_lab_numbers(text: str) -> list[str]:
    """从 OCR 原始文本中提取检验数值指纹，用于与 LLM 清洗后数值交叉对账。

    策略：
    - 提取所有浮点数和整数
    - 过滤掉年份（2020-2030）、日期片段、纯序号
    - 保留检验结果级别的数字（如 5.55, 109, 17.5, 0.85）
    """
    # 移除日期格式
    cleaned = re.sub(r'\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?', '', text)
    cleaned = re.sub(r'\d{4}[-/]\d{1,2}[-/]\d{1,2}', '', cleaned)
    # 移除时间格式
    cleaned = re.sub(r'\d{1,2}:\d{2}(:\d{2})?', '', cleaned)

    # 提取所有数值
    all_nums = re.findall(r'(?<![-/])\b(\d+\.\d+|\d+)\b(?![-/年月日号])', cleaned)

    result = []
    for n in all_nums:
        val = float(n)
        if 2000 <= val <= 2099 and len(n) == 4 and '.' not in n:
            continue
        if '.' not in n and val >= 100000:
            continue
        result.append(n)
    return result


# ---------------------------------------------------------------------------
#  主入口
# ---------------------------------------------------------------------------

async def fetch_medical_report_ocr(image_path: str) -> tuple[str, list[str]]:
    """使用 PPStructureV3 + Qwen3.5-35B-A3B 识别医疗化验单图片。

    Pipeline: PPStructureV3 → 去 HTML 标签 → Qwen LLM 结构化 → 6 列 Markdown

    Returns:
        (cleaned_markdown, ocr_raw_numbers)。失败时返回 ("", [])。
        ocr_raw_numbers: PPStructureV3 原始文本中提取的数值指纹，用于双源对账。
    """
    t0 = time.time()

    # Step 1: PPStructureV3 → 纯文本
    try:
        raw_text = _extract_text_from_image(image_path)
    except Exception as e:
        logger.error(f"[LocalOCR] PP-StructureV3 推理失败: {type(e).__name__}: {e}")
        return "", []

    ppocr_elapsed = time.time() - t0
    logger.info(f"[LocalOCR] PPStructureV3 完成，耗时 {ppocr_elapsed:.1f}s，提取 {len(raw_text)} 字符")

    if not raw_text.strip():
        logger.warning("[LocalOCR] PPStructureV3 未提取到有效文本")
        return "", []

    # Step 1.5: 提取 OCR 原始数值指纹（在 LLM 清洗之前）
    ocr_raw_numbers = _extract_lab_numbers(raw_text)
    logger.info(f"[LocalOCR] 提取到 {len(ocr_raw_numbers)} 个 OCR 原始数值指纹")

    # 保存中间态供调试
    try:
        Path(image_path).with_suffix('.ocr_text.txt').write_text(raw_text, encoding='utf-8')
    except Exception:
        pass

    # Step 2: Qwen3.5-35B-A3B → 结构化 Markdown
    try:
        markdown, llm_elapsed = await _call_qwen(raw_text)
    except Exception as e:
        logger.error(f"[LocalOCR] Qwen API 调用失败: {type(e).__name__}: {e}")
        return "", ocr_raw_numbers

    total_elapsed = time.time() - t0
    logger.info(f"[LocalOCR] Qwen 完成，LLM 耗时 {llm_elapsed:.1f}s，总耗时 {total_elapsed:.1f}s")

    if not markdown.strip():
        logger.warning("[LocalOCR] Qwen 返回空内容")
        return "", ocr_raw_numbers

    # 保存最终 Markdown 供调试
    try:
        Path(image_path).with_suffix('.local_ocr.md').write_text(markdown, encoding='utf-8')
    except Exception:
        pass

    return markdown, ocr_raw_numbers
