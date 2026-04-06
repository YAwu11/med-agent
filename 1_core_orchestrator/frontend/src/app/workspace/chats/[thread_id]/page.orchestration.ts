import type { Message } from "@langchain/langgraph-sdk";

import type { AppointmentPreviewData } from "@/components/workspace/AppointmentPreview";
import { extractTextFromMessage } from "@/core/messages/utils";

export type AppointmentPreviewPayload = AppointmentPreviewData;

function isAppointmentPreviewPayload(value: unknown): value is AppointmentPreviewPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === "appointment_preview" &&
    typeof candidate.thread_id === "string" &&
    typeof candidate.patient_info === "object" &&
    candidate.patient_info !== null &&
    Array.isArray(candidate.evidence_items) &&
    typeof candidate.suggested_priority === "string" &&
    typeof candidate.reason === "string"
  );
}

function extractAppointmentPreviewFromText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = [trimmed];
  const jsonMatch = /\{[\s\S]*"type"\s*:\s*"appointment_preview"[\s\S]*\}/.exec(
    trimmed,
  );

  if (jsonMatch?.[0] && jsonMatch[0] !== trimmed) {
    candidates.push(jsonMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isAppointmentPreviewPayload(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function extractLatestAppointmentPreview(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }

    const parsed = extractAppointmentPreviewFromText(extractTextFromMessage(message));
    if (parsed) {
      return {
        sourceMessageId: message.id ?? `preview-${index}`,
        data: parsed,
      };
    }
  }

  return null;
}
