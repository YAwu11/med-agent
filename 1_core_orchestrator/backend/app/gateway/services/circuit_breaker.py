"""低置信度熔断拦截器 (Confidence Circuit Breaker)。

架构决策 (ADR-034):
- 本模块是一个纯函数式的后置拦截器 (Post-Analysis Interceptor)，
  嵌入在 parallel_analyzer.py 的分析完成后、结果返回前端之前。
- 它完全不知道 Finding 是由 YOLO/U-Net/VLM 中的哪个产生的，
  只关心两个字段：confidence 和 disease_key。
- 拦截后在每个 Finding 上打上 review_status 标记：
  • "forced_review"    → 🔴 强制医生介入（置信度低于病种阈值）
  • "suggested_review"  → 🟡 建议审核（介于两个阈值之间）
  • "auto_passed"       → 🟢 自动通过（置信度高于放行阈值）
- 前端根据 review_status 渲染不同的 UI 行为（闪烁/弹窗/绿标）。

依赖：confidence_policy.py（按病种阈值注册表）
"""

from loguru import logger
from typing import Any

from .confidence_policy import get_policy
from .analyzer_registry import AnalysisResult



def apply_circuit_breaker(result: AnalysisResult) -> AnalysisResult:
    """扫描分析结果中的每一个 Finding，根据病种策略打上审核状态标记。

    本函数是幂等的：对同一个 result 多次调用不会产生副作用。

    Args:
        result: 来自任意 analyzer 的标准化分析结果

    Returns:
        打上 review_status 标记后的同一个 AnalysisResult（原地修改）
    """
    # 仅处理包含 findings 列表的结构化数据
    if not result.structured_data:
        return result

    findings: list[dict[str, Any]] | None = result.structured_data.get("findings")
    if not findings:
        return result

    forced_count = 0
    suggested_count = 0

    for finding in findings:
        # disease_key 由各 analyzer 自行填写（如 "brain_glioma"）
        # 如果没填，则使用兜底策略
        disease_key = finding.get("disease_key", "__default__")
        confidence = finding.get("confidence", 0.0)

        # 归一化：如果 confidence 是 0-100 的整数格式，转为 0-1 浮点
        if isinstance(confidence, (int, float)) and confidence > 1.0:
            confidence = confidence / 100.0

        policy = get_policy(disease_key)

        if confidence < policy.review_threshold:
            # 🔴 熔断！低于安全阈值，强制医生介入
            finding["review_status"] = "forced_review"
            finding["review_reason"] = (
                f"置信度 {confidence:.0%} 低于 {disease_key} 的安全阈值 "
                f"{policy.review_threshold:.0%}，需要人工确认"
            )
            finding["risk_level"] = policy.risk_level
            forced_count += 1

        elif confidence >= policy.auto_pass_threshold:
            # 🟢 高置信度，自动放行
            finding["review_status"] = "auto_passed"
            finding["review_reason"] = None
            finding["risk_level"] = policy.risk_level

        else:
            # 🟡 中间地带，建议审核但不强制
            finding["review_status"] = "suggested_review"
            finding["review_reason"] = (
                f"置信度 {confidence:.0%}，建议人工复核"
            )
            finding["risk_level"] = policy.risk_level
            suggested_count += 1

    if forced_count > 0:
        logger.warning(
            f"[CircuitBreaker] 🔴 熔断触发: {result.filename} 中 "
            f"{forced_count} 个病灶低于安全阈值，强制要求医生审核"
        )
    elif suggested_count > 0:
        logger.info(
            f"[CircuitBreaker] 🟡 {result.filename}: "
            f"{suggested_count} 个病灶建议医生复核"
        )
    else:
        logger.info(
            f"[CircuitBreaker] 🟢 {result.filename}: 所有病灶自动通过"
        )

    return result
