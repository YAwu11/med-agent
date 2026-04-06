"""按病种的置信度熔断策略注册表 (Confidence Policy Registry)。

架构决策 (ADR-034):
- 不同疾病的临床风险等级不同，漏诊/误诊代价差异巨大。
  因此不能用一个全局阈值"一刀切"，必须按病种差异化配置。
- 本模块与 analyzer 完全解耦：analyzer 只管出分，本模块只管定规则。
- 新增病种只需在 CONFIDENCE_POLICY 中加一行配置，
  不需要修改任何 analyzer 或前端代码。
- 未来可将此表暴露到医生设置页 (Settings)，允许医生按需微调。

阈值语义：
- review:    低于此值 → 强制医生介入（红色熔断）
- auto_pass: 高于此值 → 系统自动标记为已审核（绿色放行）
- 介于两者之间 → 建议审核但不强制（橙色提示）

risk 标记仅用于前端 UI 的视觉分级渲染（如颜色、图标差异）。
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class DiseasePolicy:
    """某一病种的置信度熔断策略。"""
    review_threshold: float     # 低于此值 → 强制医生审核
    auto_pass_threshold: float  # 高于此值 → 自动放行
    risk_level: str             # "critical" | "high" | "medium" | "low"


# ── 病种 → 熔断策略映射表 ───────────────────────────────────
# disease_key 由各个 analyzer 在返回 Finding 时自行填写，
# 格式为小写蛇形命名，如 "pulmonary_nodule"。
CONFIDENCE_POLICY: dict[str, DiseasePolicy] = {
    # ── 胸部影像 ──────────────────────────────────────────
    "pulmonary_nodule":     DiseasePolicy(review_threshold=0.60, auto_pass_threshold=0.92, risk_level="high"),
    "pneumonia":            DiseasePolicy(review_threshold=0.50, auto_pass_threshold=0.88, risk_level="medium"),
    "pleural_effusion":     DiseasePolicy(review_threshold=0.55, auto_pass_threshold=0.90, risk_level="medium"),
    "cardiomegaly":         DiseasePolicy(review_threshold=0.50, auto_pass_threshold=0.85, risk_level="medium"),

    # ── 脑部影像 ──────────────────────────────────────────
    "brain_glioma":         DiseasePolicy(review_threshold=0.70, auto_pass_threshold=0.95, risk_level="critical"),
    "brain_meningioma":     DiseasePolicy(review_threshold=0.65, auto_pass_threshold=0.93, risk_level="high"),
    "brain_pituitary":      DiseasePolicy(review_threshold=0.60, auto_pass_threshold=0.90, risk_level="high"),

    # ── 骨科 ─────────────────────────────────────────────
    "fracture":             DiseasePolicy(review_threshold=0.55, auto_pass_threshold=0.90, risk_level="medium"),

    # ── 皮肤 ─────────────────────────────────────────────
    "skin_melanoma":        DiseasePolicy(review_threshold=0.75, auto_pass_threshold=0.95, risk_level="critical"),
    "skin_benign":          DiseasePolicy(review_threshold=0.40, auto_pass_threshold=0.80, risk_level="low"),

    # ── 眼底 ─────────────────────────────────────────────
    "diabetic_retinopathy": DiseasePolicy(review_threshold=0.50, auto_pass_threshold=0.85, risk_level="medium"),

    # ── 通用兜底策略 ─────────────────────────────────────
    # 未在表中显式注册的病种一律走最严格的审核路线
    "__default__":          DiseasePolicy(review_threshold=0.60, auto_pass_threshold=0.90, risk_level="high"),
}


def get_policy(disease_key: str) -> DiseasePolicy:
    """获取指定病种的熔断策略，找不到则返回兜底策略。"""
    return CONFIDENCE_POLICY.get(
        disease_key,
        CONFIDENCE_POLICY["__default__"],
    )
