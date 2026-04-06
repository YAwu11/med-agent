"""化验单数值校验器 (Lab Value Validator)。

架构决策 (ADR-036):
- 化验单 OCR 存在两类高危数值错误：
  1. 小数点位移：OCR 将 5.55 识别为 55.5 或 555，导致结果超出/符合参考区间但与箭头标记矛盾。
  2. 双源数值不一致：PaddleOCR 原始识别的数字与 Qwen 清洗后的数字不匹配，
     说明某一环节引入了数值幻觉或手滑错误。

- 本模块是一个纯函数式的后处理校验器，嵌入在 LabOCRAnalyzer 的 OCR 完成后、
  返回 AnalysisResult 之前。
- 校验结果以 warnings 列表形式挂载到 structured_data 中，前端可据此渲染告警 UI。
- 校验器不修改原始数据，仅追加诊断信息。
"""

import re
from dataclasses import dataclass, field
from loguru import logger


# ── 数据结构 ──────────────────────────────────────────────────

@dataclass
class ValueWarning:
    """单条数值异常告警。"""
    item_name: str          # 检验项目名称（如 "白细胞计数"）
    warning_type: str       # "decimal_shift" | "value_mismatch"
    severity: str           # "high" | "medium"
    message: str            # 人类可读的告警描述
    details: dict = field(default_factory=dict)  # 细节数据（便于前端渲染）

    def to_dict(self) -> dict:
        return {
            "item_name": self.item_name,
            "warning_type": self.warning_type,
            "severity": self.severity,
            "message": self.message,
            "details": self.details,
        }


# ── 策略一：小数点位移检测 ────────────────────────────────────

def _parse_reference_range(ref_str: str) -> tuple[float | None, float | None]:
    """解析参考区间字符串，返回 (low, high)。

    支持格式：
    - "3.5-9.5"  → (3.5, 9.5)
    - "130-175"  → (130.0, 175.0)
    - "<5.0"     → (None, 5.0)
    - ">10"      → (10.0, None)
    - "≤5.0"     → (None, 5.0)
    - "≥10"      → (10.0, None)
    - 无法解析   → (None, None)
    """
    if not ref_str:
        return None, None

    ref = ref_str.strip()

    # 范围格式: "3.5-9.5" 或 "3.5~9.5" 或 "3.5—9.5"
    range_match = re.match(r'(\d+\.?\d*)\s*[-~—]\s*(\d+\.?\d*)', ref)
    if range_match:
        return float(range_match.group(1)), float(range_match.group(2))

    # 上限格式: "<5.0" 或 "≤5.0"
    upper_match = re.match(r'[<≤]\s*(\d+\.?\d*)', ref)
    if upper_match:
        return None, float(upper_match.group(1))

    # 下限格式: ">10" 或 "≥10"
    lower_match = re.match(r'[>≥]\s*(\d+\.?\d*)', ref)
    if lower_match:
        return float(lower_match.group(1)), None

    return None, None


def _is_in_range(value: float, low: float | None, high: float | None) -> bool:
    """判断数值是否在参考区间内。"""
    if low is not None and value < low:
        return False
    if high is not None and value > high:
        return False
    return True


def _try_decimal_shifts(value: float) -> list[float]:
    """生成小数点位移的候选修正值。

    策略：将小数点左移/右移 1-2 位，生成可能的正确值。
    例如 555 → [55.5, 5.55, 5550]（只返回合理方向的移位）
    """
    candidates = []
    for shift in [0.1, 0.01, 10, 100]:
        candidate = round(value * shift, 4)
        if candidate > 0:
            candidates.append(candidate)
    return candidates


