import type { Message } from "@langchain/langgraph-sdk";

import type { PatientFieldChange, SystemNotice } from "./systemNotices";

function isHiddenContextMessage(message: Message) {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") {
    return false;
  }
  const contextEvent = Reflect.get(message.additional_kwargs, "context_event");
  if (!contextEvent || typeof contextEvent !== "object") {
    return false;
  }
  return (
    Reflect.get(contextEvent, "hidden") === true ||
    Reflect.get(contextEvent, "hidden_in_ui") === true
  );
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function unwrapToolPayload(data: unknown): unknown {
  const parsed = parseMaybeJson(data);
  if (!parsed || typeof parsed !== "object") {
    return parsed;
  }

  if ("output" in parsed) {
    return unwrapToolPayload(Reflect.get(parsed, "output"));
  }

  return parsed;
}

export function getLatestAssistantAnchorMessageId(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || isHiddenContextMessage(message)) {
      continue;
    }
    if (message.type === "ai" && message.id) {
      return message.id;
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || isHiddenContextMessage(message)) {
      continue;
    }
    if (message.id) {
      return message.id;
    }
  }

  return undefined;
}

export function extractUpdatePatientInfoChanges(data: unknown): PatientFieldChange[] {
  const payload = unwrapToolPayload(data);
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const changes = Reflect.get(payload, "changes");
  if (!Array.isArray(changes)) {
    return [];
  }

  return changes.flatMap((change) => {
    if (!change || typeof change !== "object") {
      return [];
    }

    const field = Reflect.get(change, "field");
    const action = Reflect.get(change, "action");
    if (
      typeof field === "string" &&
      (action === "added" || action === "updated" || action === "deleted")
    ) {
      return [{ field, action } as PatientFieldChange];
    }

    return [];
  });
}

export function getNextPendingSystemNotice(notices: SystemNotice[]) {
  return [...notices]
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
    .find((notice) => notice.ai_delivery === "pending" && notice.delivery_payload);
}