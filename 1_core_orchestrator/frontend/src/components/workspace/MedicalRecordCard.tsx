"use client";

import {
  Check,
  FileImage,
  FileText,
  HeartPulse,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Upload,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getBackendBaseURL } from "@/core/config";
import {
  REQUIRED_PATIENT_INFO_FIELDS,
} from "@/core/patient/patientInfoSchema";
import {
  buildPatientFieldChanges,
  computeDirtyFields,
  type PatientInfoSaveEvent,
} from "@/core/patient/patientInfoUpdates";
import {
  listUploadedFiles,
  uploadFiles,
  type UploadedFileInfo,
} from "@/core/uploads/api";
import { cn } from "@/lib/utils";

interface MedicalRecordEvidence {
  id: string;
  type: "imaging" | "lab_report" | "pending";
  title: string;
  filename?: string;
  status: "completed" | "processing" | "failed";
  is_abnormal: boolean;
  findings_brief?: string;
  ocr_summary?: string;
  findings_count?: number;
  report_id?: string;
  pipeline?: string;
  viewer_kind?: string;
  modality?: string;
  review_status?: string;
  slice_png_path?: string;
  source_upload_filename?: string;
  report_text?: string;
  spatial_info?: {
    location?: string;
    clinical_warning?: string;
  };
}

interface MedicalRecordGuidance {
  stage: "collecting_info" | "processing_uploads" | "review_failed_uploads" | "ready";
  ready_for_ai_summary: boolean;
  missing_required_fields: string[];
  pending_files: string[];
  failed_files?: string[];
  next_action: string;
  status_text: string;
  blocking_reasons?: string[];
}

export interface MedicalRecordData {
  type: "medical_record";
  thread_id: string;
  message?: string;
  patient_info: Record<string, string | number | null>;
  evidence_items: MedicalRecordEvidence[];
  guidance?: MedicalRecordGuidance;
}

interface MedicalRecordCardProps {
  data: MedicalRecordData;
  mode?: "inline" | "dialog";
  onRefresh?: () => Promise<void> | void;
  onPatientInfoSaved?: (event: PatientInfoSaveEvent) => Promise<void> | void;
  onActionBarChange?: (actions: MedicalRecordDialogActions | null) => void;
}

export interface MedicalRecordDialogActions {
  isDirty: boolean;
  isSaving: boolean;
  uploadsLoading: boolean;
  currentPatientInfo: PatientInfoState;
  onReset: () => void;
  onRefreshUploads: () => void;
  onSave: () => void;
}

type FormValue = string | number | null;
type PatientInfoState = Record<string, FormValue>;
type QuickFillAction = "append" | "replace";

const QUICK_FILL_PRESETS: Record<
  string,
  { label: string; value: string; action?: QuickFillAction }[]
> = {
  chief_complaint: [
    { label: "发热", value: "发热" },
    { label: "咳嗽", value: "咳嗽" },
    { label: "胸痛", value: "胸痛" },
    { label: "腹痛", value: "腹痛" },
    { label: "头痛", value: "头痛" },
    { label: "头晕", value: "头晕" },
    { label: "体检", value: "健康体检" },
    { label: "复诊", value: "复诊随访" },
  ],
  present_illness: [
    { label: "1天", value: "症状持续1天", action: "replace" },
    { label: "3天", value: "症状持续3天", action: "replace" },
    { label: "1周", value: "症状持续1周", action: "replace" },
    { label: "逐渐加重", value: "近来逐渐加重" },
    { label: "反复发作", value: "症状反复发作" },
    { label: "活动后重", value: "活动后明显加重" },
  ],
  medical_history: [
    { label: "无特殊", value: "既往体健，无特殊病史", action: "replace" },
    { label: "高血压", value: "高血压病史" },
    { label: "糖尿病", value: "糖尿病病史" },
    { label: "冠心病", value: "冠心病病史" },
    { label: "哮喘", value: "哮喘病史" },
    { label: "手术史", value: "既往有手术史" },
  ],
  allergies: [
    { label: "无过敏史", value: "无明确药物过敏史", action: "replace" },
    { label: "青霉素", value: "青霉素过敏" },
    { label: "头孢", value: "头孢类过敏" },
    { label: "降压药", value: "目前规律服用降压药" },
    { label: "退烧药", value: "近期服用过退烧药" },
  ],
  temperature: [
    { label: "36.5", value: "36.5", action: "replace" },
    { label: "37.5", value: "37.5", action: "replace" },
    { label: "38.5", value: "38.5", action: "replace" },
    { label: "39.0", value: "39.0", action: "replace" },
  ],
  heart_rate: [
    { label: "72", value: "72", action: "replace" },
    { label: "88", value: "88", action: "replace" },
    { label: "100", value: "100", action: "replace" },
    { label: "120", value: "120", action: "replace" },
  ],
  blood_pressure: [
    { label: "120/80", value: "120/80", action: "replace" },
    { label: "130/85", value: "130/85", action: "replace" },
    { label: "140/90", value: "140/90", action: "replace" },
    { label: "160/100", value: "160/100", action: "replace" },
  ],
  spo2: [
    { label: "99", value: "99", action: "replace" },
    { label: "97", value: "97", action: "replace" },
    { label: "95", value: "95", action: "replace" },
    { label: "92", value: "92", action: "replace" },
  ],
};

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "bmp",
  "gif",
  "tiff",
]);