def detect_decimal_shift_errors(markdown_text: str) -> tuple[list[ValueWarning], str]:
    """从已清洗的 Markdown 表格中检测小数点位移错误并剥离隐藏列。

    检测逻辑：
    1. 解析表格的每一行，提取「项目名」「结果值」「箭头标记」「参考区间」
    2. 策略 A - 有箭头但数值在正常范围内 → 疑似小数点位移
       （比如真实值 55.5 被识别为 5.55，落在参考区间内但原图有 ↑ 箭头）
    3. 策略 B - 无箭头但数值在异常范围外 → 疑似小数点位移
       （比如真实值 5.55 被识别为 55.5，超出参考区间但原图无箭头）
    4. 对疑似错误的数值，尝试小数点位移找到能「自洽」的候选值
    """
    warnings: list[ValueWarning] = []
    lines = markdown_text.split("\n")

    # 定位表格区域：找到表头分隔行 (|---|---|)
    table_start = -1
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            cells = stripped[1:-1].split("|")
            if cells and all(re.match(r'^[\s\-:]+$', c) for c in cells):
                table_start = i + 1  # 数据从分隔行下一行开始
                break

    if table_start < 0:
        return warnings, markdown_text  # 没有找到表格

    # 获取表头行来定位列索引
    header_line = lines[table_start - 2].strip() if table_start >= 2 else ""
    header_cells = [c.strip() for c in header_line[1:-1].split("|")] if header_line.startswith("|") else []

    # 尝试智能定位「结果」列、「参考区间」列、「项目名」列、以及隐身通信列「数据类型」
    result_col_idx = _find_column_index(header_cells, ["结果", "result", "检验结果", "检测结果", "测定值", "检测值"])
    ref_col_idx = _find_column_index(header_cells, ["参考区间", "参考范围", "参考值", "reference", "正常范围", "正常值"])
    name_col_idx = _find_column_index(header_cells, ["检验项目", "项目", "项目名称", "名称", "item", "测试项目"])
    arrow_col_idx = _find_column_index(header_cells, ["异常", "标记", "flag", "异常标记", "异常提示"])
    type_col_idx = _find_column_index(header_cells, ["数据类型", "类型", "type"])
    seq_col_idx = _find_column_index(header_cells, ["序号", "编号", "no", "#"])

    # 如果无法定位到关键列，放弃检测
    if result_col_idx is None or ref_col_idx is None:
        logger.debug("[LabValidator] 无法定位结果列或参考区间列，跳过小数点位移检测")
        return warnings, markdown_text
        
    cleaned_lines = list(lines)

    # 剥离隐藏通信列「数据类型」
    if type_col_idx is not None:
        for i in range(table_start - 2, len(cleaned_lines)):
            line = cleaned_lines[i].strip()
            if not (line.startswith("|") and line.endswith("|")):
                continue
            cells = [c.strip() for c in line[1:-1].split("|")]
            if type_col_idx < len(cells):
                del cells[type_col_idx]
                cleaned_lines[i] = "|" + "|".join(f" {c} " if not re.match(r'^[\s\-:]+$', c) else c for c in cells) + "|"

    # 逐行解析数据 (继续使用未经改动的 lines 确保下标坐标正确)
    for i in range(table_start, len(lines)):
        line = lines[i].strip()
        if not (line.startswith("|") and line.endswith("|")):
            continue

        cells = [c.strip() for c in line[1:-1].split("|")]
        if len(cells) <= max(result_col_idx, ref_col_idx):
            continue

        # 提取项目名
        item_name = cells[name_col_idx] if name_col_idx is not None and name_col_idx < len(cells) else f"第{i}行"

        # 提取结果值、参考区间
        result_cell_raw = cells[result_col_idx]
        ref_cell = cells[ref_col_idx]
        ref_low, ref_high = _parse_reference_range(ref_cell)
        
        # HITL 双锁防呆机制：判断是否应该执行「纯数字粘连」洗刷
        # 1. 大模型认为是数值 2. 参考区间能被成功解析出数学边界
        data_type_cell = cells[type_col_idx] if type_col_idx is not None and type_col_idx < len(cells) else ""
        is_llm_numeric = "数值" in data_type_cell
        is_ref_math_bounded = ref_low is not None or ref_high is not None
        
        result_cell_cleaned = result_cell_raw
        if is_llm_numeric and is_ref_math_bounded:
            # 执行洗刷沙盘推演
            stickiness_map = str.maketrans('oOlIsSBZz', '001155822')
            cleaned_suggestion = result_cell_raw.translate(stickiness_map)
            
            if cleaned_suggestion != result_cell_raw:
                warnings.append(ValueWarning(
                    item_name=item_name,
                    warning_type="alphanumeric_blur",
                    severity="high",
                    message=f"「{item_name}」的结果 {result_cell_raw} 遭到英文字母粘连，系统建议修正为 {cleaned_suggestion}",
                    details={
                        "original_value": result_cell_raw,
                        "suggestion": cleaned_suggestion,
                        "row_index": i - table_start,
                        "col_index": result_col_idx
                    }
                ))
                # 注意：我们这里使用洗刷后的值继续向下走数学检测，但不对 markdown 文本做物理篡改（保留给 HITL 一键修复）
                result_cell_cleaned = cleaned_suggestion

        # 继续用清理后的值进行逻辑校验（防止 "5.O" 弄阻断了 float() 转换）
        # [v4] 优先从独立「异常」列获取箭头，如果没有则回退到结果列内联检测
        if arrow_col_idx is not None and arrow_col_idx < len(cells):
            arrow_cell = cells[arrow_col_idx].strip()
            has_up_arrow = "↑" in arrow_cell
            has_down_arrow = "↓" in arrow_cell
        else:
            has_up_arrow = "↑" in result_cell_cleaned
            has_down_arrow = "↓" in result_cell_cleaned
        has_arrow = has_up_arrow or has_down_arrow

        # 提取纯数值用于移位检测
        num_match = re.search(r'(\d+\.?\d*)', result_cell_cleaned)
        if not num_match:
            continue
        result_value = float(num_match.group(1))

        # 如果参考区间无法解析，跳过 (这部分已前置)
        if ref_low is None and ref_high is None:
            continue

        in_range = _is_in_range(result_value, ref_low, ref_high)

        # ── 策略 A：有箭头但数值在正常范围内 → 疑似小数点位移 ──
        if has_arrow and in_range:
            # 尝试找到移位后落入异常范围的候选值
            shifted_candidates = _try_decimal_shifts(result_value)
            plausible = []
            for candidate in shifted_candidates:
                if not _is_in_range(candidate, ref_low, ref_high):
                    # 进一步验证箭头方向一致性
                    if has_up_arrow and ref_high is not None and candidate > ref_high:
                        plausible.append(candidate)
                    elif has_down_arrow and ref_low is not None and candidate < ref_low:
                        plausible.append(candidate)

            if plausible:
                arrow_symbol = "↑" if has_up_arrow else "↓"
                warnings.append(ValueWarning(
                    item_name=item_name,
                    warning_type="decimal_shift",
                    severity="high",
                    message=(
                        f"「{item_name}」结果 {result_value} 在参考区间 {ref_cell} 内，"
                        f"但标记了 {arrow_symbol}。小数点可能位移，"
                        f"候选修正值：{', '.join(str(c) for c in plausible)}"
                    ),
                    details={
                        "original_value": result_value,
                        "reference_range": ref_cell,
                        "arrow": arrow_symbol,
                        "candidates": plausible,
                        "conflict": "arrow_but_in_range",
                        "row_index": i - table_start,
                        "col_index": result_col_idx
                    },
                ))

        # ── 策略 B：无箭头但数值在异常范围外 → 疑似小数点位移 ──
        elif not has_arrow and not in_range:
            # 尝试找到移位后落入正常范围的候选值
            shifted_candidates = _try_decimal_shifts(result_value)
            plausible = [c for c in shifted_candidates if _is_in_range(c, ref_low, ref_high)]

            if plausible:
                direction = "偏高" if (ref_high is not None and result_value > ref_high) else "偏低"
                warnings.append(ValueWarning(
                    item_name=item_name,
                    warning_type="decimal_shift",
                    severity="high",
                    message=(
                        f"「{item_name}」结果 {result_value} 超出参考区间 {ref_cell}（{direction}），"
                        f"但未标记异常箭头。小数点可能位移，"
                        f"候选修正值：{', '.join(str(c) for c in plausible)}"
                    ),
                    details={
                        "original_value": result_value,
                        "reference_range": ref_cell,
                        "direction": direction,
                        "candidates": plausible,
                        "conflict": "no_arrow_but_out_of_range",
                        "row_index": i - table_start,
                        "col_index": result_col_idx
                    },
                ))
            else:
                # 兜底：找不到自洽的移位候选，但"无箭头+超出范围"本身值得关注
                # 可能原因：箭头被 OCR 丢失、小数点移位幅度超出搜索范围、或原始化验单确实无标注
                direction = "偏高" if (ref_high is not None and result_value > ref_high) else "偏低"
                warnings.append(ValueWarning(
                    item_name=item_name,
                    warning_type="decimal_shift",
                    severity="medium",
                    message=(
                        f"「{item_name}」结果 {result_value} 超出参考区间 {ref_cell}（{direction}），"
                        f"但未标记异常箭头。可能是箭头标记丢失或数值识别有误，请人工核对"
                    ),
                    details={
                        "original_value": result_value,
                        "reference_range": ref_cell,
                        "direction": direction,
                        "candidates": [],
                        "conflict": "no_arrow_but_out_of_range",
                    },
                ))

    if warnings:
        logger.warning(
            f"[LabValidator] 小数点位移检测发现 {len(warnings)} 个疑似错误: "
            + ", ".join(w.item_name for w in warnings)
        )

    return warnings, "\n".join(cleaned_lines)


