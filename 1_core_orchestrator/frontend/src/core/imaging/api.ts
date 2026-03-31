/**
 * Imaging Report API types and client functions.
 *
 * Provides typed access to the HITL imaging reports endpoints.
 */

import { getBackendBaseURL } from "@/core/config";

// ── Types ──────────────────────────────────────────────────

/** A single finding (bounding box) detected by AI or annotated by doctor. */
export interface Finding {
  id: string;
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x, y, w, h] normalized 0-1
  anatomical_location?: string;
  anatomical_location_cn?: string;
  is_doctor_modified?: boolean;
}

/** A brush stroke drawn by the doctor on the canvas. */
export interface BrushStroke {
  points: number[];
  color?: string;
  width?: number;
}

/** Doctor's reviewed result overlay. */
export interface DoctorResult {
  findings?: Finding[];
  brush_strokes?: BrushStroke[];
  conclusion?: "normal" | "abnormal" | "pending";
  doctor_comment?: string;
}

/** Full imaging report as returned by the backend. */
export interface ImagingReport {
  report_id: string;
  patient_thread_id: string;
  image_path: string;
  ai_result: {
    findings: Finding[];
    summary?: Record<string, unknown>;
    disease_probabilities?: Record<string, number>;
    [key: string]: unknown;
  };
  doctor_result?: DoctorResult;
  status: "pending_review" | "reviewed" | "rejected";
  version?: number;
  created_at: string;
  updated_at: string;
}

// ── API Functions ──────────────────────────────────────────

const BASE = () => `${getBackendBaseURL()}/api`;

/** Fetch pending imaging reports for a thread. */
export async function fetchImagingReports(
  threadId: string,
  status?: string,
): Promise<{ reports: ImagingReport[] }> {
  const url = new URL(`${BASE()}/threads/${threadId}/imaging-reports`);
  if (status) url.searchParams.set("status", status);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Failed to fetch imaging reports: ${res.status}`);
  return res.json();
}

/** Submit doctor review for an imaging report. */
export async function submitImagingReview(
  threadId: string,
  reportId: string,
  review: {
    findings?: Finding[];
    brush_strokes?: BrushStroke[];
    conclusion?: string;
    doctor_comment?: string;
  },
): Promise<ImagingReport> {
  const res = await fetch(`${BASE()}/threads/${threadId}/imaging-reports/${reportId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(review),
  });
  if (!res.ok) throw new Error(`Failed to submit review: ${res.status}`);
  return res.json();
}
