"use client";

import { useQuery } from "@tanstack/react-query";

import { getBackendBaseURL } from "@/core/config";

import type { MedicalRecordData } from "./MedicalRecordCard";

async function fetchMedicalRecord(threadId: string): Promise<MedicalRecordData> {
  const response = await fetch(`${getBackendBaseURL()}/api/threads/${threadId}/medical-record`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as MedicalRecordData;
}

export function useMedicalRecordResource(threadId: string) {
  return useQuery({
    queryKey: ["medical-record", threadId],
    queryFn: () => fetchMedicalRecord(threadId),
    enabled: Boolean(threadId),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
