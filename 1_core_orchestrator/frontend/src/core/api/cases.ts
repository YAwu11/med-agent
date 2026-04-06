/**
 * Cases API Client
 *
 * Provides typed fetch wrappers for the /api/cases endpoints.
 * Used by both the doctor queue page and the Evidence Desk.
 */

import { getBackendBaseURL } from "@/core/config";

// ── Types ──────────────────────────────────────────────────

export interface PatientInfo {
  name?: string | null;
  age?: number | null;
  sex?: string | null;
  phone?: string | null;
  chief_complaint?: string | null;
  present_illness?: string | null;
  medical_history?: string | null;
  allergies?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  temperature?: number | null;
  heart_rate?: number | null;
  blood_pressure?: string | null;
  spo2?: number | null;
}

export interface EvidenceItem {
  evidence_id: string;
  type: "vitals" | "imaging" | "lab" | "ecg" | "note";
  title: string;
  source: "patient_upload" | "ai_generated" | "doctor_input";
  file_path?: string | null;
  structured_data?: Record<string, unknown> | null;
  ai_analysis?: string | null;
  doctor_annotation?: string | null;
  is_abnormal: boolean;
  created_at: string;
}

export interface DoctorDiagnosis {
  primary_diagnosis: string;
  secondary_diagnoses: string[];
  treatment_plan: string;
  prescription?: string | null;
  follow_up?: string | null;
  doctor_notes: string;
  diagnosed_at: string;
}

export interface CaseData {
  case_id: string;
  patient_thread_id: string;
  doctor_thread_id?: string | null;
  status: "pending" | "in_review" | "diagnosed" | "closed";
  priority: "low" | "medium" | "high" | "critical";
  patient_info: PatientInfo;
  evidence: EvidenceItem[];
  diagnosis?: DoctorDiagnosis | null;
  created_at: string;
  updated_at: string;
}

export interface CaseCounts {
  total: number;
  pending: number;
  in_review: number;
  diagnosed: number;
  closed: number;
}

export interface CaseListResponse {
  cases: CaseData[];
  total: number;
  counts: CaseCounts;
}

export interface CaseSummaryReadiness {
  case_id: string;
  ready_for_synthesis: boolean;
  stage: "collecting_info" | "processing_uploads" | "review_failed_uploads" | "ready";
  status_text: string;
  next_action: string;
  blocking_reasons: string[];
  missing_required_fields: string[];
  pending_files: string[];
  failed_files: string[];
}

export interface CaseSummaryResponse {
  case_id: string;
  summary: string;
  evidence_count: number;
  has_diagnosis: boolean;
  summary_readiness: Omit<CaseSummaryReadiness, "case_id">;
}

// ── API Functions ──────────────────────────────────────────

const BASE = () => `${getBackendBaseURL()}/api`;

export async function fetchCases(params?: {
  status?: string;
  priority?: string;
  limit?: number;
  offset?: number;
}): Promise<CaseListResponse> {
  const url = new URL(`${BASE()}/cases`);
  if (params?.status) url.searchParams.set("status", params.status);
  if (params?.priority) url.searchParams.set("priority", params.priority);
  if (params?.limit) url.searchParams.set("limit", String(params.limit));
  if (params?.offset) url.searchParams.set("offset", String(params.offset));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Failed to fetch cases: ${res.status}`);
  return res.json();
}

export async function fetchCase(caseId: string): Promise<CaseData> {
  const res = await fetch(`${BASE()}/cases/${caseId}`);
  if (!res.ok) throw new Error(`Failed to fetch case ${caseId}: ${res.status}`);
  return res.json();
}

export async function fetchCaseEvidence(caseId: string): Promise<{ evidence: EvidenceItem[]; total: number }> {
  const res = await fetch(`${BASE()}/cases/${caseId}/evidence`);
  if (!res.ok) throw new Error(`Failed to fetch evidence: ${res.status}`);
  return res.json();
}

export async function updateCaseStatus(caseId: string, status: string): Promise<CaseData> {
  const res = await fetch(`${BASE()}/cases/${caseId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`Failed to update status: ${res.status}`);
  return res.json();
}

export async function submitDiagnosis(
  caseId: string,
  diagnosis: {
    primary_diagnosis: string;
    secondary_diagnoses?: string[];
    treatment_plan?: string;
    prescription?: string;
    follow_up?: string;
    doctor_notes?: string;
  },
): Promise<CaseData> {
  const res = await fetch(`${BASE()}/cases/${caseId}/diagnosis`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(diagnosis),
  });
  if (!res.ok) throw new Error(`Failed to submit diagnosis: ${res.status}`);
  return res.json();
}

export async function fetchDoctorStats(): Promise<CaseCounts> {
  const res = await fetch(`${BASE()}/doctor/stats`);
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
  return res.json();
}

export async function updatePatientInfo(
  caseId: string,
  info: Partial<PatientInfo>,
): Promise<CaseData> {
  const res = await fetch(`${BASE()}/cases/${caseId}/patient-info`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(info),
  });
  if (!res.ok) throw new Error(`Failed to update patient info: ${res.status}`);
  return res.json();
}

export async function createCase(data: {
  patient_thread_id: string;
  priority?: string;
  patient_info: Partial<PatientInfo>;
}): Promise<CaseData> {
  const res = await fetch(`${BASE()}/cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create case: ${res.status}`);
  return res.json();
}

export async function fetchCaseSummaryReadiness(
  caseId: string,
): Promise<CaseSummaryReadiness> {
  const res = await fetch(`${BASE()}/cases/${caseId}/summary-readiness`);
  if (!res.ok) throw new Error(`Failed to fetch case summary readiness: ${res.status}`);
  return res.json();
}

export async function fetchCaseSummary(
  caseId: string,
): Promise<CaseSummaryResponse> {
  const res = await fetch(`${BASE()}/cases/${caseId}/summary`);

  if (!res.ok) {
    let detail: string | undefined;
    try {
      const error = (await res.json()) as { detail?: { message?: string } | string };
      if (typeof error.detail === "string") {
        detail = error.detail;
      } else {
        detail = error.detail?.message;
      }
    } catch {
      detail = undefined;
    }
    throw new Error(detail ?? `Failed to fetch case summary: ${res.status}`);
  }

  return res.json();
}

// ── SSE Helper ─────────────────────────────────────────────

export type CaseEvent = {
  type: "connected" | "new_case" | "status_change" | "new_evidence" | "diagnosed";
  [key: string]: unknown;
};

export function subscribeToCaseEvents(
  onEvent: (event: CaseEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const es = new EventSource(`${BASE()}/cases/stream`);

  es.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data) as CaseEvent;
      onEvent(data);
    } catch {
      // ignore malformed events
    }
  };

  es.onerror = (err) => {
    onError?.(err);
  };

  // Return cleanup function
  return () => es.close();
}
