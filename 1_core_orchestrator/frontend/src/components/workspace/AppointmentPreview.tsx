"use client";

import {
  CheckCircle2,
  AlertCircle,
  Send,
  X,
  User,
  FileText,
  Activity,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import React, { useState, useCallback } from "react";

import { getBackendBaseURL } from "@/core/config";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────

interface EvidenceItem {
  id: string;
  type: "imaging" | "lab_report";
  title: string;
  filename?: string;
  findings_count?: number;
  findings_brief?: string;
  ocr_summary?: string;
  is_abnormal?: boolean;
  pipeline?: string;
  viewer_kind?: string;
  modality?: string;
  review_status?: string;
  report_text?: string;
  spatial_info?: {
    location?: string;
    clinical_warning?: string;
  };
}

interface AppointmentPreviewData {
  type: "appointment_preview";
  thread_id: string;
  patient_info: Record<string, string | number | null>;
  evidence_items: EvidenceItem[];
  suggested_priority: string;
  suggested_department?: string | null;
  reason: string;
}

interface ConfirmedData {
  success: boolean;
  case_id: string;
  short_id: string;
  department?: string | null;
  evidence_count: number;
  message: string;
}

// ── Props ─────────────────────────────────────────────────

interface AppointmentPreviewProps {
  data: AppointmentPreviewData;
}

// ── Priority config ───────────────────────────────────────

const priorityConfig: Record<string, { label: string; color: string; dot: string }> = {
  critical: { label: "紧急", color: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
  high: { label: "高", color: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  medium: { label: "中", color: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  low: { label: "低", color: "bg-slate-50 text-slate-600 border-slate-200", dot: "bg-slate-400" },
};

function isBrainEvidence(ev: EvidenceItem): boolean {
  return (
    ev.pipeline === "brain_nifti_v1" ||
    ev.viewer_kind === "brain_spatial_review" ||
    ev.modality?.startsWith("brain_mri") === true
  );
}

function formatReviewStatus(status?: string): string | null {
  switch (status) {
    case "reviewed":
      return "已医生复核";
    case "pending_review":
    case "pending_doctor_review":
      return "待医生复核";
    case "processing":
      return "处理中";
    default:
      return null;
  }
}

// ── Component ─────────────────────────────────────────────

export function AppointmentPreview({ data }: AppointmentPreviewProps) {
  // Editable patient info
  const [patientInfo, setPatientInfo] = useState<Record<string, string | number | null>>(
    data.patient_info ?? {}
  );

  // Evidence selection (all selected by default)
  const [selectedEvidence, setSelectedEvidence] = useState<Set<string>>(
    new Set(data.evidence_items.map((e) => e.id))
  );

  // States
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<ConfirmedData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Handlers ──────────────────────────────────────────

  const updateField = useCallback((key: string, value: string) => {
    setPatientInfo((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleEvidence = useCallback((id: string) => {
    setSelectedEvidence((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${getBackendBaseURL()}/api/threads/${data.thread_id}/confirm-appointment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patient_info: patientInfo,
            selected_evidence_ids: Array.from(selectedEvidence),
            priority: data.suggested_priority,
            department: data.suggested_department,
            reason: data.reason,
          }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result: ConfirmedData = await res.json();
      setConfirmed(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setIsSubmitting(false);
    }
  }, [data, patientInfo, selectedEvidence]);

  // ── Render: Confirmed state ───────────────────────────

  if (confirmed) {
    return (
      <div className="my-3 w-full max-w-lg rounded-xl border border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <span className="text-base font-semibold text-green-800">挂号成功</span>
        </div>
        <div className="space-y-1.5 text-sm text-green-700">
          <p>
            <span className="font-medium">就诊编号:</span>{" "}
            <code className="rounded bg-green-100 px-1.5 py-0.5 font-mono text-xs">
              {confirmed.short_id}
            </code>
          </p>
          {confirmed.department && (
            <p>
              <span className="font-medium">建议科室:</span> {confirmed.department}
            </p>
          )}
          <p>
            <span className="font-medium">已提交资料:</span> {confirmed.evidence_count} 份
          </p>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-green-600">医生将尽快审阅您的资料，请留意通知。</p>
          <Link
            href={`/workspace/status?thread_id=${data.thread_id}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-100 hover:bg-green-200 px-3 py-1.5 rounded-full transition-colors"
          >
            查看进度 →
          </Link>
        </div>
      </div>
    );
  }

  // ── Render: Preview / Edit state ──────────────────────

  const priority = priorityConfig[data.suggested_priority] ?? priorityConfig.medium!;

  // Patient info fields to display
  const fields: { key: string; label: string; placeholder: string }[] = [
    { key: "name", label: "姓名", placeholder: "请输入姓名" },
    { key: "age", label: "年龄", placeholder: "请输入年龄" },
    { key: "sex", label: "性别", placeholder: "男/女" },
    { key: "chief_complaint", label: "主诉", placeholder: "主要症状" },
    { key: "present_illness", label: "现病史", placeholder: "症状发展经过" },
    { key: "past_history", label: "既往病史", placeholder: "无" },
    { key: "allergy_history", label: "过敏史", placeholder: "无" },
  ];

  return (
    <div className="my-3 w-full max-w-lg rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50/80 to-indigo-50/60 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-white/60 border-b border-blue-100">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-semibold text-blue-800">挂号信息确认</span>
        </div>
        <div className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", priority.color)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", priority.dot)} />
          优先级: {priority.label}
        </div>
      </div>

      {/* Patient Info Section */}
      <div className="px-5 py-3 border-b border-blue-100">
        <div className="flex items-center gap-1.5 mb-2">
          <User className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">基本信息</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {fields.slice(0, 3).map((f) => (
            <div key={f.key}>
              <label className="text-[10px] text-slate-500 mb-0.5 block">{f.label}</label>
              <input
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200 transition-colors"
                value={String(patientInfo[f.key] ?? "")}
                placeholder={f.placeholder}
                onChange={(e) => updateField(f.key, e.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 space-y-1.5">
          {fields.slice(3).map((f) => (
            <div key={f.key}>
              <label className="text-[10px] text-slate-500 mb-0.5 block">{f.label}</label>
              <input
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200 transition-colors"
                value={String(patientInfo[f.key] ?? "")}
                placeholder={f.placeholder}
                onChange={(e) => updateField(f.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Evidence Section */}
      {data.evidence_items.length > 0 && (
        <div className="px-5 py-3 border-b border-blue-100">
          <div className="flex items-center gap-1.5 mb-2">
            <Activity className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
              检查资料（勾选要提交的）
            </span>
          </div>
          <div className="space-y-1.5">
            {data.evidence_items.map((ev) => {
              const isSelected = selectedEvidence.has(ev.id);
              const brainEvidence = isBrainEvidence(ev);
              const reviewStatusLabel = brainEvidence ? formatReviewStatus(ev.review_status) : null;
              return (
                <label
                  key={ev.id}
                  className={cn(
                    "flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all",
                    isSelected
                      ? "border-blue-300 bg-blue-50/50"
                      : "border-slate-200 bg-white/50 opacity-60"
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-blue-600"
                    checked={isSelected}
                    onChange={() => toggleEvidence(ev.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs">
                        {brainEvidence ? "🧠" : ev.type === "imaging" ? "🫁" : "🧪"}
                      </span>
                      <span className="text-xs font-medium text-slate-700 truncate">
                        {ev.title}
                      </span>
                      {ev.is_abnormal && (
                        <AlertCircle className="h-3 w-3 text-amber-500 shrink-0" />
                      )}
                    </div>
                    {reviewStatusLabel && (
                      <p className="mt-0.5 text-[10px] text-slate-500">{reviewStatusLabel}</p>
                    )}
                    {brainEvidence && ev.spatial_info?.location && (
                      <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                        定位区域：{ev.spatial_info.location}
                      </p>
                    )}
                    {ev.findings_brief && (
                      <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                        AI 发现 {ev.findings_count ?? 0} 处: {ev.findings_brief}
                      </p>
                    )}
                    {brainEvidence && ev.report_text && (
                      <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">
                        {ev.report_text}
                      </p>
                    )}
                    {ev.ocr_summary && (
                      <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">
                        {ev.ocr_summary}
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Department & Reason */}
      {(data.suggested_department ?? data.reason) && (
        <div className="px-5 py-2.5 border-b border-blue-100 text-xs text-slate-600">
          {data.suggested_department && (
            <p>
              <span className="font-medium">建议科室:</span> {data.suggested_department}
            </p>
          )}
          {data.reason && (
            <p className="mt-0.5">
              <span className="font-medium">挂号原因:</span> {data.reason}
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-5 py-2 bg-red-50 text-xs text-red-600 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 px-5 py-3 bg-white/40">
        <button
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          disabled={isSubmitting}
        >
          <X className="h-3.5 w-3.5" />
          取消
        </button>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium text-white transition-all",
            isSubmitting
              ? "bg-blue-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700 shadow-sm hover:shadow"
          )}
          onClick={handleConfirm}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {isSubmitting ? "提交中..." : "确认提交"}
        </button>
      </div>
    </div>
  );
}
