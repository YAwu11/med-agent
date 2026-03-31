"""硅基流动 PaddleOCR-VL-1.5 异步客户端

调用 SiliconFlow 的 OpenAI 兼容 Vision 接口，
将化验单图片精准识别并输出结构化 Markdown 文档。

架构决策（v2 重构）：
- PaddleOCR-VL 负责高精度"读字"（OCR 识别），它的指令遵循能力弱，
  返回的通常是无格式纯文本。
- 当纯文本检测到未包含 Markdown 表格语法时，调用 Qwen2.5-7B 极速模型
  将纯文本清洗为带表格语法的结构化 Markdown 文档。
- 全链路输出 Markdown 字符串，前端直接用 Streamdown/remarkGfm 渲染，
  彻底消除 JSON 转义崩溃和 HTML 标签冗余问题。
"""

import base64
import logging
import os
import re

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)

SILICONFLOW_API_URL = "https://api.siliconflow.cn/v1/chat/completions"
# 默认使用该模型，可以在 .env 中动态覆盖
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


def _fix_arrow_placement(md: str) -> str:
    """确定性后处理：将参考区间列里的 ↑/↓ 箭头移到结果列。

    不依赖模型遵循指令，而是在最终输出上用正则强制修正。
    适配两种常见错位模式：
      错位1: | ... | 109 | ↓130-175 | ...   →  | ... | 109 ↓ | 130-175 | ...
      错位2: | ... | 109 | ↓ 130-175 | ...  →  | ... | 109 ↓ | 130-175 | ...
    """
    fixed_lines = []
    for line in md.split("\n"):
        stripped = line.strip()
        if not (stripped.startswith("|") and stripped.endswith("|")):
            fixed_lines.append(line)
            continue

        cells = stripped[1:-1].split("|")
        # 跳过表头和分隔行
        if len(cells) < 5 or all(re.match(r'^[\s\-:]+$', c) for c in cells):
            fixed_lines.append(line)
            continue

        modified = False
        for i in range(len(cells)):
            cell = cells[i].strip()
            # 检测此列以 ↑ 或 ↓ 开头的模式（箭头 + 数字范围 = 参考区间被污染）
            arrow_match = re.match(r'^([↑↓])\s*(.+)$', cell)
            if arrow_match and i > 0:
                arrow = arrow_match.group(1)
                rest = arrow_match.group(2).strip()
                # 将箭头追加到前一列（结果列）
                prev = cells[i - 1].strip()
                if prev and not prev.endswith(arrow):
                    cells[i - 1] = f" {prev} {arrow} "
                else:
                    cells[i - 1] = f" {prev} "
                cells[i] = f" {rest} "
                modified = True

        if modified:
            fixed_lines.append("|" + "|".join(cells) + "|")
        else:
            fixed_lines.append(line)

    return "\n".join(fixed_lines)


