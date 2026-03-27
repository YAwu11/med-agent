"""百度医疗报告 OCR JSON → Markdown 表格转换器

将百度 medical_report_detection 返回的 Item 数组转成高信噪比 Markdown 表格。

处理规则：
- 空字符串字段 → 显示为 "—"
- 全空行跳过
- 低价值列（"仪器类型"、"测试方法"）自动过滤
- 异常提示（↑/↓）保留原始箭头符号
"""


def format_to_markdown(ocr_json: dict) -> str:
    """将百度 OCR 原始 JSON 转换为 Markdown 表格。

    Args:
        ocr_json: 百度 medical_report_detection 返回的 JSON

    Returns:
        Markdown 格式的化验单表格文本
    """
    # 百度 OCR 数据结构： {"words_result": {"Item": [[{...}, {...}], ...]}}
    words_result = ocr_json.get("words_result", {})
    items = words_result.get("Item") or words_result.get("item")
    if not items:
        # Fallback in case it's at the top level for some reason
        items = ocr_json.get("Item") or ocr_json.get("item")
    if not items:
        return "_OCR 未识别到有效的化验项目。_"

    # 收集所有出现过的列名（保持顺序）
    columns: list[str] = []
    seen: set[str] = set()
    for row in items:
        for cell in row:
            name = cell.get("word_name", "")
            if name and name not in seen:
                columns.append(name)
                seen.add(name)

    if not columns:
        return "_OCR 数据格式异常，无法解析列名。_"

    # 过滤低价值列
    LOW_VALUE_COLS = {"仪器类型", "测试方法"}
    columns = [c for c in columns if c not in LOW_VALUE_COLS]

    # 构建表头
    lines = ["## 化验单识别结果\n"]
    lines.append("| " + " | ".join(columns) + " |")
    lines.append("| " + " | ".join(["---"] * len(columns)) + " |")

    # 构建数据行
    for row in items:
        row_dict = {
            cell.get("word_name", ""): cell.get("word", "") for cell in row
        }
        cells = []
        for col in columns:
            val = row_dict.get(col, "").strip()
            cells.append(val if val else "—")
        # 跳过完全空的行
        if all(c == "—" for c in cells):
            continue
        lines.append("| " + " | ".join(cells) + " |")

    lines.append("")
    lines.append("> ⚠️ 以上内容由 OCR 自动识别，仅供参考。请以原始化验单为准。")

    return "\n".join(lines)