# ── 策略二：PaddleOCR vs Qwen 双源数值对账 ──────────────────

def cross_validate_numbers(
    ocr_raw_numbers: list[str],
    cleaned_markdown: str,
) -> list[ValueWarning]:
    """对比 PaddleOCR 原始数值指纹和 Qwen 清洗后 Markdown 中的数值。

    [v4] 简化为精确匹配：
    - 用户决策："大模型的幻觉要么就是数字误差很大，要么就是没误差"
    - 直接做集合差异，不需要模糊匹配
    - OCR 原始数值视为"相机看到的真相"
    """
    if not ocr_raw_numbers or not cleaned_markdown:
        return []

    from app.gateway.services.paddle_ocr import _extract_lab_numbers
    qwen_numbers = _extract_lab_numbers(cleaned_markdown)

    if not qwen_numbers:
        return []

    ocr_set = set(ocr_raw_numbers)
    qwen_set = set(qwen_numbers)

    warnings: list[ValueWarning] = []

    # Qwen 新增的数字（OCR 中不存在）→ 可能是幻觉
    qwen_only = qwen_set - ocr_set
    qwen_only_filtered = {n for n in qwen_only if not _is_likely_serial_number(n)}

    if qwen_only_filtered:
        warnings.append(ValueWarning(
            item_name="(全局对账)",
            warning_type="value_mismatch",
            severity="medium",
            message=(
                f"清洗后出现了 {len(qwen_only_filtered)} 个 OCR 原文中不存在的数字，"
                f"可能为大模型数值幻觉：{', '.join(sorted(qwen_only_filtered))}"
            ),
            details={
                "source": "qwen_hallucination",
                "qwen_only_values": sorted(qwen_only_filtered),
            },
        ))

    # OCR 有但 Qwen 丢失的数字 → 可能是遗漏（仅数量 ≥3 时告警）
    ocr_only = ocr_set - qwen_set
    ocr_only_filtered = {n for n in ocr_only if not _is_likely_serial_number(n)}

    if len(ocr_only_filtered) >= 3:
        warnings.append(ValueWarning(
            item_name="(全局对账)",
            warning_type="value_mismatch",
            severity="medium",
            message=(
                f"OCR 原文中有 {len(ocr_only_filtered)} 个数字在清洗结果中消失，"
                f"请核对是否有遗漏：{', '.join(sorted(ocr_only_filtered))}"
            ),
            details={
                "source": "qwen_omission",
                "ocr_only_values": sorted(ocr_only_filtered),
            },
        ))

    if warnings:
        logger.warning(
            f"[LabValidator] 双源数值对账发现 {len(warnings)} 个异常: "
            + "; ".join(w.message[:60] for w in warnings)
        )

    return warnings


