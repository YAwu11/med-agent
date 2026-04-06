"use client";

import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardCheck,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type DragEvent,
  type ElementType,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { BrainSpatialReview, type SpatialInfo } from "@/components/doctor/BrainSpatialReview";
import { ImagingViewer, type McpAnalysisResult } from "@/components/doctor/ImagingViewer";
import { LabMarkdownViewer, type LabValueWarning } from "@/components/doctor/LabMarkdownViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type EvidenceItem,
  fetchCase,
  fetchCaseSummaryReadiness,
  type CaseData,
  type CaseSummaryReadiness,
  type PatientInfo,
} from "@/core/api/cases";
import { cn } from "@/lib/utils";

interface EvidenceDeskProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isReviewPassed: boolean;
  onReviewPass: () => void;
  caseId?: string | null;
  onSynthesisDiagnosis?: () => void;
}

interface EvidenceDeskTab {
  id: string;
  label: string;
  type: EvidenceItem["type"];
  item?: EvidenceItem;
}

type NumericPatientField = {
  [K in keyof PatientInfo]-?: NonNullable<PatientInfo[K]> extends number ? K : never;
}[keyof PatientInfo];

type PatientInfoDraft = {
  [K in keyof PatientInfo]?: K extends NumericPatientField ? PatientInfo[K] | string : PatientInfo[K];
};

interface ImagingStructuredData extends Record<string, unknown> {
  pipeline?: string;
  spatial_info?: unknown;
  slice_png_path?: string;
  status?: string;
  report_id?: string;
  modality?: string;
  viewer_kind?: string;
  required_sequences?: string[];
  detected_sequences?: string[];
  missing_sequences?: string[];
  ready_for_analysis?: boolean;
  upload_mode?: string;
}

interface LabStructuredData extends Record<string, unknown> {
  ocr_raw_numbers?: string[];
  value_warnings?: LabValueWarning[];
}

const BRAIN_MRI_REQUIRED_SEQUENCES = ["t1", "t1ce", "t2", "flair"] as const;
type BrainMriSequence = (typeof BRAIN_MRI_REQUIRED_SEQUENCES)[number];

function isNiftiFilename(filename?: string | null): boolean {
  return Boolean(filename && /\.nii(\.gz)?$/i.test(filename));
}

function detectBrainMriSequence(filename?: string | null): BrainMriSequence | null {
  if (!filename) {
    return null;
  }

  const lowerName = filename.toLowerCase();
  const normalized = lowerName.replace(/\.nii(\.gz)?$/i, "").replace(/-/g, "_");
  if (normalized.includes("flair")) {
    return "flair";
  }
  if (normalized.includes("t1ce") || normalized.includes("t1c")) {
    return "t1ce";
  }
  if (normalized.includes("t2")) {
    return "t2";
  }
  if (normalized.includes("t1")) {
    return "t1";
  }
  return null;
}

function deriveBrainMriUploadStatus(evidenceItems: EvidenceItem[]) {
  const detectedSequences = new Set<BrainMriSequence>();
  let readyForAnalysis: boolean | null = null;

  for (const item of evidenceItems) {
    const structured = item.structured_data as ImagingStructuredData | undefined;
    const candidateName = item.file_path ?? item.title;
    const sequence = isNiftiFilename(candidateName) ? detectBrainMriSequence(candidateName) : null;

    if (sequence) {
      detectedSequences.add(sequence);
    }

    if (structured?.pipeline !== "brain_nifti_v1") {
      continue;
    }

    if (Array.isArray(structured.detected_sequences)) {
      for (const value of structured.detected_sequences) {
        if (BRAIN_MRI_REQUIRED_SEQUENCES.includes(value as BrainMriSequence)) {
          detectedSequences.add(value as BrainMriSequence);
        }
      }
    }

    if (typeof structured.ready_for_analysis === "boolean") {
      readyForAnalysis = structured.ready_for_analysis;
    }
  }

  const orderedDetected = BRAIN_MRI_REQUIRED_SEQUENCES.filter((sequence) => detectedSequences.has(sequence));
  const missingSequences = BRAIN_MRI_REQUIRED_SEQUENCES.filter((sequence) => !detectedSequences.has(sequence));

  return {
    detectedSequences: orderedDetected,
    missingSequences,
    readyForAnalysis: readyForAnalysis ?? missingSequences.length === 0,
    hasAnyBrainSeries: orderedDetected.length > 0,
  };
}

