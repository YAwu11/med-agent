"""硅基流动 PaddleOCR-VL-1.5 异步客户端

调用 SiliconFlow 的 OpenAI 兼容 Vision 接口，
将化验单图片精准识别并输出结构化 Markdown 文档。

架构决策（v4 重构）：
- PaddleOCR-VL 使用简洁英文 prompt `Convert the document to markdown.`
  在 SiliconFlow API 下实测箭头保留率最高（LaTeX 格式，经 _clean_latex_symbols 转换）。
- 三路分发：
  1. 已包含 Markdown 表格 → 直接采纳
  2. 包含 <fcel> 结构化标记 → 直接解析为 Markdown（跳过 Qwen）
  3. 纯文本 → 调用 Qwen2.5-7B 极速模型清洗为 Markdown
- 输出统一要求：箭头放在独立「异常」列，数字在「结果」列保持纯净。
- 新增 token 垃圾检测：连续重复字符超过阈值判定为模型幻觉，标记失败。
"""

import base64
from loguru import logger
import os
import re
from pathlib import Path

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential


SILICONFLOW_API_URL = "https://api.siliconflow.cn/v1/chat/completions"
MODEL_NAME = os.getenv("SILICONFLOW_OCR_MODEL", "PaddlePaddle/PaddleOCR-VL-1.5")

def _extract_title_from_markdown(md_text: str) -> str | None:
    """从 Markdown 文本中提取第一个标题（# 或 ## 开头的行）作为证据标题"""
    for line in md_text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped.lstrip("# ").strip()
        if stripped.startswith("## "):
            return stripped.lstrip("# ").strip()
    return None

def _has_markdown_table(text: str) -> bool:
    """检测文本中是否已经包含 Markdown 表格语法（竖线分隔 + 分隔行）"""
    lines = text.split("\n")
    pipe_lines = 0
    has_separator = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            pipe_lines += 1
            # 检测分隔行 |---|---|
            cells = stripped[1:-1].split("|")
            if cells and all(re.match(r'^[\s\-:]+$', c) for c in cells):
                has_separator = True
    return pipe_lines >= 3 and has_separator

def _clean_latex_symbols(md: str) -> str:
    """清理 VLM 返回的 LaTeX 内联数学公式符号，由于前端简易 Markdown 渲染不含 KaTeX。"""
    # 替换独立的 \mu 为 μ
    md = re.sub(r'\\mu\b', 'μ', md)
    
    # 替换箭头
    md = md.replace('\\uparrow', '↑')
    md = md.replace('\\downarrow', '↓')

    # 暴力拆除所有大模型生成的 LaTeX 行内数学公式包装框 \( ... \)
    # 因为在纯医疗表格里根本不需要数学公式渲染
    md = md.replace('\\(', '')
    md = md.replace('\\)', '')
    
    # 清理其他常见 LaTeX
    md = md.replace('\\times', '×')
    md = md.replace('\\dagger', '†')
    
    return md


def _is_garbage_output(text: str) -> bool:
    """检测模型输出是否为 token 循环垃圾（如全是 '1111...' 或 '| | | ...'）。
    
    判定标准：
    - 文本中最高频字符占比 > 60%（排除空白）
    - 或连续重复 pattern 超过 50 次
    """
    if not text or len(text) < 100:
        return False
    # 统计非空白字符频次
    non_ws = text.replace(' ', '').replace('\n', '').replace('\t', '')
    if not non_ws:
        return True
    from collections import Counter
    freq = Counter(non_ws)
    top_char, top_count = freq.most_common(1)[0]
    if top_count / len(non_ws) > 0.6:
        logger.warning(f"[PaddleOCR] 垃圾检测：字符 '{top_char}' 占比 {top_count/len(non_ws):.0%}")
        return True
    # 检测连续重复 pattern（如 "| | | | ..."）
    if re.search(r'(.{1,10})\1{50,}', text):
        logger.warning("[PaddleOCR] 垃圾检测：发现长连续重复 pattern")
        return True
    return False


def _has_fcel_format(text: str) -> bool:
    """检测文本是否包含 PaddleOCR-VL 的 <fcel>/<ecel>/<nl> 结构化标记。"""
    fcel_count = text.count('<fcel>')
    nl_count = text.count('<nl>')
    return fcel_count >= 3 and nl_count >= 1