@retry(
    stop=stop_after_attempt(2),
    wait=wait_exponential(min=2, max=6),
    reraise=True,
)
async def fetch_medical_report_ocr(image_path: str) -> str:
    """调用 SiliconFlow 视觉语言模型识别图片，返回结构化 Markdown 字符串。

    v2 架构：输出类型从 list[dict] 改为 str (Markdown)。
    全链路输出 Markdown，前端直接渲染，不再需要 JSON 中间格式。

    Returns:
        结构化 Markdown 文档字符串。失败时返回空字符串。
    """
    api_key = os.getenv("SILICONFLOW_OCR_API_KEY")
    if not api_key:
        raise ValueError(
            "SILICONFLOW_OCR_API_KEY 未配置。"
            "请在 .env 文件中设置该密钥以使用 PaddleOCR-VL 引擎。"
        )

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

    # 提示词：用极其具体的格式示例引导 PaddleOCR-VL 直接输出 Markdown
    # 如果模型遵循了提示词，_has_markdown_table() 检测通过后将直接采纳，跳过 Qwen 清洗
    system_prompt = (
        "请将图片中的所有文字完整提取，并严格按以下 Markdown 格式输出：\n\n"
        "# 报告标题\n\n"
        "患者基本信息用列表格式列出。\n\n"
        "检验数据必须用 Markdown 表格输出，示例：\n"
        "| 序号 | 检验项目 | 英文 | 结果 | 参考区间 | 单位 |\n"
        "| --- | --- | --- | --- | --- | --- |\n"
        "| 1 | 白细胞计数 | WBC | 5.55 | 3.5-9.5 | ×10⁹/L |\n\n"
        "单位中的乘号写 × 符号，异常值在结果后标注 ↑ 或 ↓。\n"
        "只输出 Markdown 文档，不要任何额外解释。"
    )

    payload = {
        "model": MODEL_NAME,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{img_mime};base64,{img_b64}"}},
                    {"type": "text", "text": system_prompt}
                ]
            }
        ],
        "temperature": 0.1,
        "top_p": 0.1
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
            return ""

        data = resp.json()

    if "choices" not in data or not data["choices"]:
        logger.error("硅基流动 API 返回的内容为空或结构异常")
        return ""

    raw_text = data["choices"][0]["message"].get("content", "")

    # 如果 PaddleOCR-VL 已经输出了带 Markdown 表格的格式化内容，直接采纳
    if _has_markdown_table(raw_text):
        logger.info("[PaddleOCR] 模型已返回结构化 Markdown，直接采纳")
        return _fix_arrow_placement(raw_text)

    # 否则调用极速小模型将纯文本清洗为 Markdown 表格文档
    logger.info("[PaddleOCR] 模型返回纯文本，触发 Qwen 极速 Markdown 清洗管道")
    cleaned_md = await _reformat_to_markdown(raw_text, api_key)
    if cleaned_md:
        return _fix_arrow_placement(cleaned_md)

    # 彻底兜底：将原始文本包装为最基本的 Markdown
    logger.warning("[PaddleOCR] 清洗管道也失败了，使用原始文本降级包装")
    return f"## 原始识别结果\n\n{raw_text}\n\n> ⚠️ 以上内容由 VLM 自动识别，未能结构化排版。"


async def _reformat_to_markdown(raw_text: str, api_key: str) -> str | None:
    """使用极速的 Qwen2.5-7B 将杂乱的 OCR 纯文本清洗为结构化 Markdown 文档。

    输出 Markdown 而非 JSON/HTML，核心优势：
    - Markdown 表格语法极短（400 tokens vs HTML 的 1500 tokens），生成速度快 3 倍
    - 无 JSON 转义风险（不存在 \\times 崩溃问题）
    - 前端可直接用 remarkGfm 渲染
    """
    system_prompt = (
        "你是医疗化验单文本清洗专家。将用户提供的杂乱 OCR 文本整理为结构清晰的 Markdown 文档。\n\n"
        "【输出格式要求】：\n"
        "1. 第一行必须是标题，用 # 开头（如：# 血常规检验报告）\n"
        "2. 患者信息、送检信息等用列表格式列出\n"
        "3. 检验数据必须整理成 Markdown 表格（用 | 分隔列），表头包含：序号、检验项目、英文缩写、结果、参考区间、单位\n"
        "4. 【极其重要】异常值的 ↑ 或 ↓ 箭头必须紧跟在'结果'列的数字后面，绝不能放在'参考区间'列！\n"
        "   ✅ 正确：| 2 | 血红蛋白 | HGB | 109 ↓ | 130-175 | g/L |\n"
        "   ❌ 错误：| 2 | 血红蛋白 | HGB | 109 | ↓130-175 | g/L |\n"
        "5. 单位中的乘号直接写 ×（Unicode），不要写 LaTeX 公式\n"
        "6. 只输出 Markdown 文档本身，不要有任何额外解释或开场白\n\n"
        "【Markdown 表格示例】：\n"
        "| 序号 | 检验项目 | 英文 | 结果 | 参考区间 | 单位 |\n"
        "| --- | --- | --- | --- | --- | --- |\n"
        "| 1 | 白细胞计数 | WBC | 5.55 | 3.5-9.5 | ×10⁹/L |\n"
        "| 2 | 血红蛋白 | HGB | 109 ↓ | 130-175 | g/L |\n"
        "| 3 | 淋巴细胞百分数 | LY% | 17.5 ↓ | 20-50 | % |\n"
    )

    payload = {
        "model": "Pro/Qwen/Qwen2.5-7B-Instruct",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": raw_text[:4000]}  # 防止文本过长
        ],
        "temperature": 0.1,
        "max_tokens": 2000
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