function parseIntegerInput(value: string): number | "" {
  if (!value) {
    return "";
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? "" : parsed;
}

function parseFloatInput(value: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function EvidenceDesk({ activeTab, onTabChange, isReviewPassed, onReviewPass, caseId, onSynthesisDiagnosis }: EvidenceDeskProps) {
  const router = useRouter();
  
  // ── API Data State ──────────────────────────────────
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [, setIsLoading] = useState(false);
  const [summaryReadiness, setSummaryReadiness] =
    useState<CaseSummaryReadiness | null>(null);
  
  // ── Local Edit State for Patient Info (Gap) ──────────
  const [localInfo, setLocalInfo] = useState<PatientInfoDraft>({});

  useEffect(() => {
    if (!caseId) return;

    let disposed = false;

    const syncCase = async (shouldSyncLocalInfo: boolean) => {
      const [caseResult, readinessResult] = await Promise.allSettled([
        fetchCase(caseId),
        fetchCaseSummaryReadiness(caseId),
      ]);

      if (disposed) {
        return;
      }

      if (caseResult.status === "fulfilled") {
        const data = caseResult.value;
        setCaseData(data);
        if (shouldSyncLocalInfo && data?.patient_info) {
          setLocalInfo(data.patient_info);
        }
        if (shouldSyncLocalInfo && data.evidence.length > 0) {
          onTabChange("vitals");
        }
      } else {
        console.error("[EvidenceDesk] Failed to fetch initial case data:", caseResult.reason);
      }

      if (readinessResult.status === "fulfilled") {
        setSummaryReadiness(readinessResult.value);
      } else {
        console.warn("[EvidenceDesk] Failed to fetch synthesis readiness:", readinessResult.reason);
      }
    };

    setIsLoading(true);
    void syncCase(true)
      .finally(() => setIsLoading(false));

    // Basic polling mechanism to keep evidence in sync, especially for patient uploads or async backend ops
    const pollInterval = setInterval(() => {
      void syncCase(false);
    }, 5000);

    return () => {
      disposed = true;
      clearInterval(pollInterval);
    };
  }, [caseId, onTabChange]);

  // Derive display values from API data or mock defaults
  const evidenceItems = caseData?.evidence ?? [];
  const brainMriUploadStatus = deriveBrainMriUploadStatus(evidenceItems);

  // Create dynamic ALL_TABS from evidence Items
  const ALL_TABS: EvidenceDeskTab[] = [
    { id: "vitals", label: "基础体征与历史", type: "vitals" }
  ];
  evidenceItems.forEach((ev, i) => {
    ALL_TABS.push({
      id: `ev_${ev.evidence_id}`,
      label: ev.title || `附加数据 ${i+1}`,
      type: ev.type,
      item: ev
    });
  });

  const [reviewedTabs, setReviewedTabs] = useState<Set<string>>(new Set());
  const toggleReviewed = (tabId: string) => {
    setReviewedTabs(prev => {
      const next = new Set(prev);
      if (next.has(tabId)) next.delete(tabId); else next.add(tabId);
      return next;
    });
  };
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingEvidence, setIsUploadingEvidence] = useState(false);
  const isSynthesizing = false;
  const [isDragging, setIsDragging] = useState(false);

  // ── P0: 诊断表单状态 ──────────────────────────────────
  const [showDiagnosisForm, setShowDiagnosisForm] = useState(false);
  const [diagnosisForm, setDiagnosisForm] = useState({
    primary_diagnosis: "",
    secondary_diagnoses: "",
    treatment_plan: "",
    prescription: "",
    follow_up: "",
    doctor_notes: "",
  });
  const [diagnosisSubmitted, setDiagnosisSubmitted] = useState(false);

  // 综合诊断：触发父组件启动 SSE 流（不再前端拉摘要）
  const handleSynthesisDiagnosis = () => {
    if (!caseId || !onSynthesisDiagnosis) return;

    if (!summaryReadiness?.ready_for_synthesis) {
      toast.warning(summaryReadiness?.status_text ?? "当前资料尚未准备完成，暂不能综合诊断。");
      return;
    }

    onSynthesisDiagnosis();
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const targetThreadId = caseData?.patient_thread_id ?? caseId;
    if (!files || files.length === 0 || !caseId || !targetThreadId) {
      console.warn("EvidenceDesk uploadFiles early return due to missing context", { files: files?.length, caseId, targetThreadId, caseData });
      return;
    }
    setIsUploadingEvidence(true);
    try {
      const { getBackendBaseURL } = await import("@/core/config");
      const formData = new FormData();
      Array.from(files).forEach(f => formData.append("files", f));
      
      const uploadRes = await fetch(`${getBackendBaseURL()}/api/threads/${targetThreadId}/uploads`, {
        method: "POST",
        body: formData
      });
      if (!uploadRes.ok) {
        throw new Error(`Upload failed with status ${uploadRes.status}`);
      }
      await uploadRes.json();
      
      // 移除原有的手动 POST /evidence 逻辑，让后端的 _auto_sync_evidence 自动归档并提取 OCR 的动态标题
      
      // Refresh case to see new evidence
      const { fetchCase: fetchCaseFresh } = await import("@/core/api/cases");
      const data = await fetchCaseFresh(caseId);
      setCaseData(data);
    } catch (err) {
      console.error("[Gap① Add Evidence] Failed to upload new evidence:", err);
    } finally {
      setIsUploadingEvidence(false);
    }
  };

  const sidebarFileInputRef = useRef<HTMLInputElement | null>(null);
  const brainMriFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSidebarUpload = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      void uploadFiles(e.target.files);
    }
    // refresh input so same file can be uploaded again if needed
    e.target.value = "";
  };

  const handleBrainMriUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files ?? []);
    const niftiFiles = selectedFiles.filter((file) => isNiftiFilename(file.name));

    if (selectedFiles.length > 0 && niftiFiles.length === 0) {
      toast.warning("脑 MRI 专用入口仅支持 .nii 或 .nii.gz 文件");
      e.target.value = "";
      return;
    }

    if (niftiFiles.length !== selectedFiles.length) {
      toast.warning("已忽略非 NIfTI 文件，仅上传 .nii / .nii.gz");
    }

    if (niftiFiles.length > 0) {
      void uploadFiles(niftiFiles);
    }

    e.target.value = "";
  };

  // ── Drag & Drop Handlers ─────────────────────────────
  // 核心防止闪烁方案：外层容器负责开启拖拽，开启后由全屏的全覆盖遮罩接管所有后续事件
  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // 只有当拖拽内容包含文件时，才触发遮罩层（避免拖拽选中文本时触发）
    if (e.dataTransfer.types?.includes("Files")) {
      setIsDragging(true);
    }
  };
  
  // onDragOver 在外层只做默认拦截，具体 drop 和 leave 交给 overlay 处理
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  // ── Patient Info Update Handler ────────────────────────
  // To avoid race conditions and keystroke blocking, we use local state and a delayed patch.
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const updatePatientInfo = async <K extends keyof PatientInfo>(
    field: K,
    value: PatientInfoDraft[K] | "",
  ) => {
    if (!caseId) return;

    const normalizedValue = value === "" ? null : value;
    
    // Optimistic update locally
    setLocalInfo((prev) => ({ ...prev, [field]: normalizedValue }));

    // Debounce the PATCH to backend (500ms)
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      void (async () => {
        try {
          const { getBackendBaseURL } = await import("@/core/config");
          const payload = { [field]: normalizedValue };
          await fetch(`${getBackendBaseURL()}/api/cases/${caseId}/patient-info`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
        } catch (e) {
          console.error("[Gap Update Patient Info] Failed:", e);
        }
      })();
    }, 500);
  };

  // P0: 展开诊断表单（替代直接改 status）
  const handleReviewPassClick = () => {
    if (!caseId) {
      onReviewPass();
      return;
    }
    setShowDiagnosisForm(true);
  };

  // P0: 提交诊断结论 → PUT /api/cases/{id}/diagnosis → 自动设 status=diagnosed
  const handleSubmitDiagnosis = async () => {
    if (!caseId || !diagnosisForm.primary_diagnosis.trim()) return;
    setIsSubmitting(true);
    try {
      const { getBackendBaseURL } = await import("@/core/config");
      const res = await fetch(`${getBackendBaseURL()}/api/cases/${caseId}/diagnosis`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primary_diagnosis: diagnosisForm.primary_diagnosis.trim(),
          secondary_diagnoses: diagnosisForm.secondary_diagnoses
            ? diagnosisForm.secondary_diagnoses.split(/[,，]/).map(s => s.trim()).filter(Boolean)
            : [],
          treatment_plan: diagnosisForm.treatment_plan.trim(),
          prescription: diagnosisForm.prescription.trim() || null,
          follow_up: diagnosisForm.follow_up.trim() || null,
          doctor_notes: diagnosisForm.doctor_notes.trim(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDiagnosisSubmitted(true);
      onReviewPass();
      // 1.5 秒后自动返回队列
      window.setTimeout(() => {
        void router.push("/doctor/queue");
      }, 1500);
    } catch (e) {
      console.error("Failed to submit diagnosis", e);
      toast.error("诊断提交失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const allReviewed = ALL_TABS.every(t => reviewedTabs.has(t.id));
  
  const activeTabData = ALL_TABS.find(t => t.id === activeTab);
  const activeEvidenceItem = activeTabData?.item;
  
  const handleDeleteEvidence = async (e: MouseEvent, evidenceId: string) => {
    e.stopPropagation();
    if (!caseId) return;
    if (!confirm("确定要删除这项目前的文件吗？此操作无法撤销。")) return;
    setIsLoading(true);
    try {
      const { getBackendBaseURL } = await import("@/core/config");
      const res = await fetch(`${getBackendBaseURL()}/api/cases/${caseId}/evidence/${evidenceId}`, {
        method: "DELETE"
      });
      if (!res.ok) {
        throw new Error(`HTTP Error ${res.status}: Method Not Allowed or Server Error`);
      }
      const { fetchCase: fetchCaseFresh } = await import("@/core/api/cases");
      const freshData = await fetchCaseFresh(caseId);
      setCaseData(freshData);
      if (activeTab === `ev_${evidenceId}`) {
        onTabChange("vitals");
      }
    } catch (err) {
      console.error("Delete evidence failed", err);
      alert("删除失败，请重试");
    } finally {
      setIsLoading(false);
    }
  };
  
  // 提取一个公用的渲染左侧菜单按钮的小组件函数，保持代码整洁
  const renderTab = (id: string, label: string, Icon: ElementType, isAlert = false, evidenceId?: string) => {
    const isActive = activeTab === id;
    const isReviewed = reviewedTabs.has(id);
    return (
      <div key={id} className="flex items-center gap-1">
        <button
          onClick={() => onTabChange(id)}
          className={cn(
            "flex-1 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ring-1 min-w-0 text-left",
            isActive 
              ? "bg-blue-50 text-blue-700 shadow-sm ring-blue-200 font-semibold" 
              : "bg-transparent text-slate-600 hover:bg-slate-200/50 ring-transparent hover:text-slate-900 font-medium"
          )}
        >
          <div className={cn("p-1.5 rounded-md shrink-0", isActive ? "bg-white text-blue-600 shadow-sm" : "bg-white text-slate-400 border border-slate-200/50")}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="truncate flex-1">{label}</span>
          {isAlert && !isReviewed && <span className="ml-auto w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0"></span>}
        </button>
        {evidenceId && (
          <button
            onClick={(e) => handleDeleteEvidence(e, evidenceId)}
            className="p-1.5 rounded-lg transition-all shrink-0 text-slate-300 hover:text-red-500 hover:bg-red-50"
            title="删除这份报告"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); toggleReviewed(id); }}
          className={cn(
            "p-1.5 rounded-lg transition-all shrink-0",
            isReviewed
              ? "text-emerald-600 hover:text-emerald-700"
              : "text-slate-300 hover:text-slate-500"
          )}
          title={isReviewed ? "已确认审核" : "点击确认审核"}
        >
          {isReviewed ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
        </button>
      </div>
    );
  };

  return (
    <div 
      className={cn("flex h-full w-full bg-slate-50 relative", isDragging ? "ring-4 ring-blue-400 ring-inset" : "")}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
    >
      {/* 拖拽上传遮罩 - 开启后接管所有事件防止冒泡导致闪烁 */}
      {isDragging && (
        <div 
          className="absolute inset-0 z-50 flex items-center justify-center bg-blue-50/80 backdrop-blur-sm rounded-xl mx-2 my-2 transition-all"
          onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files?.length) {
              void uploadFiles(e.dataTransfer.files);
            }
          }}
        >
          {/* pointer-events-none 确保鼠标在内部文本上方游走时不触发 leave 事件 */}
          <div className="flex flex-col items-center justify-center p-12 bg-white/90 rounded-2xl shadow-2xl border-2 border-dashed border-blue-500 scale-105 transition-transform duration-200 pointer-events-none">
            <div className="w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center mb-6 animate-bounce">
              <Plus className="h-12 w-12 text-blue-600" />
            </div>
            <h3 className="text-2xl font-bold text-slate-800 mb-3 tracking-tight">松开鼠标上传作为证据</h3>
            <p className="text-slate-500 font-medium">支持拖入图片、PDF、电子病历和 .nii/.nii.gz 影像序列</p>
          </div>
        </div>
      )}

      {/* 25% 左侧导航 - 临床证据归档 (Master List) */}
      <div className="w-[280px] shrink-0 border-r border-slate-200 bg-slate-50 flex flex-col h-full z-10 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
        <div className="px-5 py-4 border-b border-slate-200/60 flex items-center justify-between bg-white/50 backdrop-blur">
          <h3 className="font-semibold text-slate-800 tracking-tight">患者查体归档</h3>
          <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full uppercase">6项</span>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
          <div className="space-y-1">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 ml-2 flex items-center justify-between">
              主病历数据 <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded mr-2">1</span>
            </div>
            {ALL_TABS.filter(t => t.type === 'vitals').map(t => renderTab(t.id, t.label, User, false))}
          </div>

          {ALL_TABS.filter(t => t.type === "imaging").length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 ml-2 flex items-center justify-between">
                医学影像 <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded mr-2">{ALL_TABS.filter(t => t.type === "imaging").length}</span>
              </div>
              {ALL_TABS.filter(t => t.type === "imaging").map(t => renderTab(t.id, t.label, ImageIcon, t.item?.is_abnormal, t.item?.evidence_id))}
            </div>
          )}

          {ALL_TABS.filter(t => t.type === "lab" || t.type === "ecg" || t.type === "note").length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 ml-2 flex items-center justify-between">
                化验单与检查 <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded mr-2">{ALL_TABS.filter(t => t.type === "lab" || t.type === "ecg" || t.type === "note").length}</span>
              </div>
              {ALL_TABS.filter(t => t.type === "lab" || t.type === "ecg" || t.type === "note").map(t => renderTab(t.id, t.label, FileText, t.item?.is_abnormal, t.item?.evidence_id))}
            </div>
          )}
        </div>

        {/* File Upload Contextual Action */}
        <div className="px-3 py-4 border-t border-slate-200/60 bg-white/50 backdrop-blur mt-auto">
          <div className="mb-3 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-cyan-50 p-3 shadow-sm">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-700">
              <Sparkles className="h-3.5 w-3.5" />
              脑 MRI 四序列引导
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-slate-600">
              建议按 t1 / t1ce(t1c) / t2 / flair 命名，可分批上传；集齐后系统会进入 3D 分析链路。
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {BRAIN_MRI_REQUIRED_SEQUENCES.map((sequence) => {
                const detected = brainMriUploadStatus.detectedSequences.includes(sequence);
                return (
                  <span
                    key={sequence}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase",
                      detected
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-500",
                    )}
                  >
                    {sequence}
                  </span>
                );
              })}
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-[12px] text-slate-600">
              <ShieldCheck className={cn("mt-0.5 h-4 w-4 shrink-0", brainMriUploadStatus.readyForAnalysis ? "text-emerald-500" : "text-blue-500")} />
              <div>
                <p className="font-medium text-slate-700">
                  {brainMriUploadStatus.readyForAnalysis
                    ? "四序列已集齐，可以触发 3D 脑肿瘤分析。"
                    : brainMriUploadStatus.hasAnyBrainSeries
                      ? `当前仍缺少 ${brainMriUploadStatus.missingSequences.join(" / ")}`
                      : "当前病例尚未收集到脑 MRI 序列。"}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  已识别：{brainMriUploadStatus.detectedSequences.length > 0 ? brainMriUploadStatus.detectedSequences.join(" / ") : "暂无"}
                </p>
              </div>
            </div>
          </div>

          <input
            type="file"
            id="sidebarFileSelect"
            className="hidden"
            multiple
            ref={sidebarFileInputRef}
            onChange={handleSidebarUpload}
          />
          <input
            type="file"
            id="brainMriFileSelect"
            className="hidden"
            multiple
            accept=".nii,.nii.gz"
            ref={brainMriFileInputRef}
            onChange={handleBrainMriUpload}
          />
          <div className="space-y-2">
          <Button 
            variant="outline" 
            className="w-full justify-center gap-2 bg-white backdrop-blur border-blue-200 text-blue-600 hover:bg-blue-50 transition-all shadow-sm rounded-xl py-6"
            onClick={() => sidebarFileInputRef.current?.click()}
            disabled={isUploadingEvidence}
          >
            <span className="inline-flex h-4 w-4 items-center justify-center">
              {isUploadingEvidence ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </span>
            <span>{isUploadingEvidence ? "上传中..." : "补充医疗附件"}</span>
          </Button>
          <Button
            className="w-full justify-center gap-2 rounded-xl bg-slate-900 py-6 text-white shadow-sm transition-all hover:bg-slate-800"
            onClick={() => brainMriFileInputRef.current?.click()}
            disabled={isUploadingEvidence}
          >
            <span className="inline-flex h-4 w-4 items-center justify-center">
              {isUploadingEvidence ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            </span>
            <span>{isUploadingEvidence ? "上传中..." : "上传脑 MRI 四序列"}</span>
          </Button>
          </div>
        </div>
      </div>

      {/* 75% 右侧主视图 - 证据查看器与提交流程 (Detail View) */}
      <div className="flex-1 min-w-0 flex flex-col relative bg-slate-50/50">
        
        {/* 中心视野区 (Content Viewer) */}
        <div className="flex-1 overflow-y-auto relative bg-slate-50">
        
        {activeTab === "vitals" && (
          <div className="animate-in fade-in duration-300 flex flex-col h-full min-h-max p-6 max-w-7xl mx-auto w-full">
            <div className="flex items-center justify-between mb-6 shrink-0">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-800">Patient Vitals & History</h2>
              <div className="text-xs font-medium text-blue-600 bg-blue-50 px-3 py-1 rounded-full flex items-center gap-2 border border-blue-100">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                允许编辑修改 (Live EMR)
              </div>
            </div>

            <div className="flex gap-6 shrink-0">
              {/* === 左侧：现代化 患者心电监护仪风格 体征卡 (35%) === */}
              <div className="w-[35%] xl:w-[320px] bg-white border border-slate-200 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] p-6 flex flex-col relative overflow-hidden shrink-0 group hover:border-blue-200 transition-all">
                {/* 装饰性背景 */}
                <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-blue-50 to-transparent rounded-bl-full -z-10 opacity-70" />
                
                <div className="flex items-center gap-4 mb-6">
                  <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 border-[3px] border-white shadow-md ring-1 ring-slate-100 shrink-0">
                     <User className="h-7 w-7" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <Input 
                      className="p-0 h-auto border-none shadow-none text-xl font-bold tracking-tight text-slate-800 focus-visible:ring-0 placeholder:text-slate-300 placeholder:font-normal bg-transparent w-full truncate"
                      value={localInfo?.name ?? ""}
                      onChange={(e) => updatePatientInfo("name", e.target.value)}
                      placeholder="姓名未登记"
                    />
                    <span className="bg-slate-100 px-2 py-0.5 rounded text-[10px] font-bold text-slate-500 tracking-widest uppercase truncate max-w-fit mt-1" title={caseData?.case_id}>
                      ID: {caseData?.case_id?.slice(0, 8) ?? "Pt-2941"}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-4 mt-auto">
                  <div className="bg-white rounded-lg p-2.5 border border-slate-200 transition-colors focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-50 shadow-sm">
                    <div className="text-[10px] text-slate-500 font-medium mb-1">年龄 (岁)</div>
                    <Input 
                      type="number" min="0" max="150" step="1"
                      className="p-0 h-5 border-none shadow-none text-sm font-semibold text-slate-800 focus-visible:ring-0 bg-transparent"
                      value={localInfo?.age ?? ""}
                      onChange={(e) => updatePatientInfo("age", parseIntegerInput(e.target.value))}
                      placeholder="未输入"
                    />
                  </div>
                  <div className="bg-white rounded-lg p-2.5 border border-slate-200 transition-colors focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-50 shadow-sm relative">
                    <div className="text-[10px] text-slate-500 font-medium mb-1">性别</div>
                    <select 
                      className="w-full bg-transparent border-none focus:ring-0 text-slate-800 text-sm font-semibold p-0 appearance-none outline-none cursor-pointer h-5"
                      value={localInfo?.sex ?? ""}
                      onChange={(e) => updatePatientInfo("sex", e.target.value)}
                    >
                      <option value="男">男性</option>
                      <option value="女">女性</option>
                      <option value="">未知</option>
                    </select>
                  </div>
                  <div className="bg-white rounded-lg p-2.5 border border-slate-200 transition-colors focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-50 shadow-sm">
                    <div className="text-[10px] text-slate-500 font-medium mb-1">身高 (cm)</div>
                    <Input 
                      type="number" min="10" max="300" step="1"
                      className="p-0 h-5 border-none shadow-none text-sm font-semibold text-slate-800 focus-visible:ring-0 bg-transparent"
                      value={localInfo?.height_cm ?? ""}
                      onChange={(e) => updatePatientInfo("height_cm", e.target.value)}
                      onBlur={(e) => updatePatientInfo("height_cm", parseFloatInput(e.target.value))}
                      placeholder="未输入"
                    />
                  </div>
                  <div className="bg-white rounded-lg p-2.5 border border-slate-200 transition-colors focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-50 shadow-sm">
                    <div className="text-[10px] text-slate-500 font-medium mb-1">体重 (kg)</div>
                    <Input 
                      type="number" min="1" max="500" step="0.1"
                      className="p-0 h-5 border-none shadow-none text-sm font-semibold text-slate-800 focus-visible:ring-0 bg-transparent"
                      value={localInfo?.weight_kg ?? ""}
                      onChange={(e) => updatePatientInfo("weight_kg", e.target.value)}
                      onBlur={(e) => updatePatientInfo("weight_kg", parseFloatInput(e.target.value))}
                      placeholder="未输入"
                    />
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-5 mt-auto">
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Activity className="h-4 w-4 text-blue-500" /> 核心生命体征 (Vitals)
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                     <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 relative overflow-hidden transition-colors focus-within:ring-2 focus-within:ring-blue-100 focus-within:bg-white">
                       <div className="text-[10px] text-slate-500 font-bold mb-1">体温 (°C)</div>
                       <Input type="number" step="0.1" min="30" max="45" onChange={(e) => updatePatientInfo("temperature", e.target.value)} onBlur={(e) => updatePatientInfo("temperature", parseFloatInput(e.target.value))} className="p-0 h-auto border-none bg-transparent shadow-none text-xl font-bold text-slate-800 focus-visible:ring-0 placeholder:text-slate-300 placeholder:font-normal" placeholder="未录入" value={localInfo?.temperature ?? ""} />
                     </div>
                     <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 relative overflow-hidden transition-colors focus-within:ring-2 focus-within:ring-blue-100 focus-within:bg-white">
                       <div className="text-[10px] text-slate-500 font-bold mb-1">心率 (bpm)</div>
                       <Input type="number" step="1" min="0" max="300" onChange={(e) => updatePatientInfo("heart_rate", parseIntegerInput(e.target.value))} className="p-0 h-auto border-none bg-transparent shadow-none text-xl font-bold text-slate-800 focus-visible:ring-0 placeholder:text-slate-300 placeholder:font-normal" placeholder="未录入" value={localInfo?.heart_rate ?? ""} />
                     </div>
                     <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 relative overflow-hidden transition-colors focus-within:ring-2 focus-within:ring-blue-100 focus-within:bg-white flex flex-col justify-center">
                       <div className="text-[10px] text-slate-500 font-bold mb-1">血压 (高压/低压)</div>
                       <div className="flex items-center text-xl font-bold text-slate-800">
                         <Input 
                           type="number" step="1" min="30" max="300"
                           className="p-0 h-auto border-none bg-transparent shadow-none text-xl font-bold text-slate-800 focus-visible:ring-0 placeholder:text-slate-300 placeholder:font-normal w-[48px] text-center" 
                           placeholder="120" 
                           value={localInfo?.blood_pressure?.split('/')[0] ?? ""} 
                           onChange={(e) => updatePatientInfo("blood_pressure", `${e.target.value}/${localInfo?.blood_pressure?.split('/')[1] ?? ""}`)} 
                         />
                         <span className="text-slate-300 font-light mx-0.5">/</span>
                         <Input 
                           type="number" step="1" min="30" max="200"
                           className="p-0 h-auto border-none bg-transparent shadow-none text-xl font-bold text-slate-800 focus-visible:ring-0 placeholder:text-slate-300 placeholder:font-normal w-[48px] text-center" 
                           placeholder="80" 
                           value={localInfo?.blood_pressure?.split('/')[1] ?? ""} 
                           onChange={(e) => updatePatientInfo("blood_pressure", `${localInfo?.blood_pressure?.split('/')[0] ?? ""}/${e.target.value}`)} 
                         />
                       </div>
                     </div>
                     <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 relative overflow-hidden transition-colors focus-within:ring-2 focus-within:ring-blue-100 focus-within:bg-white">
                       <div className="text-[10px] text-slate-500 font-bold mb-1">血氧 (SpO2%)</div>
                       <Input type="number" step="1" min="0" max="100" onChange={(e) => updatePatientInfo("spo2", e.target.value)} onBlur={(e) => updatePatientInfo("spo2", parseFloatInput(e.target.value))} className="p-0 h-auto border-none bg-transparent shadow-none text-xl font-bold text-slate-800 focus-visible:ring-0 placeholder:text-slate-300 placeholder:font-normal" placeholder="未录入" value={localInfo?.spo2 ?? ""} />
                     </div>
                  </div>
                </div>
              </div>

              {/* === 右侧：主诉与既往史文本流 (65%) === */}
              <div className="flex-1 flex flex-col gap-4">
                <div className="flex flex-col border border-slate-200 bg-white p-4 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-blue-100 transition-all shrink-0">
                  <label className="text-sm font-medium text-slate-600 mb-2 block shrink-0">主诉 (Chief Complaint)</label>
                  <Textarea 
                    className="flex-1 resize-none border-none shadow-none focus-visible:ring-0 p-0 text-slate-800 font-bold placeholder:text-slate-300 placeholder:font-normal min-h-[28px]"
                    placeholder="未记录 (N/A)"
                    value={localInfo?.chief_complaint ?? ""}
                    onChange={(e) => updatePatientInfo("chief_complaint", e.target.value)}
                  />
                </div>
                <div className="flex flex-col border border-slate-200 bg-white p-5 rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-blue-100 transition-all" style={{ flex: 2.5 }}>
                  <label className="text-sm font-medium text-slate-600 mb-3 block shrink-0">现病史 (Present Illness)</label>
                  <Textarea 
                    className="flex-1 resize-none border-none shadow-none focus-visible:ring-0 p-0 text-slate-800 font-bold leading-relaxed placeholder:text-slate-300 placeholder:font-normal"
                    placeholder="未录入具体现病史... (N/A)"
                    value={localInfo?.present_illness ?? ""}
                    onChange={(e) => updatePatientInfo("present_illness", e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4" style={{ flex: 1.5 }}>
                  <div className="flex flex-col border border-slate-200 bg-white p-4 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                    <label className="text-sm font-medium text-slate-600 mb-2 block shrink-0">既往史 (Medical History)</label>
                    <Textarea 
                      className="flex-1 resize-none border-none shadow-none focus-visible:ring-0 p-0 text-sm text-slate-800 font-semibold leading-relaxed placeholder:text-slate-300 placeholder:font-normal min-h-[50px]"
                      placeholder="未录入 (N/A)"
                      value={localInfo?.medical_history ?? ""}
                      onChange={(e) => updatePatientInfo("medical_history", e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col border border-slate-200 bg-white p-4 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                    <label className="text-sm font-medium text-slate-600 mb-2 block shrink-0">过敏与用药 (Allergies & Meds)</label>
                    <Textarea 
                      className="flex-1 resize-none border-none shadow-none focus-visible:ring-0 p-0 text-sm text-slate-800 font-semibold leading-relaxed placeholder:text-slate-300 placeholder:font-normal min-h-[50px]"
                      placeholder="无已知过敏史 (N/A)"
                      value={localInfo?.allergies ?? ""}
                      onChange={(e) => updatePatientInfo("allergies", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 医生批注区 (Doctor's Annotation) */}
            <div className="mt-4 lg:mt-6 border-2 border-dashed border-blue-200 bg-[#f8fbff] p-5 rounded-xl relative group focus-within:border-blue-400 focus-within:bg-blue-50/50 transition-colors flex-1 flex flex-col min-h-[250px]">
              <div className="absolute -top-3 left-4 bg-blue-100 text-blue-700 text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5 shadow-[0_2px_4px_rgba(0,0,0,0.02)] border border-blue-200">
                 <User className="w-3.5 h-3.5" />
                 医生诊疗批注板 (Doctor&apos;s Notepad)
              </div>
              <Textarea 
                 placeholder="全白板模式：向下占据全部剩余空间。在此键入您对该患者病历的分析、修正、或者推断。这些信息将充当后续 LangGraph 的高权重先验知识..."
                 className="mt-2 w-full flex-1 border-none bg-transparent shadow-none focus-visible:ring-0 placeholder:text-blue-300 text-slate-700 text-lg leading-relaxed resize-none p-0"
              />
            </div>
          </div>
        )}

        {activeTabData?.type === "imaging" && activeEvidenceItem && (
          <>
            {(() => {
              const imagingStructuredData = activeEvidenceItem.structured_data as ImagingStructuredData | undefined;

              return imagingStructuredData?.pipeline === "brain_nifti_v1" ? (
              imagingStructuredData.status === "processing" ? (
                /* NIfTI 管线正在后台执行 Step 1-3，显示等待态 */
                <div className="flex flex-col items-center justify-center flex-1 h-full text-slate-500 py-20 animate-in fade-in duration-500">
                  <div className="relative mb-6">
                    <div className="w-20 h-20 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
                    <span className="absolute inset-0 flex items-center justify-center text-2xl">🧠</span>
                  </div>
                  <h3 className="text-lg font-semibold text-slate-700 mb-2">3D 脑肿瘤分析管线运行中</h3>
                  <p className="text-sm text-slate-400 max-w-md text-center leading-relaxed">
                    正在执行 nnU-Net 3D 分割 → 空间定位 → 2D 渲染切片...<br/>
                    预计耗时 30-120 秒，请稍候。页面将自动刷新。
                  </p>
                  <div className="mt-5 w-full max-w-xl rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                    <div className="flex flex-wrap gap-2">
                      {BRAIN_MRI_REQUIRED_SEQUENCES.map((sequence) => {
                        const detected = Array.isArray(imagingStructuredData?.detected_sequences)
                          ? imagingStructuredData.detected_sequences.includes(sequence)
                          : false;
                        return (
                          <span
                            key={sequence}
                            className={cn(
                              "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase",
                              detected
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 bg-slate-50 text-slate-500",
                            )}
                          >
                            {sequence}
                          </span>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-sm text-slate-600">
                      {Array.isArray(imagingStructuredData?.missing_sequences) && imagingStructuredData.missing_sequences.length > 0
                        ? `当前仍缺少序列：${imagingStructuredData.missing_sequences.join(" / ")}`
                        : "四序列已识别完成，正在等待模型生成空间结果。"}
                    </p>
                  </div>
                </div>
              ) : (
                <BrainSpatialReview 
                  key={activeEvidenceItem.evidence_id}
                  spatialInfo={(imagingStructuredData?.spatial_info ?? {}) as SpatialInfo}
                  slicePngPath={imagingStructuredData?.slice_png_path}
                  evidenceId={activeEvidenceItem.evidence_id}
                  caseId={caseId ?? ""}
                  status={imagingStructuredData?.status ?? ""}
                  threadId={caseData?.patient_thread_id}
                />
              )
            ) : (
              <ImagingViewer 
                 key={String(imagingStructuredData?.report_id ?? activeEvidenceItem.evidence_id)}
                 reportId={String(imagingStructuredData?.report_id ?? activeEvidenceItem.evidence_id)} 
                 threadId={caseData?.patient_thread_id}
                 imagePath={activeEvidenceItem.file_path ?? undefined} 
                  initialStructuredData={activeEvidenceItem.structured_data as Partial<McpAnalysisResult> | undefined} 
              />
            );
            })()}
          </>
        )}

        {(activeTabData?.type === "lab" || activeTabData?.type === "ecg" || activeTabData?.type === "note") && activeEvidenceItem && (
          <div className="animate-in fade-in duration-300 h-full flex-1 flex flex-col w-full bg-[#fdfbf7] overflow-y-auto">
             {(() => {
               const rawText = activeEvidenceItem.ai_analysis ?? "";
               const labStructuredData = activeEvidenceItem.structured_data as LabStructuredData | undefined;

               if (!rawText) {
                 return (
                   <div className="flex flex-col items-center justify-center flex-1 h-full text-slate-400 py-12">
                     <FileText className="h-12 w-12 mb-3 opacity-30" />
                     <p className="text-sm font-medium">暂无分析数据</p>
                     <p className="text-xs mt-1">上传文件后系统将自动进行提取识别</p>
                   </div>
                 );
               }

               return (
                 <LabMarkdownViewer 
                   rawText={rawText}
                   title={activeEvidenceItem.title}
                   isAbnormal={activeEvidenceItem.is_abnormal}
                   evidenceId={activeEvidenceItem.evidence_id}
                   caseId={caseId}
                   ocrRawNumbers={labStructuredData?.ocr_raw_numbers}
                   valueWarnings={labStructuredData?.value_warnings}
                   originalImageUrl={activeEvidenceItem.file_path ?? undefined}
                 />
               );
             })()}
          </div>
        )}
        </div>

        {/* ── P0: 内联诊断表单 (可折叠) ──────────────────── */}
        {showDiagnosisForm && !diagnosisSubmitted && (
          <div className="shrink-0 border-t-2 border-green-300 bg-gradient-to-b from-green-50/80 to-white px-8 py-6 z-10 animate-in slide-in-from-bottom-4 duration-300 shadow-[0_-8px_30px_rgba(0,0,0,0.06)]">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-green-100 rounded-lg text-green-700">
                  <ClipboardCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">提交诊断结论</h3>
                  <p className="text-xs text-slate-500">填写诊断后将正式完结本病例并通知患者</p>
                </div>
              </div>
              <button onClick={() => setShowDiagnosisForm(false)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                <ChevronDown className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* 主诊断 (必填) */}
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-slate-600 mb-1.5 block">主诊断 <span className="text-red-500">*</span></label>
                <Input
                  placeholder="例：右下肺社区获得性肺炎"
                  className="bg-white border-slate-200 focus:border-green-400 focus:ring-green-200"
                  value={diagnosisForm.primary_diagnosis}
                  onChange={(e) => setDiagnosisForm(prev => ({ ...prev, primary_diagnosis: e.target.value }))}
                />
              </div>
              {/* 次要诊断 */}
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-slate-600 mb-1.5 block">次要诊断 <span className="text-slate-400 font-normal">(用逗号分隔)</span></label>
                <Input
                  placeholder="例：高血压2级，2型糖尿病"
                  className="bg-white border-slate-200"
                  value={diagnosisForm.secondary_diagnoses}
                  onChange={(e) => setDiagnosisForm(prev => ({ ...prev, secondary_diagnoses: e.target.value }))}
                />
              </div>
              {/* 治疗方案 */}
              <div>
                <label className="text-xs font-bold text-slate-600 mb-1.5 block">治疗方案</label>
                <Textarea
                  placeholder="抗感染治疗 + 对症处理..."
                  className="bg-white border-slate-200 min-h-[70px] resize-none"
                  value={diagnosisForm.treatment_plan}
                  onChange={(e) => setDiagnosisForm(prev => ({ ...prev, treatment_plan: e.target.value }))}
                />
              </div>
              {/* 处方 */}
              <div>
                <label className="text-xs font-bold text-slate-600 mb-1.5 block">处方</label>
                <Textarea
                  placeholder="左氧氟沙星 0.5g qd..."
                  className="bg-white border-slate-200 min-h-[70px] resize-none"
                  value={diagnosisForm.prescription}
                  onChange={(e) => setDiagnosisForm(prev => ({ ...prev, prescription: e.target.value }))}
                />
              </div>
              {/* 随访建议 */}
              <div>
                <label className="text-xs font-bold text-slate-600 mb-1.5 block">随访建议</label>
                <Input
                  placeholder="1 周后复诊，复查血常规..."
                  className="bg-white border-slate-200"
                  value={diagnosisForm.follow_up}
                  onChange={(e) => setDiagnosisForm(prev => ({ ...prev, follow_up: e.target.value }))}
                />
              </div>
              {/* 医生备注 */}
              <div>
                <label className="text-xs font-bold text-slate-600 mb-1.5 block">医生备注</label>
                <Input
                  placeholder="补充说明..."
                  className="bg-white border-slate-200"
                  value={diagnosisForm.doctor_notes}
                  onChange={(e) => setDiagnosisForm(prev => ({ ...prev, doctor_notes: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-green-100">
              <Button variant="outline" onClick={() => setShowDiagnosisForm(false)} className="rounded-full px-6">
                取消
              </Button>
              <Button
                size="lg"
                onClick={() => {
                  void handleSubmitDiagnosis();
                }}
                disabled={isSubmitting || !diagnosisForm.primary_diagnosis.trim()}
                className="px-8 py-6 text-base rounded-full font-semibold bg-green-600 hover:bg-green-700 text-white shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5 gap-2 disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                {isSubmitting ? "提交中..." : "确认提交诊断"}
              </Button>
            </div>
          </div>
        )}

        {/* 诊断提交成功反馈 */}
        {diagnosisSubmitted && (
          <div className="h-20 shrink-0 border-t-2 border-green-400 bg-green-50 px-8 flex items-center justify-center gap-3 z-10 animate-in fade-in duration-300">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
            <span className="text-lg font-bold text-green-800">诊断已完成 — 正在返回队列...</span>
          </div>
        )}

        {/* 底部审核安全门 (Review Gate) — 诊断表单未展开时显示 */}
        {!showDiagnosisForm && !diagnosisSubmitted && (
        <div className="h-20 shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur px-8 flex items-center justify-between shadow-[0_-8px_30px_rgba(0,0,0,0.04)] z-10 sticky bottom-0">
           <div className="text-sm text-slate-500 flex flex-col">
              <span className="font-medium text-slate-800">人工审核进度</span>
              <span className="text-xs">已审核 {reviewedTabs.size} / {ALL_TABS.length} 项</span>
           </div>
           <div className="flex items-center gap-3">
             <div className="flex items-center gap-1">
               {ALL_TABS.map(t => (
                 <div key={t.id} className={cn("w-2 h-2 rounded-full transition-colors", reviewedTabs.has(t.id) ? "bg-emerald-500" : "bg-slate-200")} />
               ))}
             </div>
             {/* 综合诊断按钮 */}
             {onSynthesisDiagnosis && (
               <div className="flex flex-col items-end gap-1.5">
                 <div className="text-right">
                   <div className={cn(
                     "text-xs font-medium",
                     summaryReadiness?.ready_for_synthesis ? "text-emerald-600" : "text-amber-700",
                   )}>
                     {summaryReadiness?.ready_for_synthesis ? "病例资料已齐，可进行综合诊断" : (summaryReadiness?.status_text ?? "正在检查病例资料完整性")}
                   </div>
                   {!summaryReadiness?.ready_for_synthesis && summaryReadiness?.next_action ? (
                     <div className="mt-0.5 max-w-xs text-[11px] leading-5 text-slate-500">
                       {summaryReadiness.next_action}
                     </div>
                   ) : null}
                 </div>
                 <Button
                   size="lg"
                   onClick={() => {
                     handleSynthesisDiagnosis();
                   }}
                   disabled={isSynthesizing || !caseId || !summaryReadiness?.ready_for_synthesis}
                   className={cn(
                     "px-6 py-6 text-base rounded-full font-semibold text-white shadow-lg transition-all gap-2",
                     summaryReadiness?.ready_for_synthesis
                       ? "bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 hover:shadow-xl hover:-translate-y-0.5"
                       : "bg-slate-300 text-slate-500 shadow-none hover:bg-slate-300",
                   )}
                 >
                   {isSynthesizing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                   {isSynthesizing ? "汇总中..." : summaryReadiness?.ready_for_synthesis ? "一键综合诊断" : "等待资料齐全"}
                 </Button>
               </div>
             )}
             <Button 
                size="lg"
                onClick={handleReviewPassClick}
                className={cn(
                  "px-8 py-6 text-lg tracking-wide rounded-full font-semibold transition-all shadow-md",
                  isReviewPassed
                    ? "bg-slate-200 text-slate-400 cursor-not-allowed hover:bg-slate-200" 
                    : allReviewed
                      ? "bg-green-600 text-white hover:bg-green-700 hover:shadow-lg hover:-translate-y-0.5"
                      : "bg-slate-300 text-slate-500 cursor-not-allowed hover:bg-slate-300"
                )}
                disabled={isReviewPassed || !allReviewed}
              >
               <ShieldCheck className="mr-2 h-5 w-5" />
               {isReviewPassed ? "证据链已锁定 (Locked)" : allReviewed ? "提交诊断结论" : `还有 ${ALL_TABS.length - reviewedTabs.size} 项未审核`}
              </Button>
           </div>
        </div>
        )}
      </div>
    </div>
  );
}