def _parse_fcel_to_markdown(raw_text: str) -> str:
    """将 PaddleOCR-VL 的 <fcel>/<ecel>/<nl> 结构化输出解析为标准 Markdown 表格。

    两阶段列检测：
      1) 表头关键词匹配 — 若首行含「项目名称/结果/单位/参考范围」等关键词，
         直接用关键词定位各列，并自动补偿数据行比表头多出的序号列偏移。
      2) 启发式回退 — 无可识别表头时，用箭头/数值/范围模式猜测列角色，
         并跳过纯递增序号列以防误判。
    """
    cleaned = _clean_latex_symbols(raw_text)

    # ── 解析行/单元格 ──────────────────────────────────
    row_texts = re.split(r'<nl>', cleaned)

    rows: list[list[str]] = []
    for row_text in row_texts:
        row_text = row_text.strip()
        if not row_text:
            continue
        row_text = row_text.replace('<lcel>', '<fcel>')
        cells: list[str] = []
        tokens = re.split(r'(<fcel>|<ecel>)', row_text)
        i = 0
        while i < len(tokens):
            token = tokens[i]
            if token == '<fcel>':
                content = tokens[i + 1].strip() if i + 1 < len(tokens) else ''
                cells.append(content)
                i += 2
            elif token == '<ecel>':
                cells.append('')
                i += 1
            else:
                i += 1
        if cells:
            rows.append(cells)

    if not rows:
        return ''

    # 记录每行原始列数（补齐前）
    original_lengths = [len(r) for r in rows]
    max_cols = max(original_lengths)
    for r in rows:
        while len(r) < max_cols:
            r.append('')

    # ── 策略 1: 表头关键词检测 ─────────────────────────
    _HEADER_KW: dict[str, list[str]] = {
        'name':   ['项目名称', '项目', '检验项目', '检测项目'],
        'result': ['结果', '检测结果', '检验结果'],
        'unit':   ['单位'],
        'ref':    ['参考范围', '参考值', '正常范围', '正常值'],
        'arrow':  ['异常', '标记', '标志', '提示'],
    }

    header_map: dict[str, int] | None = None
    data_start = 0
    col_offset = 0

    first_row = rows[0]
    matched_roles: dict[str, int] = {}
    for idx, cell in enumerate(first_row):
        cell_clean = cell.strip()
        if not cell_clean:
            continue
        for role, keywords in _HEADER_KW.items():
            if any(kw in cell_clean for kw in keywords):
                matched_roles[role] = idx
                break

    if len(matched_roles) >= 2:
        header_map = matched_roles
        data_start = 1  # 跳过表头行

        # 数据行比表头多出列时补偿偏移（常见：序号列未出现在表头中）
        if len(rows) > 1:
            data_max_len = max(original_lengths[1:])
            header_len = original_lengths[0]
            col_offset = max(0, data_max_len - header_len)
            if col_offset > 0:
                header_map = {role: idx + col_offset for role, idx in header_map.items()}

    data_rows = rows[data_start:]
    if not data_rows:
        return ''

    # ── 确定各列角色 ──────────────────────────────────
    if header_map:
        name_col = header_map.get('name', col_offset)
        value_col = header_map.get('result', -1)
        arrow_col = header_map.get('arrow', -1)
        unit_col = header_map.get('unit', -1)
        ref_col = header_map.get('ref', -1)
    else:
        # ── 策略 2: 启发式检测 ────────────────────────
        name_col = 0

        # 箭头列
        arrow_col = -1
        for col_idx in range(max_cols):
            arrow_count = sum(1 for r in data_rows if '↑' in r[col_idx] or '↓' in r[col_idx])
            if arrow_count >= 1:
                arrow_col = col_idx
                break

        # 数值列：优先选有小数点的列，排除纯递增序号列
        value_col = -1
        best_score = 0
        for col_idx in range(max_cols):
            vals = [r[col_idx].strip() for r in data_rows if r[col_idx].strip()]
            num_count = sum(1 for v in vals if re.match(r'^\d+\.?\d*$', v))
            if num_count < len(data_rows) * 0.4:
                continue
            # 跳过纯递增序号列 (1,2,3,...)
            if vals and all(re.match(r'^\d+$', v) for v in vals):
                ints = [int(v) for v in vals if v.isdigit()]
                if ints == list(range(ints[0], ints[0] + len(ints))):
                    continue
            decimal_count = sum(1 for v in vals if '.' in v)
            score = num_count + decimal_count
            if score > best_score:
                best_score = score
                value_col = col_idx

        # 参考范围列
        ref_col = -1
        for col_idx in range(max_cols):
            ref_count = sum(1 for r in data_rows if re.search(r'\d+\.?\d*\s*-\s*\d+\.?\d*', r[col_idx]))
            if ref_count >= len(data_rows) * 0.3:
                ref_col = col_idx
                break

        unit_col = -1  # 由后续推断

    # ── 构建标准化行 ──────────────────────────────────
    md_rows: list[list[str]] = []

    for row in data_rows:
        # 项目名称
        name = row[name_col] if name_col < len(row) else ''
        name = name.strip()
        # 表头映射且有偏移时，把前面的序号列拼到名称前
        if header_map and col_offset > 0:
            prefix = ' '.join(row[c].strip() for c in range(col_offset) if row[c].strip())
            if prefix:
                name = f"{prefix} {name}"

        result_val = row[value_col] if 0 <= value_col < len(row) else ''
        arrow_val = row[arrow_col] if 0 <= arrow_col < len(row) else ''
        ref_val = row[ref_col] if 0 <= ref_col < len(row) else ''

        # 单位列
        if unit_col >= 0:
            unit_val = row[unit_col] if unit_col < len(row) else ''
        elif value_col >= 0 and ref_col >= 0 and ref_col - value_col >= 2:
            u_col = value_col + 1
            unit_val = row[u_col] if u_col < len(row) else ''
        elif value_col >= 0 and value_col + 1 < len(row):
            candidate = row[value_col + 1]
            if candidate and not re.match(r'^\d', candidate) and '↑' not in candidate and '↓' not in candidate:
                unit_val = candidate
            else:
                unit_val = ''
        else:
            unit_val = ''

        # 箭头清洗：仅保留 ↑ 或 ↓
        arrow_clean = ''
        if '↑' in arrow_val:
            arrow_clean = '↑'
        elif '↓' in arrow_val:
            arrow_clean = '↓'

        md_rows.append([name, result_val, arrow_clean, unit_val, ref_val])

    # ── 输出 Markdown（含自增序号列）────────────────────
    headers = ['序号', '项目名称', '结果', '异常', '单位', '参考范围']
    separator = ['---', '---', '---', '---', '---', '---']

    lines = []
    lines.append('| ' + ' | '.join(headers) + ' |')
    lines.append('| ' + ' | '.join(separator) + ' |')
    for idx, row in enumerate(md_rows, 1):
        lines.append('| ' + ' | '.join([str(idx)] + row) + ' |')

    return '\n'.join(lines)


