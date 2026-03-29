import { useQuery } from "@tanstack/react-query";

import { getBackendBaseURL } from "@/core/config";

export interface ImagingReport {
  report_id: string;
  thread_id: string;
  status: "pending_review" | "reviewed";
  image_path: string;
  ai_result: any;
  doctor_result: any | null;
  version?: number;
}

/**
 * Hook to poll for pending imaging reports that require doctor review.
 */
export function usePendingImagingReports(threadId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["imaging_reports", threadId, "pending_review"],
    queryFn: async () => {
      if (!threadId) return null;
      try {
        const response = await fetch(
          `${getBackendBaseURL()}/api/threads/${threadId}/imaging-reports?status=pending_review`,
        );
        if (!response.ok) throw new Error("Failed to fetch reports");
        const data = await response.json() as { reports: ImagingReport[] };
        // Return the first pending report if any exist
        return data.reports && data.reports.length > 0 ? data.reports[0] : null;
      } catch (error) {
        console.error("Failed to poll imaging reports:", error);
        return null;
      }
    },
    enabled: !!threadId && enabled,
    refetchInterval: (query) => {
      // If we found a pending report, stop polling (doctor is reviewing it)
      // Otherwise keep polling every 2 seconds
      return query.state.data ? false : 2000;
    },
    refetchIntervalInBackground: false, // Don't poll while tab is inactive
  });
}

/**
 * Hook to fetch reviewed imaging reports (non-polling).
 * Driven by invalidateQueries after review submission.
 */
export function useReviewedImagingReports(threadId: string | undefined) {
  return useQuery({
    queryKey: ["imaging_reports", threadId, "reviewed"],
    queryFn: async () => {
      if (!threadId) return [];
      try {
        const response = await fetch(
          `${getBackendBaseURL()}/api/threads/${threadId}/imaging-reports?status=reviewed`,
        );
        if (!response.ok) throw new Error("Failed to fetch reviewed reports");
        const data = await response.json() as { reports: ImagingReport[] };
        return data.reports || [];
      } catch (error) {
        console.error("Failed to fetch reviewed reports:", error);
        return [];
      }
    },
    enabled: !!threadId,
    // No refetchInterval — only refreshed via invalidateQueries
  });
}

/**
 * Submit the doctor's review.
 */
export async function submitImagingReview(
  threadId: string,
  reportId: string,
  doctorResult: any,
) {
  const response = await fetch(`${getBackendBaseURL()}/api/threads/${threadId}/imaging-reports/${reportId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ doctor_result: doctorResult }),
  });
  if (!response.ok) throw new Error("Failed to submit review");
  return response.json();
}

/**
 * Generate a text draft report using the stateless LLM Copilot API.
 */
export async function generateImagingDraft(
  threadId: string,
  doctorResult: any,
  prompt?: string
) {
  const response = await fetch(`${getBackendBaseURL()}/api/threads/${threadId}/imaging-reports/generate-draft`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ doctor_result: doctorResult, prompt }),
  });
  if (!response.ok) throw new Error("Failed to generate report draft");
  return response.json();
}