# ── 工具函数 ──────────────────────────────────────────────────

def _find_column_index(header_cells: list[str], keywords: list[str]) -> int | None:
    """根据关键词在表头中模糊匹配列索引。"""
    for idx, cell in enumerate(header_cells):
        cell_lower = cell.lower().strip()
        for kw in keywords:
            if kw.lower() in cell_lower:
                return idx
    return None


def _is_likely_serial_number(value_str: str) -> bool:
    """判断一个数字字符串是否可能是表格序号（1-30 的整数）。"""
    if "." in value_str:
        return False
    try:
        v = int(value_str)
        return 1 <= v <= 30
    except ValueError:
        return False


# ── 统一入口 ──────────────────────────────────────────────────

def validate_lab_values(
    cleaned_markdown: str,
    ocr_raw_numbers: list[str],
) -> tuple[str, list[dict]]:
    """化验单数值校验的统一入口。

    同时运行两个策略：
    1. 小数点位移检测（基于参考区间 + 箭头的自洽性检查）
    2. 双源数值对账（PaddleOCR 原始数值 vs Qwen 清洗后数值）

    Args:
        cleaned_markdown: Qwen 清洗后的 Markdown 全文
        ocr_raw_numbers: PaddleOCR 原始数值指纹列表

    Returns:
        (剔除通信列后的纯净Markdown字符串, 告警字典列表)
    """
    all_warnings: list[ValueWarning] = []
    final_markdown = cleaned_markdown

    # 策略一：小数点位移检测
    try:
        decimal_warnings, final_markdown = detect_decimal_shift_errors(cleaned_markdown)
        all_warnings.extend(decimal_warnings)
    except Exception as e:
        logger.error(f"[LabValidator] 小数点位移检测异常: {type(e).__name__}: {e}")

    # 策略二：双源数值对账
    try:
        mismatch_warnings = cross_validate_numbers(ocr_raw_numbers, cleaned_markdown)
        all_warnings.extend(mismatch_warnings)
    except Exception as e:
        logger.error(f"[LabValidator] 双源数值对账异常: {type(e).__name__}: {e}")

    if all_warnings:
        logger.info(
            f"[LabValidator] 共发现 {len(all_warnings)} 个数值告警 "
            f"(位移={sum(1 for w in all_warnings if w.warning_type == 'decimal_shift')}, "
            f"对账={sum(1 for w in all_warnings if w.warning_type == 'value_mismatch')})"
        )
    else:
        logger.info("[LabValidator] ✅ 数值校验通过，未发现异常")

    return final_markdown, [w.to_dict() for w in all_warnings]