def _extract_lab_numbers(text: str) -> list[str]:
    """从 OCR 原始文本中提取检验数值指纹，用于与 LLM 清洗后数值交叉对账。

    策略：
    - 提取所有浮点数和整数
    - 过滤掉年份（2020-2030）、日期片段、纯序号（1-位数字独立出现）
    - 保留检验结果级别的数字（如 5.55, 109, 17.5, 0.85）
    """
    # 先移除日期格式以避免误捕
    cleaned = re.sub(r'\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?', '', text)
    cleaned = re.sub(r'\d{4}[-/]\d{1,2}[-/]\d{1,2}', '', cleaned)
    # 移除时间格式
    cleaned = re.sub(r'\d{1,2}:\d{2}(:\d{2})?', '', cleaned)

    # 提取所有数值（含小数）: 支持单个数字和浮点数
    all_nums = re.findall(r'(?<![-/])\b(\d+\.\d+|\d+)\b(?![-/年月日号])', cleaned)

    # 过滤不像检验值的数字
    result = []
    for n in all_nums:
        val = float(n)
        # 排除年份范围的4位数字（粗略过滤）
        if 2000 <= val <= 2099 and len(n) == 4 and '.' not in n:
            continue
        # 排除过大的纯整数（通常是编号、电话等）
        if '.' not in n and val >= 100000:
            continue
        result.append(n)

    return result

