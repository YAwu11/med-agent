import type { PatientInfoFieldKey } from "@/core/patient/patientInfoSchema";
import { PATIENT_INFO_LABELS } from "@/core/patient/patientInfoSchema";

import { normalizePatientInfoValue } from "./patientInfoUpdates";

export type SystemNoticeKind =
  | "patient_info_updated"
  | "patient_info_tool_success"
  | "upload_received"
  | "upload_analyzed";

export type SystemNoticeAiDelivery = "none" | "pending" | "sent";

export type PatientFieldChangeAction = "added" | "updated" | "deleted";

export interface PatientFieldChange {
  field: PatientInfoFieldKey;
  action: PatientFieldChangeAction;
}

export interface SystemNotice {
  id: string;
  kind: SystemNoticeKind;
  text: string;
  created_at: string;
  anchor_message_id?: string;
  source_event_id?: string;
  ai_delivery: SystemNoticeAiDelivery;
  delivery_payload?: SystemNoticeDeliveryPayload;
}

export const THREAD_TAIL_NOTICE_ANCHOR = "__thread_tail__";

export interface SystemNoticeDeliveryPayload {
  text: string;
  additional_kwargs: {
    context_event: {
      hidden: true;
      kind: "patient_record_delta";
      source: "patient_form" | "upload_analysis";
      event_id?: string;
      payload: Record<string, unknown>;
    };
  };
}

export type PatientFieldValueMap = Partial<
  Record<PatientInfoFieldKey, string | number | null>
>;

interface UploadAnalysisNoticeInput {
  filename: string;
  status: "completed" | "failed";
  uploadId: string;
  analysisKind: string;
  category?: string;
  summary?: string;
}

interface NoticeBaseOptions {
  id?: string;
  createdAt?: string;
  anchorMessageId?: string;
  sourceEventId?: string;
}

function normalizeNoticeSummary(summary?: string) {
  if (!summary) {
    return "";
  }

  return summary.replace(/\s+/g, " ").trim();
}

function buildNoticeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toFieldLabels(fields: PatientInfoFieldKey[]) {
  return fields.map((field) => PATIENT_INFO_LABELS[field] ?? field);
}

function buildFieldActionParts(
  changes: PatientFieldChange[],
  templates: Record<PatientFieldChangeAction, string>,
) {
  const grouped: Record<PatientFieldChangeAction, PatientInfoFieldKey[]> = {
    added: [],
    updated: [],
    deleted: [],
  };

  for (const change of changes) {
    grouped[change.action].push(change.field);
  }

  return (["updated", "added", "deleted"] as const)
    .filter((action) => grouped[action].length > 0)
    .map((action) => `${templates[action]}：${toFieldLabels(grouped[action]).join("、")}`);
}

function createSystemNotice(
  kind: SystemNoticeKind,
  text: string,
  aiDelivery: SystemNoticeAiDelivery,
  deliveryPayload?: SystemNoticeDeliveryPayload,
  options: NoticeBaseOptions = {},
): SystemNotice {
  return {
    id: options.id ?? buildNoticeId(kind),
    kind,
    text,
    created_at: options.createdAt ?? new Date().toISOString(),
    anchor_message_id: options.anchorMessageId,
    source_event_id: options.sourceEventId,
    ai_delivery: aiDelivery,
    delivery_payload: deliveryPayload,
  };
}

function buildPatientDeltaPayload(
  changes: PatientFieldChange[],
  fieldValues: PatientFieldValueMap,
  options: NoticeBaseOptions,
): SystemNoticeDeliveryPayload | undefined {
  if (changes.length === 0) {
    return undefined;
  }

  const parts = changes.map(({ action, field }) => {
    const label = PATIENT_INFO_LABELS[field] ?? field;
    const normalizedValue = normalizePatientInfoValue(fieldValues[field]);

    if (action === "deleted" || !normalizedValue) {
      return `删除：${label}`;
    }

    return `${action === "added" ? "新增" : "修改"}：${label}=${normalizedValue}`;
  });

  return {
    text: `患者病历信息发生更新：${parts.join("；")}。请据此继续问诊。`,
    additional_kwargs: {
      context_event: {
        hidden: true,
        kind: "patient_record_delta",
        source: "patient_form",
        event_id: options.sourceEventId,
        payload: {
          changes,
          field_values: fieldValues,
        },
      },
    },
  };
}