function normalizeValue(value: FormValue | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isPreviewableImage(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

function buildUploadUrl(file: UploadedFileInfo): string {
  return file.artifact_url.startsWith("/api/")
    ? `${getBackendBaseURL()}${file.artifact_url}`
    : file.artifact_url;
}

function mergePreset(currentValue: FormValue | undefined, nextValue: string): string {
  const currentText = normalizeValue(currentValue);
  if (!currentText) return nextValue;
  if (currentText.includes(nextValue)) return currentText;
  return `${currentText}；${nextValue}`;
}

function FieldLabel({
  htmlFor,
  label,
  required = false,
}: {
  htmlFor: string;
  label: string;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-sm font-medium text-slate-700"
    >
      {label}
      {required ? <span className="ml-1 text-rose-500">*</span> : null}
    </label>
  );
}

function QuickFillGroup({
  field,
  value,
  onPick,
}: {
  field: string;
  value: FormValue | undefined;
  onPick: (field: string, value: string, action?: QuickFillAction) => void;
}) {
  const presets = QUICK_FILL_PRESETS[field];
  if (!presets?.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {presets.map((preset) => {
        const selected = normalizeValue(value).includes(preset.value);
        return (
          <button
            key={`${field}-${preset.label}`}
            type="button"
            onClick={() => onPick(field, preset.value, preset.action)}
            className={cn(
              "min-h-11 cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2",
              selected
                ? "border-cyan-400 bg-cyan-100 text-cyan-800"
                : "border-slate-200 bg-white text-slate-600 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-800",
            )}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}

function SectionCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-cyan-100 bg-white/90 p-4 shadow-[0_12px_32px_rgba(8,145,178,0.08)] sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900 sm:text-base">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function UploadPreviewCard({ file }: { file: UploadedFileInfo }) {
  const fileUrl = buildUploadUrl(file);

  return (
    <a
      href={fileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group block cursor-pointer overflow-hidden rounded-3xl border border-slate-200 bg-white transition-transform duration-200 hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-[0_16px_36px_rgba(14,116,144,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
        <img
          src={fileUrl}
          alt={file.filename}
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-slate-950/75 via-slate-950/20 to-transparent px-3 pb-3 pt-8 text-[11px] text-white">
          <span className="max-w-[70%] truncate font-medium">{file.filename}</span>
          <span className="rounded-full bg-cyan-500/90 px-2 py-1 font-medium text-white">
            已归档
          </span>
        </div>
      </div>
    </a>
  );
}

export function MedicalRecordCard({
  data,
  mode = "inline",
  onRefresh,
  onPatientInfoSaved,
  onActionBarChange,
}: MedicalRecordCardProps) {
  const [savedInfo, setSavedInfo] = useState<PatientInfoState>(
    data.patient_info || {},
  );
  const [editedInfo, setEditedInfo] = useState<PatientInfoState>(
    data.patient_info || {},
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(mode === "dialog");
  const [uploads, setUploads] = useState<UploadedFileInfo[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [uploadsError, setUploadsError] = useState<string | null>(null);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSavedInfo(data.patient_info || {});
    setEditedInfo(data.patient_info || {});
  }, [data.patient_info, data.thread_id]);

  const refreshUploads = useCallback(async () => {
    setUploadsLoading(true);
    setUploadsError(null);
    try {
      const result = await listUploadedFiles(data.thread_id);
      const primaryUploads = (result.files ?? []).filter((file) => {
        const lowerName = file.filename.toLowerCase();
        return !lowerName.endsWith(".ocr.md") && !lowerName.endsWith(".md");
      });
      setUploads(primaryUploads);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "上传资料加载失败";
      setUploadsError(message);
    } finally {
      setUploadsLoading(false);
    }
  }, [data.thread_id]);

  useEffect(() => {
    void refreshUploads();
  }, [refreshUploads]);

  const updateField = useCallback((key: string, value: FormValue) => {
    setEditedInfo((prev) => ({ ...prev, [key]: value === "" ? null : value }));
  }, []);

  const applyQuickFill = useCallback(
    (field: string, nextValue: string, action: QuickFillAction = "append") => {
      setEditedInfo((prev) => ({
        ...prev,
        [field]: action === "replace" ? nextValue : mergePreset(prev[field], nextValue),
      }));
    },
    [],
  );

  const resetChanges = useCallback(() => {
    setEditedInfo(savedInfo);
    setSaveMessage(null);
  }, [savedInfo]);

  const handleRefreshUploadsAction = useCallback(() => {
    void refreshUploads();
  }, [refreshUploads]);

  const dirtyFields = useMemo(
    () => computeDirtyFields(savedInfo, editedInfo),
    [editedInfo, savedInfo],
  );

  const isDirty = useMemo(() => Object.keys(dirtyFields).length > 0, [dirtyFields]);

  const handleSave = useCallback(async () => {
    if (!isDirty) {
      return;
    }

    setIsSaving(true);
    setSaveMessage(null);
    try {
      const response = await fetch(
        `${getBackendBaseURL()}/api/threads/${data.thread_id}/patient-intake`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dirtyFields),
        },
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const result = (await response.json()) as { patient_info?: PatientInfoState };
      const changes = buildPatientFieldChanges(savedInfo, dirtyFields);
      const nextSavedInfo = result.patient_info ?? { ...savedInfo, ...dirtyFields };
      setSavedInfo(nextSavedInfo);
      setEditedInfo(nextSavedInfo);
      setSaveMessage("病历单已保存");
      const saveEvent: PatientInfoSaveEvent = {
        changes,
        dirtyFields,
      };
      if (changes.length > 0 && onPatientInfoSaved) {
        try {
          await onPatientInfoSaved(saveEvent);
        } catch (error) {
          console.warn("Failed to send patient info update to chat", error);
        }
      }
      setTimeout(() => setSaveMessage(null), 2200);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "保存失败";
      setSaveMessage(message);
    } finally {
      setIsSaving(false);
    }
  }, [data.thread_id, dirtyFields, isDirty, onPatientInfoSaved, savedInfo]);

  const handleSaveAction = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const handleUploadFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) {
        return;
      }

      setIsUploadingFiles(true);
      setUploadMessage(null);
      try {
        await uploadFiles(data.thread_id, Array.from(files));
        await Promise.all([refreshUploads(), Promise.resolve(onRefresh?.())]);
        setShowEvidence(true);
        setUploadMessage("资料已上传，已归档到病例页");
        window.setTimeout(() => setUploadMessage(null), 2600);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "上传失败";
        setUploadMessage(message);
      } finally {
        setIsUploadingFiles(false);
      }
    },
    [data.thread_id, onRefresh, refreshUploads],
  );

  const guidance = data.guidance;

  useEffect(() => {
    if (!onActionBarChange) {
      return;
    }

    onActionBarChange({
      isDirty,
      isSaving,
      uploadsLoading,
      currentPatientInfo: editedInfo,
      onReset: resetChanges,
      onRefreshUploads: handleRefreshUploadsAction,
      onSave: handleSaveAction,
    });

    return () => onActionBarChange(null);
  }, [
    editedInfo,
    handleRefreshUploadsAction,
    handleSaveAction,
    isDirty,
    isSaving,
    onActionBarChange,
    resetChanges,
    uploadsLoading,
  ]);

  const requiredFilledCount = useMemo(
    () =>
      REQUIRED_PATIENT_INFO_FIELDS.filter((field) => normalizeValue(editedInfo[field]).length > 0)
        .length,
    [editedInfo],
  );

  const totalFilledCount = useMemo(
    () =>
      Object.values(editedInfo).filter((value) => normalizeValue(value).length > 0)
        .length,
    [editedInfo],
  );

  const previewableUploads = useMemo(
    () => uploads.filter((file) => isPreviewableImage(file.filename)),
    [uploads],
  );

  const nonImageUploads = useMemo(
    () => uploads.filter((file) => !isPreviewableImage(file.filename)),
    [uploads],
  );

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-[28px] border border-cyan-200/80 bg-[linear-gradient(180deg,rgba(236,254,255,0.92),rgba(248,250,252,0.98))] shadow-[0_24px_72px_rgba(8,145,178,0.12)]",
        mode === "inline" ? "max-w-4xl" : "max-w-none",
      )}
    >
      <div className="border-b border-cyan-100 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.94),rgba(255,255,255,0.82))] px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-cyan-600 text-white shadow-[0_12px_24px_rgba(8,145,178,0.28)]">
                <FileText className="size-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-950">
                  登记与资料
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  这里保存当前问诊登记信息和已归档资料，可随时补充后再提交挂号。
                </p>
              </div>
            </div>

            {data.message ? (
              <div className="mt-4 rounded-2xl border border-cyan-100 bg-white/80 px-4 py-3 text-sm leading-6 text-slate-600">
                {data.message}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-medium text-cyan-800">
                {requiredFilledCount}/{REQUIRED_PATIENT_INFO_FIELDS.length} 必填已完成
              </span>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                已填写 {totalFilledCount} 项
              </span>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                已归档资料 {uploads.length} 份
              </span>
            </div>

            {guidance?.next_action ? (
              <div className="mt-4 rounded-3xl border border-cyan-100 bg-white/80 px-4 py-4">
                <p className="text-sm font-medium text-slate-900">当前建议</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{guidance.next_action}</p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {saveMessage ? (
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium",
                  saveMessage === "病历单已保存"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-rose-100 text-rose-700",
                )}
              >
                {saveMessage}
              </span>
            ) : null}
            {uploadMessage ? (
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium",
                  uploadMessage === "资料已上传，已归档到病例页"
                    ? "bg-cyan-100 text-cyan-800"
                    : "bg-rose-100 text-rose-700",
                )}
              >
                {uploadMessage}
              </span>
            ) : null}
            {!onActionBarChange ? (
              <>
                <button
                  type="button"
                  onClick={resetChanges}
                  disabled={!isDirty || isSaving}
                  className="min-h-11 cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  恢复未保存
                </button>
                <button
                  type="button"
                  onClick={handleRefreshUploadsAction}
                  disabled={uploadsLoading}
                  className="min-h-11 cursor-pointer rounded-full border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-medium text-cyan-800 transition-colors hover:border-cyan-300 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-2">
                    <RefreshCw className={cn("size-4", uploadsLoading && "animate-spin")} />
                    刷新资料
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveAction}
                  disabled={!isDirty || isSaving}
                  className="min-h-11 cursor-pointer rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(5,150,105,0.24)] transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  <span className="inline-flex items-center gap-2">
                    {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    保存更改
                  </span>
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-5 px-4 py-5 sm:px-6 sm:py-6">
        <SectionCard
          title="身份信息"
          description="先补齐挂号所需的基础身份信息，性别直接点选即可。"
          icon={<UserRound className="size-5" />}
        >
          <div className="grid gap-4 md:grid-cols-[1.2fr_0.7fr_1fr]">
            <div>
              <FieldLabel htmlFor="medical-record-name" label="姓名" required />
              <input
                id="medical-record-name"
                type="text"
                value={normalizeValue(editedInfo.name)}
                onChange={(event) => updateField("name", event.target.value)}
                placeholder="请输入患者姓名"
                className="min-h-12 w-full rounded-2xl border border-cyan-100 bg-cyan-50/30 px-4 text-base text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-100"
              />
            </div>
            <div>
              <FieldLabel htmlFor="medical-record-age" label="年龄" required />
              <input
                id="medical-record-age"
                type="number"
                min="0"
                max="120"
                value={normalizeValue(editedInfo.age)}
                onChange={(event) => updateField("age", event.target.value)}
                placeholder="年龄"
                className="min-h-12 w-full rounded-2xl border border-cyan-100 bg-cyan-50/30 px-4 text-base text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-100"
              />
            </div>
            <div>
              <FieldLabel htmlFor="medical-record-sex" label="性别" required />
              <div
                id="medical-record-sex"
                className="grid min-h-12 grid-cols-3 gap-2 rounded-2xl bg-cyan-50/40 p-1"
              >
                {["男", "女", "其他"].map((sex) => {
                  const active = normalizeValue(editedInfo.sex) === sex;
                  return (
                    <button
                      key={sex}
                      type="button"
                      onClick={() => updateField("sex", sex)}
                      className={cn(
                        "min-h-10 cursor-pointer rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2",
                        active
                          ? "bg-cyan-600 text-white shadow-[0_10px_24px_rgba(8,145,178,0.22)]"
                          : "bg-white text-slate-600 hover:bg-cyan-100 hover:text-cyan-800",
                      )}
                    >
                      {sex}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="就诊描述"
          description="主诉默认放大展示，优先写清楚哪里不舒服、持续多久、有没有加重。"
          icon={<ShieldAlert className="size-5" />}
        >
          <div className="space-y-4">
            <div>
              <FieldLabel
                htmlFor="medical-record-chief-complaint"
                label="主诉"
                required
              />
              <textarea
                id="medical-record-chief-complaint"
                rows={mode === "dialog" ? 4 : 3}
                value={normalizeValue(editedInfo.chief_complaint)}
                onChange={(event) => updateField("chief_complaint", event.target.value)}
                placeholder="例如：发热、咳嗽 3 天，夜间加重；胸口闷痛 2 小时"
                className="min-h-[112px] w-full resize-y rounded-3xl border border-cyan-100 bg-cyan-50/30 px-4 py-3 text-base leading-7 text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-100"
              />
              <QuickFillGroup
                field="chief_complaint"
                value={editedInfo.chief_complaint}
                onPick={applyQuickFill}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <FieldLabel htmlFor="medical-record-present-illness" label="现病史" />
                <textarea
                  id="medical-record-present-illness"
                  rows={4}
                  value={normalizeValue(editedInfo.present_illness)}
                  onChange={(event) => updateField("present_illness", event.target.value)}
                  placeholder="记录症状出现时间、诱因、变化趋势、伴随症状等"
                  className="min-h-[132px] w-full resize-y rounded-3xl border border-cyan-100 bg-white px-4 py-3 text-sm leading-7 text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-100"
                />
                <QuickFillGroup
                  field="present_illness"
                  value={editedInfo.present_illness}
                  onPick={applyQuickFill}
                />
              </div>

              <div>
                <FieldLabel htmlFor="medical-record-medical-history" label="既往史" />
                <textarea
                  id="medical-record-medical-history"
                  rows={4}
                  value={normalizeValue(editedInfo.medical_history)}
                  onChange={(event) => updateField("medical_history", event.target.value)}
                  placeholder="例如：高血压 5 年，长期服用氨氯地平；既往行阑尾切除术"
                  className="min-h-[132px] w-full resize-y rounded-3xl border border-cyan-100 bg-white px-4 py-3 text-sm leading-7 text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-100"
                />
                <QuickFillGroup
                  field="medical_history"
                  value={editedInfo.medical_history}
                  onPick={applyQuickFill}
                />
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="medical-record-allergies" label="过敏与用药" />
              <textarea
                id="medical-record-allergies"
                rows={3}
                value={normalizeValue(editedInfo.allergies)}
                onChange={(event) => updateField("allergies", event.target.value)}
                placeholder="例如：青霉素过敏；目前服用降压药、退烧药等"
                className="min-h-[108px] w-full resize-y rounded-3xl border border-cyan-100 bg-white px-4 py-3 text-sm leading-7 text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-100"
              />
              <QuickFillGroup
                field="allergies"
                value={editedInfo.allergies}
                onPick={applyQuickFill}
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="生命体征"
          description="没有精确数值也可以先点常用值，后续再修正。"
          icon={<HeartPulse className="size-5" />}
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { key: "temperature", label: "体温 (°C)", placeholder: "36.5" },
              { key: "heart_rate", label: "心率 (bpm)", placeholder: "72" },
              { key: "blood_pressure", label: "血压", placeholder: "120/80" },
              { key: "spo2", label: "血氧 (%)", placeholder: "98" },
            ].map((field) => (
              <div key={field.key}>
                <FieldLabel
                  htmlFor={`medical-record-${field.key}`}
                  label={field.label}
                />
                <input
                  id={`medical-record-${field.key}`}
                  type="text"
                  value={normalizeValue(editedInfo[field.key])}
                  onChange={(event) => updateField(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  className="min-h-12 w-full rounded-2xl border border-cyan-100 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-100"
                />
                <QuickFillGroup
                  field={field.key}
                  value={editedInfo[field.key]}
                  onPick={applyQuickFill}
                />
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="上传资料确认"
          description="这里只保留原图预览和文件归档列表，专业解读会转到医生端处理。"
          icon={<FileImage className="size-5" />}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleUploadFiles(event.target.files);
              event.target.value = "";
            }}
          />

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-cyan-100 bg-cyan-50/50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-900">原图预览与补充上传</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                可直接在这里补传检查单、化验单或影像图片。上传后会自动归入病例页，患者端不再展示解析进度或分析摘要。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingFiles}
                className="min-h-11 cursor-pointer rounded-full bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(8,145,178,0.24)] transition-colors hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-cyan-300"
              >
                <span className="inline-flex items-center gap-2">
                  {isUploadingFiles ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  {isUploadingFiles ? "上传中..." : "从病例页上传资料"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setShowEvidence((current) => !current)}
                className="min-h-11 cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-800"
              >
                {showEvidence ? "收起资料区" : "展开资料区"}
              </button>
            </div>
          </div>

          {showEvidence ? (
            <div className="space-y-5">
              {uploadsLoading ? (
                <div className="flex min-h-32 items-center justify-center rounded-3xl border border-dashed border-cyan-200 bg-white/70 text-sm text-slate-500">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    正在加载上传资料...
                  </span>
                </div>
              ) : previewableUploads.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {previewableUploads.map((file) => (
                    <UploadPreviewCard key={file.filename} file={file} />
                  ))}
                </div>
              ) : (
                <div className="flex min-h-40 flex-col items-center justify-center rounded-3xl border border-dashed border-cyan-200 bg-white/70 px-6 text-center">
                  <div className="flex size-14 items-center justify-center rounded-full bg-cyan-50 text-cyan-700">
                    <Upload className="size-7" />
                  </div>
                  <p className="mt-4 text-base font-medium text-slate-800">
                    还没有可预览的上传图片
                  </p>
                  <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                    可直接点击上方“从病例页上传资料”，或继续在聊天里上传。无论从哪里上传，资料都会归到当前病例页，供您统一核对。
                  </p>
                </div>
              )}

              {nonImageUploads.length > 0 ? (
                <div>
                  <p className="mb-2 text-sm font-medium text-slate-800">其他已上传文件</p>
                  <div className="flex flex-wrap gap-2">
                    {nonImageUploads.map((file) => (
                      <a
                        key={file.filename}
                        href={buildUploadUrl(file)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-11 cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-800"
                      >
                        {file.filename}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-4 py-5 text-sm leading-6 text-slate-500">
                当前患者端仅展示已归档资料名称和原图预览；OCR、影像异常、结构化分析与医生复核信息均在医生端处理。
              </div>

              {uploadsError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  上传资料列表刷新失败：{uploadsError}
                </div>
              ) : null}
            </div>
          ) : null}
        </SectionCard>
      </div>

      <div className="border-t border-cyan-100 bg-white/75 px-5 py-3 text-xs text-slate-500 sm:px-6">
        <div className="flex items-start gap-2 leading-6">
          <Info className="mt-0.5 size-4 shrink-0 text-cyan-700" />
          <span>
            登记信息支持随时修改，也支持直接在这里补传资料。建议先补齐姓名、年龄、性别和主诉，再提交挂号；资料的专业解读和复核会在医生端继续完成。
          </span>
        </div>
      </div>
    </div>
  );
}