@retry(
    stop=stop_after_attempt(2),
    wait=wait_exponential(min=2, max=6),
    reraise=True,
)
async def fetch_medical_report_ocr(image_path: str) -> tuple[str, list[str]]:
    """调用 SiliconFlow 视觉语言模型识别图片，返回结构化 Markdown + OCR 数值指纹。

    v3 架构变更（ADR-035）：
    - 返回值从 str 改为 tuple[str, list[str]]，第二项为 OCR 原始数值指纹。
    - 用于前端与 LLM 清洗后数值做交叉对账，检测大模型数值幻觉。

    Returns:
        (cleaned_markdown, ocr_raw_numbers)。失败时返回 ("", [])。
    """
    api_key = os.getenv("SILICONFLOW_OCR_API_KEY")
    if not api_key:
        raise ValueError(
            "SILICONFLOW_OCR_API_KEY 未配置。"
            "请在 .env 文件中设置该密钥以使用 PaddleOCR-VL 引擎。"
        )  # noqa: will be caught by caller and return ("", [])

    # 读取并进行 Base64 编码
    with open(image_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode("utf-8")

    # 获取图片的 MIME 类型
    ext = os.path.splitext(image_path)[1].lower()
    img_mime = "image/png"
    if ext in [".jpg", ".jpeg"]:
        img_mime = "image/jpeg"
    elif ext == ".webp":
        img_mime = "image/webp"

    # 实测结论：简单英文 prompt 在 SiliconFlow API 下箭头保留率最高
    # - 官方 <|grounding|> 触发词不产生 Markdown 表格
    # - 中文"保留箭头"指令反而导致模型漏掉部分 ↓ 箭头
    # - 简单英文 prompt 虽然输出 LaTeX 箭头 \(\uparrow\) 但经 _clean_latex_symbols 清洗后完整保留
    ocr_prompt = "Convert the document to markdown."

    payload = {
        "model": MODEL_NAME,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{img_mime};base64,{img_b64}"}},
                    {"type": "text", "text": ocr_prompt}
                ]
            }
        ],
        "temperature": 0.0,
        "max_tokens": 4096
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    # 大模型请求耗时较长，增加超时容忍度 (90s)
    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(SILICONFLOW_API_URL, json=payload, headers=headers)

        if resp.status_code != 200:
            logger.error(f"硅基流动 API 错误 HTTP {resp.status_code}: {resp.text}")
            return "", []

        data = resp.json()

    if "choices" not in data or not data["choices"]:
        logger.error("硅基流动 API 返回的内容为空或结构异常")
        return "", []

    raw_text = data["choices"][0]["message"].get("content", "")

    # [Observability] 将大模型的原始视觉识别结果作为底稿落盘，供肉眼对比查错
    try:
        raw_path = Path(image_path).with_suffix('.raw_ocr.txt')
        raw_path.write_text(raw_text, encoding="utf-8")
        logger.info(f"[PaddleOCR] 已保存原始识别数据至 {raw_path.name}")
    except Exception as e:
        logger.warning(f"无法保存原始 OCR 测井文件: {e}")

    # [v4] 垃圾检测：token 循环（如 '1111...' 或 '| | | ...'）直接判死
    if _is_garbage_output(raw_text):
        logger.error(f"[PaddleOCR] 检测到 token 循环垃圾输出 ({len(raw_text)} chars)，放弃本次识别")
        return "", []

    # [ADR-035] 在此处提取 OCR 原始数值指纹（这是大模型清洗前的真实值）
    ocr_raw_numbers = _extract_lab_numbers(raw_text)
    logger.info(f"[PaddleOCR] 提取到 {len(ocr_raw_numbers)} 个原始数值指纹")

    # ── 三路分发 ──────────────────────────────────────────────

    # 路径 1: PaddleOCR-VL 已经输出了带 Markdown 表格的格式化内容
    if _has_markdown_table(raw_text):
        logger.info("[PaddleOCR] 路径1: 模型已返回结构化 Markdown，直接采纳")
        final_md = _clean_latex_symbols(raw_text)
        _save_debug_file(image_path, final_md)
        return final_md, ocr_raw_numbers

    # 路径 2: PaddleOCR-VL 返回 <fcel> 结构化标记（跳过 Qwen，直接解析）
    if _has_fcel_format(raw_text):
        logger.info("[PaddleOCR] 路径2: 检测到 <fcel> 结构化标记，直接解析为 Markdown")
        fcel_md = _parse_fcel_to_markdown(raw_text)
        if fcel_md:
            _save_debug_file(image_path, fcel_md)
            return fcel_md, ocr_raw_numbers
        logger.warning("[PaddleOCR] <fcel> 解析失败，降级到 Qwen 清洗")

    # 路径 3: 纯文本 → 调用 LLM 清洗
    clean_model = os.getenv("SILICONFLOW_CLEAN_MODEL", "Pro/Qwen/Qwen2.5-7B-Instruct")
    logger.info(f"[PaddleOCR] 路径3: 纯文本，使用 {clean_model} 清洗")
    cleaned_md = await _reformat_to_markdown(raw_text, api_key, model=clean_model)
    if cleaned_md:
        _save_debug_file(image_path, cleaned_md)
        return cleaned_md, ocr_raw_numbers

    # 彻底兜底：将原始文本包装为最基本的 Markdown
    logger.warning("[PaddleOCR] 清洗管道也失败了，使用原始文本降级包装")
    return f"## 原始识别结果\n\n{raw_text}\n\n> ⚠️ 以上内容由 VLM 自动识别，未能结构化排版。", ocr_raw_numbers


