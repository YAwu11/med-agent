export type PatientInfoValue = string | number | null | undefined;
export type PatientInfoState = Record<string, PatientInfoValue>;

import type { PatientFieldChange } from "./systemNotices";

export function normalizePatientInfoValue(value: PatientInfoValue): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

export function computeDirtyFields(
  saved: PatientInfoState,
  edited: PatientInfoState,
): Record<string, string | number | null> {
  const dirtyFields: Record<string, string | number | null> = {};
  const keys = new Set([...Object.keys(saved), ...Object.keys(edited)]);

  for (const key of keys) {
    if (normalizePatientInfoValue(saved[key]) !== normalizePatientInfoValue(edited[key])) {
      dirtyFields[key] = edited[key] ?? null;
    }
  }

  return dirtyFields;
}

export function buildPatientUpdateMessage(
  dirtyFields: Record<string, string | number | null>,
  labels: Partial<Record<string, string>>,
): string {
  const summary = Object.entries(dirtyFields)
    .map(([key, value]) => {
      const normalizedValue = normalizePatientInfoValue(value);
      if (!normalizedValue) {
        return null;
      }

      return `${labels[key] ?? key}: ${normalizedValue}`;
    })
    .filter((value): value is string => Boolean(value))
    .join("、");

  return summary ? `我刚在病历表单上更新了：${summary}` : "";
}

export function buildPatientFieldChanges(
  saved: PatientInfoState,
  dirtyFields: Record<string, string | number | null>,
): PatientFieldChange[] {
  return Object.entries(dirtyFields).map(([field, value]) => {
    const previousValue = normalizePatientInfoValue(saved[field]);
    const nextValue = normalizePatientInfoValue(value);

    if (!nextValue) {
      return { field, action: "deleted" } as PatientFieldChange;
    }
    if (!previousValue) {
      return { field, action: "added" } as PatientFieldChange;
    }
    return { field, action: "updated" } as PatientFieldChange;
  });
}

export interface PatientInfoSaveEvent {
  changes: PatientFieldChange[];
  dirtyFields: Record<string, string | number | null>;
}