function buildUploadAnalysisPayload(
  input: UploadAnalysisNoticeInput,
  options: NoticeBaseOptions,
): SystemNoticeDeliveryPayload | undefined {
  if (input.status !== "completed") {
    return undefined;
  }

  const parts = [
    `患者上传的检查材料《${input.filename}》已识别完成`,
    input.category ? `类别：${input.category}` : null,
    input.summary ? `摘要：${input.summary}` : null,
  ].filter((part): part is string => Boolean(part));

  return {
    text: `${parts.join("。") }。请将结果纳入后续判断。`,
    additional_kwargs: {
      context_event: {
        hidden: true,
        kind: "patient_record_delta",
        source: "upload_analysis",
        event_id: options.sourceEventId,
        payload: {
          upload_id: input.uploadId,
          filename: input.filename,
          status: input.status,
          analysis_kind: input.analysisKind,
          category: input.category,
          summary: input.summary,
        },
      },
    },
  };
}

export function buildPatientFieldNotice(
  changes: PatientFieldChange[],
  fieldValues: PatientFieldValueMap,
  options: NoticeBaseOptions = {},
): SystemNotice {
  const parts = buildFieldActionParts(changes, {
    updated: "患者修改了",
    added: "患者补充了",
    deleted: "患者删除了",
  });
  return createSystemNotice(
    "patient_info_updated",
    parts.join("；") || "患者更新了病历信息",
    changes.length > 0 ? "pending" : "none",
    buildPatientDeltaPayload(changes, fieldValues, options),
    options,
  );
}

export function buildAgentFieldSuccessNotice(
  changes: PatientFieldChange[],
  options: NoticeBaseOptions = {},
): SystemNotice {
  const parts = buildFieldActionParts(changes, {
    updated: "系统已修改成功",
    added: "系统已新增成功",
    deleted: "系统已删除成功",
  });
  return createSystemNotice(
    "patient_info_tool_success",
    parts.join("；") || "系统已更新病历信息",
    "none",
    undefined,
    options,
  );
}

export function buildUploadReceivedNotice(
  filename: string,
  options: NoticeBaseOptions = {},
): SystemNotice {
  return createSystemNotice(
    "upload_received",
    `患者上传了 ${filename}，正在识别中`,
    "none",
    undefined,
    options,
  );
}

export function buildUploadAnalyzedNotice(
  input: UploadAnalysisNoticeInput,
  options: NoticeBaseOptions = {},
): SystemNotice {
  const summary = normalizeNoticeSummary(input.summary);
  const statusText =
    input.status === "completed"
      ? `${input.filename} 识别完成`
      : `${input.filename} 识别失败`;

  return createSystemNotice(
    "upload_analyzed",
    summary ? `${statusText}：${summary}` : statusText,
    input.status === "completed" ? "pending" : "none",
    buildUploadAnalysisPayload(input, options),
    options,
  );
}

export function getSystemNoticesForAnchor(
  notices: SystemNotice[] | undefined,
  messageIds: Array<string | undefined>,
) {
  if (!notices || notices.length === 0) {
    return [];
  }

  const targets = new Set(messageIds.filter((messageId): messageId is string => Boolean(messageId)));
  return notices
    .filter((notice) => notice.anchor_message_id && targets.has(notice.anchor_message_id))
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export function getThreadTailSystemNotices(notices: SystemNotice[] | undefined) {
  if (!notices || notices.length === 0) {
    return [];
  }

  return notices
    .filter((notice) => notice.anchor_message_id === THREAD_TAIL_NOTICE_ANCHOR)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export function mergeSystemNoticeLists(...lists: Array<SystemNotice[] | undefined>) {
  const deduped = new Map<string, SystemNotice>();

  for (const list of lists) {
    for (const notice of list ?? []) {
      deduped.set(notice.id, notice);
    }
  }

  return Array.from(deduped.values()).sort((left, right) =>
    left.created_at.localeCompare(right.created_at),
  );
}