def _save_debug_file(image_path: str, md: str) -> None:
    """保存清洗后的 Markdown 到调试文件。"""
    try:
        Path(image_path).with_suffix('.qwen_cleaned.md').write_text(md, encoding="utf-8")
    except Exception:
        pass

async def _reformat_to_markdown(raw_text: str, api_key: str, *, model: str = "Pro/Qwen/Qwen2.5-7B-Instruct") -> str | None:
    """使用 LLM 将杂乱的 OCR 纯文本清洗为结构化 Markdown 文档。

    Args:
        model: SiliconFlow 模型名，可通过环境变量 SILICONFLOW_CLEAN_MODEL 覆盖。
    """
    system_prompt = (
        "你是医疗化验单结构化专家。请将以下 OCR 纯文本清洗为标准 Markdown。\n"
        "【排版铁律】\n"
        "1. 第一行为真实化验单名称的 # 级别标题。\n"
        "2. 元数据用如下格式逐行列出（冒号后加空格），只输出原文确实存在的字段：\n"
        "   - 姓名: xxx\n"
        "   - 性别: xxx\n"
        "   - 年龄: xxx\n"
        "   - 科别: xxx\n"
        "   - 床号: xxx\n"
        "   - 病历号: xxx\n"
        "   - 标本类型: xxx\n"
        "   - 临床诊断: xxx\n"
        "   - 送检时间: xxx\n"
        "   - 检测仪器: xxx\n"
        "3. 然后输出 `## 核心检验数据` 标题，下面紧跟 Markdown 表格，列顺序固定为：\n"
        "   | 序号 | 项目名称 | 结果 | 异常 | 单位 | 参考范围 |\n"
        "   - 「序号」列放从 1 开始的自增整数。\n"
        "   - 「结果」列只放纯数字（如 5.55）。\n"
        "   - 「异常」列只放 ↑ 或 ↓ 或留空。\n"
        "4. 【最严红线一】：绝对禁止捏造原文本不存在的数值。如果原文有 ↑ 或 ↓ 箭头，绝不能丢弃。\n"
        "5. 【最严红线二】：绝对不允许把单位粘在结果数值里。\n"
        "6. 【最严红线三】：严禁使用 LaTeX。箭头用 ↑↓，单位中的 μ 直接用 Unicode μ。\n"
        "7. 【最严红线四】：所有检验项目必须全部输出，一项不能遗漏！原文有多少项就输出多少行。\n"
        "8. 【最严红线五】：严格按原文中化验单上的项目编号顺序输出，不得自行重排。"
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": raw_text[:4000]}  # 防止文本过长
        ],
        "temperature": 0.1,
        "max_tokens": 4096
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(SILICONFLOW_API_URL, json=payload, headers=headers)

            if resp.status_code != 200:
                logger.error(f"[Qwen清洗失败] 硅基流动返回状态码: {resp.status_code}")
                return None

            data = resp.json()
            cleaned_md = data["choices"][0]["message"].get("content", "")

            logger.info(f"[Qwen清洗成功] 输出 {len(cleaned_md)} 字符的 Markdown 文档")

            # 简单校验：输出中是否包含表格
            if "|" in cleaned_md and "---" in cleaned_md:
                return cleaned_md
            else:
                logger.warning("[Qwen清洗] 输出中未检测到表格，但仍然采纳为文本")
                return cleaned_md

    except Exception as e:
        logger.error(f"[Qwen清洗请求异常] {type(e).__name__}: {repr(e)}")
        return None
