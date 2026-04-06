"""
Seed data for first-run experience.

Called during Gateway lifespan when the cases table is empty.
Provides 5 sample cases spanning all priorities and statuses.
"""

from __future__ import annotations

from loguru import logger

from app.gateway.models.case import (
    CaseStatus,
    CreateCaseRequest,
    DoctorDiagnosis,
    EvidenceItem,
    PatientInfo,
    Priority,
    SubmitDiagnosisRequest,
)
from app.gateway.services import case_db



def ensure_seed_cases():
    """Insert seed cases if the database is empty."""
    if case_db.count_cases() > 0:
        logger.info("Case DB already has data — skipping seed.")
        return

    logger.info("Case DB is empty — inserting seed cases...")

    seeds = [
        # ── 1. Critical: 急性胸痛 ──
        CreateCaseRequest(
            patient_thread_id="seed-thread-001",
            priority=Priority.CRITICAL,
            patient_info=PatientInfo(
                name="张明远",
                age=62,
                sex="男",
                chief_complaint="突发胸骨后压榨性疼痛2小时",
                present_illness="2小时前活动时突发胸骨后压榨性疼痛，伴大汗淋漓、气促，含服硝酸甘油无缓解。",
                medical_history="高血压病史10年，长期服用氨氯地平5mg qd",
                temperature=36.8,
                heart_rate=102,
                blood_pressure="160/95",
                spo2=94.0,
            ),
            evidence=[
                EvidenceItem(type="vitals", title="入院生命体征", source="patient_upload", is_abnormal=True,
                    structured_data={"hr": 102, "bp": "160/95", "spo2": 94.0, "temp": 36.8}),
                EvidenceItem(type="ecg", title="12导联心电图", source="ai_generated", is_abnormal=True,
                    ai_analysis="V1-V4导联ST段抬高0.3-0.5mV，提示前壁STEMI"),
                EvidenceItem(type="lab", title="心肌标志物", source="patient_upload", is_abnormal=True,
                    structured_data={"troponin_I": 2.8, "ck_mb": 45, "bnp": 890}),
            ],
        ),
        # ── 2. High: 社区获得性肺炎 ──
        CreateCaseRequest(
            patient_thread_id="seed-thread-002",
            priority=Priority.HIGH,
            patient_info=PatientInfo(
                name="李秀芳",
                age=45,
                sex="女",
                chief_complaint="发热伴咳嗽、咳痰5天",
                present_illness="5天前受凉后出现发热，最高体温39.2°C，伴咳嗽、咳黄色脓痰，右侧胸痛，活动后气促。",
                allergies="青霉素过敏",
                temperature=38.6,
                heart_rate=88,
                blood_pressure="120/78",
                spo2=96.0,
            ),
            evidence=[
                EvidenceItem(type="imaging", title="胸部X光片", source="patient_upload", is_abnormal=True,
                    ai_analysis="右下肺可见斑片状密度增高影，边缘模糊，考虑肺炎"),
                EvidenceItem(type="lab", title="血常规", source="patient_upload", is_abnormal=True,
                    structured_data={"wbc": 12.5, "neutrophil_pct": 82, "crp": 68}),
            ],
        ),
        # ── 3. Medium: 高血压复查 ──
        CreateCaseRequest(
            patient_thread_id="seed-thread-003",
            priority=Priority.MEDIUM,
            patient_info=PatientInfo(
                name="王建国",
                age=55,
                sex="男",
                chief_complaint="高血压复诊，近期偶有头晕",
                medical_history="2型糖尿病5年，高血压3年",
                temperature=36.4,
                heart_rate=72,
                blood_pressure="145/92",
                spo2=98.0,
            ),
            evidence=[
                EvidenceItem(type="vitals", title="门诊血压记录", source="patient_upload", is_abnormal=True,
                    structured_data={"bp_morning": "148/95", "bp_evening": "142/88"}),
                EvidenceItem(type="lab", title="肾功能+血脂", source="patient_upload",
                    structured_data={"creatinine": 92, "bun": 6.2, "ldl": 3.8, "hba1c": 7.1}),
            ],
        ),
        # ── 4. Low: 健康体检 ──
        CreateCaseRequest(
            patient_thread_id="seed-thread-004",
            priority=Priority.LOW,
            patient_info=PatientInfo(
                name="陈小雨",
                age=28,
                sex="女",
                chief_complaint="年度健康体检",
                temperature=36.5,
                heart_rate=68,
                blood_pressure="110/70",
                spo2=99.0,
            ),
            evidence=[
                EvidenceItem(type="lab", title="体检血常规", source="patient_upload",
                    structured_data={"wbc": 6.2, "rbc": 4.5, "hgb": 128, "plt": 220}),
                EvidenceItem(type="imaging", title="胸部X光片", source="patient_upload",
                    ai_analysis="双肺纹理清晰，心影大小形态正常，未见明显异常"),
            ],
        ),
        # ── 5. High: 已诊断 (closed demo) ──
        CreateCaseRequest(
            patient_thread_id="seed-thread-005",
            priority=Priority.HIGH,
            patient_info=PatientInfo(
                name="赵志强",
                age=70,
                sex="男",
                chief_complaint="反复咳嗽、咳痰伴气促加重1周",
                present_illness="确诊COPD 8年，近1周咳嗽加重，痰量增多转为脓性，静息时亦感气促。",
                medical_history="COPD 8年，长期吸入噻托溴铵+布地奈德",
                temperature=37.4,
                heart_rate=95,
                blood_pressure="130/85",
                spo2=90.0,
            ),
            evidence=[
                EvidenceItem(type="imaging", title="胸部CT", source="patient_upload", is_abnormal=True,
                    ai_analysis="双肺肺气肿改变，右下肺新发渗出影"),
                EvidenceItem(type="lab", title="血气分析", source="patient_upload", is_abnormal=True,
                    structured_data={"pao2": 58, "paco2": 52, "ph": 7.35}),
            ],
        ),
    ]

    for req in seeds:
        case = case_db.create_case(req)
        logger.info(f"  Seeded case {case.case_id}: {case.patient_info.name} [{case.priority.value}]")

    # Transition case 5 to diagnosed+closed for history page demo
    all_cases = case_db.list_cases(limit=10)
    if len(all_cases) >= 5:
        # Case 5: diagnosed, then closed
        c5 = all_cases[-1]  # last in priority order (could be any)
        for c in all_cases:
            if c.patient_thread_id == "seed-thread-005":
                c5 = c
                break
        case_db.update_case_status(c5.case_id, CaseStatus.IN_REVIEW)
        case_db.submit_diagnosis(c5.case_id, SubmitDiagnosisRequest(
            primary_diagnosis="慢性阻塞性肺疾病急性加重 (AECOPD)",
            secondary_diagnoses=["II型呼吸衰竭", "肺部感染"],
            treatment_plan="1. 抗感染：哌拉西林他唑巴坦 4.5g q8h IV\n2. 支气管扩张：雾化吸入沙丁胺醇+异丙托溴铵\n3. 糖皮质激素：甲泼尼龙 40mg qd IV\n4. 氧疗：鼻导管吸氧 2L/min",
            prescription="哌拉西林他唑巴坦注射液 4.5g q8h；甲泼尼龙注射液 40mg qd",
            follow_up="3天后复查血气分析和胸部CT",
            doctor_notes="患者COPD急性加重合并感染，需密切监测血氧饱和度，注意CO2潴留。",
        ))

    logger.info(f"Seed complete: {len(seeds)} cases inserted.")
