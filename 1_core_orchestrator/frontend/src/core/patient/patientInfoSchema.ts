export type PatientInfoFieldKey =
  | "name"
  | "age"
  | "sex"
  | "phone"
  | "id_number"
  | "chief_complaint"
  | "present_illness"
  | "medical_history"
  | "allergies"
  | "height_cm"
  | "weight_kg"
  | "temperature"
  | "heart_rate"
  | "blood_pressure"
  | "spo2";

export interface PatientInfoFieldDefinition {
  key: PatientInfoFieldKey;
  label: string;
  placeholder: string;
  required?: boolean;
}

export const PATIENT_INFO_FIELDS: PatientInfoFieldDefinition[] = [
  { key: "name", label: "姓名", placeholder: "请输入姓名", required: true },
  { key: "age", label: "年龄", placeholder: "请输入年龄", required: true },
  { key: "sex", label: "性别", placeholder: "男/女", required: true },
  { key: "phone", label: "联系电话", placeholder: "请输入联系电话" },
  { key: "id_number", label: "身份证号", placeholder: "请输入身份证号" },
  { key: "chief_complaint", label: "主诉", placeholder: "主要症状", required: true },
  { key: "present_illness", label: "现病史", placeholder: "症状发展经过" },
  { key: "medical_history", label: "既往史", placeholder: "无" },
  { key: "allergies", label: "过敏与用药", placeholder: "无" },
  { key: "height_cm", label: "身高(cm)", placeholder: "请输入身高" },
  { key: "weight_kg", label: "体重(kg)", placeholder: "请输入体重" },
  { key: "temperature", label: "体温", placeholder: "请输入体温" },
  { key: "heart_rate", label: "心率", placeholder: "请输入心率" },
  { key: "blood_pressure", label: "血压", placeholder: "请输入血压" },
  { key: "spo2", label: "血氧", placeholder: "请输入血氧" },
];

export const APPOINTMENT_PREVIEW_FIELDS = PATIENT_INFO_FIELDS.filter((field) =>
  [
    "name",
    "age",
    "sex",
    "chief_complaint",
    "present_illness",
    "medical_history",
    "allergies",
  ].includes(field.key),
);

export const REQUIRED_PATIENT_INFO_FIELDS = PATIENT_INFO_FIELDS.filter(
  (field) => field.required,
).map((field) => field.key);

export const PATIENT_INFO_LABELS = PATIENT_INFO_FIELDS.reduce<Record<PatientInfoFieldKey, string>>(
  (labels, field) => {
    labels[field.key] = field.label;
    return labels;
  },
  {} as Record<PatientInfoFieldKey, string>,
);