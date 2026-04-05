"use client";

import {
  ArrowLeft,
  Clock,
  Search as SearchIcon,
  CheckCircle2,
  FileCheck,
  Loader2,
  User,
  FileText,
  ImageIcon,
  Activity,
  AlertCircle,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { useEffect, useState, useCallback } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { subscribeToCaseEvents } from "@/core/api/cases";
import { getBackendBaseURL } from "@/core/config";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────
interface PatientInfo {
  name?: string | null;
  age?: number | null;
  sex?: string | null;
  chief_complaint?: string | null;
}

interface EvidenceItem {
  type: string;
  title: string;
  is_abnormal: boolean;
  ai_analysis?: string | null;
}

interface DiagnosisInfo {
  primary_diagnosis: string;
  treatment_plan: string;
  prescription?: string | null;
  follow_up?: string | null;
  doctor_notes?: string;
}

interface CaseData {
  case_id: string;
  patient_thread_id?: string;
  status: string;
  priority: string;
  patient_info: PatientInfo;
  evidence: EvidenceItem[];
  diagnosis: DiagnosisInfo | null;
  created_at: string;
  updated_at: string;
}

// ── Status timeline steps ────────────────────────────
const timelineSteps = [
  { key: "pending", label: "已提交", desc: "您的问诊信息已提交至系统", icon: FileCheck },
  { key: "in_review", label: "医生审阅中", desc: "医生正在审阅您的证据材料", icon: SearchIcon },
  { key: "diagnosed", label: "已出诊断", desc: "医生已完成诊断并给出结论", icon: CheckCircle2 },
  { key: "closed", label: "已归档", desc: "本次问诊已完成归档", icon: FileCheck },
];

const statusOrder = ["pending", "in_review", "diagnosed", "closed"];

const evidenceIcons: Record<string, React.ElementType> = {
  imaging: ImageIcon,
  lab: FileText,
  ecg: Activity,
  vitals: User,
  note: FileText,
};

// 内部组件（使用了 useSearchParams，必须被 Suspense 包裹）
function PatientStatusContent() {
  const searchParams = useSearchParams();
  const threadId = searchParams.get("thread_id");

  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── 历史列表模式（无 thread_id 时） ──────────────
  const [allCases, setAllCases] = useState<CaseData[]>([]);
  const isListMode = !threadId;

  // 加载单个 Case（有 thread_id 时）
  const loadCase = useCallback(async () => {
    if (!threadId) return;
    try {
      const res = await fetch(`${getBackendBaseURL()}/api/cases/by-thread/${threadId}`);
      if (res.status === 404) {
        setError("暂未找到您的问诊记录，请先完成挂号。");
        setIsLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: CaseData = await res.json();
      setCaseData(data);
      setError(null);
    } catch (e: unknown) {
      console.error("[StatusPage] Failed to load case:", e);
      setError("加载失败，请稍后再试。");
    } finally {
      setIsLoading(false);
    }
  }, [threadId]);

  // 加载全部 Case 列表（无 thread_id 时）
  const loadAllCases = useCallback(async () => {
    try {
      const res = await fetch(`${getBackendBaseURL()}/api/cases`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAllCases(Array.isArray(data?.cases) ? data.cases : Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      console.error("[StatusPage] Failed to load cases list:", e);
      setError("加载失败，请稍后再试。");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 初次加载 + SSE 实时订阅
  useEffect(() => {
    if (isListMode) {
      void loadAllCases();
    } else {
      void loadCase();
    }

    const cleanup = subscribeToCaseEvents(
      (event) => {
        if (["diagnosed", "status_change"].includes(event.type)) {
          if (isListMode) void loadAllCases();
          else void loadCase();
        }
      },
      () => undefined,
    );

    const pollInterval = isListMode ? undefined : setInterval(() => {
      void loadCase();
    }, 10000);

    return () => {
      cleanup();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [isListMode, loadCase, loadAllCases]);

  const currentStepIdx = caseData ? statusOrder.indexOf(caseData.status) : -1;

  // ── Loading State ──────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
          <p className="text-sm text-slate-500 font-medium">正在加载...</p>
        </div>
      </div>
    );
  }

  // ── Error State ────────────────────────────────────
  if (!isListMode && (error || !caseData)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <AlertCircle className="h-12 w-12 text-slate-300" />
          <p className="text-base text-slate-600 font-medium">{error ?? "暂无问诊记录"}</p>
          <Link href="/workspace">
            <Button variant="outline" className="rounded-full">
              <MessageSquare className="h-4 w-4 mr-2" /> 返回对话
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── 列表模式 (无 thread_id) ────────────────────────
  if (isListMode) {
    const statusLabel: Record<string, { text: string; cls: string }> = {
      pending: { text: "等待接诊", cls: "bg-amber-50 text-amber-700 border-amber-200" },
      in_review: { text: "审阅中", cls: "bg-blue-50 text-blue-700 border-blue-200" },
      diagnosed: { text: "已出诊断", cls: "bg-green-50 text-green-700 border-green-200" },
      closed: { text: "已归档", cls: "bg-slate-50 text-slate-600 border-slate-200" },
    };

    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
          <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/workspace" className="p-2 -ml-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors">
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 font-bold text-white shadow-sm text-sm">M</div>
              <span className="text-lg font-semibold tracking-tight text-slate-800">我的问诊记录</span>
            </div>
            <button onClick={() => { void loadAllCases(); }} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors" title="刷新">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-6 py-10">
          {allCases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <AlertCircle className="h-12 w-12 text-slate-300 mb-4" />
              <p className="text-base text-slate-600 font-medium mb-2">暂无问诊记录</p>
              <p className="text-sm text-slate-500 mb-6">完成 AI 问诊并确认挂号后，您的记录将显示在这里。</p>
              <Link href="/workspace">
                <Button variant="outline" className="rounded-full">
                  <MessageSquare className="h-4 w-4 mr-2" /> 开始问诊
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {allCases.map((c) => {
                const sl = statusLabel[c.status] ?? { text: c.status, cls: "bg-slate-50 text-slate-600 border-slate-200" };
                return (
                  <Link
                    key={c.case_id}
                    href={`/workspace/status?thread_id=${c.patient_thread_id ?? c.case_id}`}
                    className="block bg-white rounded-2xl border border-slate-200 shadow-sm p-6 hover:shadow-md hover:border-blue-200 transition-all group"
                  >
                    <div className="flex items-center gap-5">
                      <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0 border-2 border-white shadow-sm ring-1 ring-slate-100">
                        <User className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-base font-bold text-slate-800">{c.patient_info.name ?? "未登记"}</span>
                          <Badge variant="outline" className={`text-[10px] ${sl.cls}`}>{sl.text}</Badge>
                        </div>
                        <p className="text-sm text-slate-600 truncate">{c.patient_info.chief_complaint ?? "未填写主诉"}</p>
                      </div>
                      <div className="text-right shrink-0">
                        {c.diagnosis && (
                          <div className="text-sm font-semibold text-green-700 mb-1">{c.diagnosis.primary_diagnosis}</div>
                        )}
                        <div className="text-[11px] text-slate-400">{new Date(c.created_at).toLocaleDateString("zh-CN")}</div>
                      </div>
                      <ArrowLeft className="h-4 w-4 text-slate-300 rotate-180 group-hover:text-blue-500 transition-colors shrink-0" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
          <div className="mt-12 text-center text-xs text-slate-400">
            <p>&copy; 2026 MedAgent Copilot</p>
          </div>
        </main>
      </div>
    );
  }

  // ── Main Render（此处 caseData 已被前面的 guard 保证非 null）──
  const cd = caseData!;
  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/workspace" className="p-2 -ml-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 font-bold text-white shadow-sm text-sm">
              M
            </div>
            <span className="text-lg font-semibold tracking-tight text-slate-800">
              诊断进度查询
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { void loadCase(); }} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors" title="刷新">
              <RefreshCw className="h-4 w-4" />
            </button>
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
              Case: {cd.case_id.slice(0, 8)}
            </Badge>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {/* Patient Summary Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 mb-10">
          <div className="flex items-center gap-5">
            <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 border-2 border-white shadow-md ring-1 ring-slate-100 shrink-0">
              <User className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-2xl font-bold text-slate-800">{cd.patient_info.name}</h2>
                <Badge variant="outline" className={cn(
                  "text-xs",
                  cd.priority === "critical" ? "bg-red-50 text-red-700 border-red-200" :
                  cd.priority === "high" ? "bg-amber-50 text-amber-700 border-amber-200" :
                  "bg-blue-50 text-blue-700 border-blue-200"
                )}>
                  {cd.priority === "critical" ? "紧急" : cd.priority === "high" ? "高优先" : "普通"}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-sm text-slate-500">
                <span>{cd.patient_info.age}岁 · {cd.patient_info.sex}</span>
                <span className="text-slate-300">|</span>
                <span className="text-slate-700 font-medium">{cd.patient_info.chief_complaint}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Status Timeline */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 mb-10">
          <h3 className="text-lg font-bold text-slate-800 mb-8 flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-600" /> 诊断进度
          </h3>

          <div className="relative">
            {timelineSteps.map((step, idx) => {
              const isCompleted = idx <= currentStepIdx;
              const isCurrent = idx === currentStepIdx;
              const StepIcon = step.icon;

              return (
                <div key={step.key} className="flex items-start gap-5 mb-8 last:mb-0 relative">
                  {/* Vertical connector line */}
                  {idx < timelineSteps.length - 1 && (
                    <div className={cn(
                      "absolute left-[19px] top-10 w-0.5 h-[calc(100%-8px)]",
                      idx < currentStepIdx ? "bg-blue-400" : "bg-slate-200"
                    )} />
                  )}

                  {/* Icon circle */}
                  <div className={cn(
                    "relative z-10 flex items-center justify-center h-10 w-10 rounded-full border-2 shrink-0 transition-all",
                    isCurrent
                      ? "bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200"
                      : isCompleted
                        ? "bg-blue-100 border-blue-300 text-blue-600"
                        : "bg-slate-50 border-slate-200 text-slate-400"
                  )}>
                    {isCurrent && cd.status === "in_review" ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <StepIcon className="h-5 w-5" />
                    )}
                  </div>

                  {/* Label */}
                  <div className="pt-1.5">
                    <div className={cn(
                      "text-sm font-bold",
                      isCurrent ? "text-blue-700" : isCompleted ? "text-slate-800" : "text-slate-400"
                    )}>
                      {step.label}
                      {isCurrent && (
                        <Badge className="ml-2 bg-blue-100 text-blue-700 border-0 text-[10px] font-bold">
                          当前
                        </Badge>
                      )}
                    </div>
                    <p className={cn(
                      "text-xs mt-0.5",
                      isCurrent ? "text-blue-500" : isCompleted ? "text-slate-500" : "text-slate-400"
                    )}>
                      {step.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Evidence List */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 mb-10">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" /> 已提交的证据材料 ({cd.evidence.length})
          </h3>
          <div className="space-y-4">
            {cd.evidence.map((ev, idx) => {
              const EvIcon = evidenceIcons[ev.type] ?? FileText;
              return (
                <div
                  key={idx}
                  className={cn(
                    "flex items-start gap-4 p-5 rounded-xl border transition-all",
                    ev.is_abnormal
                      ? "border-amber-200 bg-amber-50/30"
                      : "border-slate-200 bg-slate-50/30"
                  )}
                >
                  <div className={cn(
                    "p-2.5 rounded-lg shrink-0 mt-0.5",
                    ev.is_abnormal ? "bg-amber-100 text-amber-600" : "bg-slate-100 text-slate-500"
                  )}>
                    <EvIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-bold text-slate-800">{ev.title}</p>
                      {ev.is_abnormal && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 text-[10px]">
                          <AlertCircle className="h-3 w-3 mr-0.5" /> 需关注
                        </Badge>
                      )}
                    </div>
                    {ev.ai_analysis && (
                      <p className="text-xs text-slate-600 leading-relaxed mt-1.5 bg-white rounded-lg px-3 py-2 border border-slate-100">
                        <span className="text-blue-600 font-bold mr-1">AI 初筛：</span>
                        {ev.ai_analysis}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Diagnosis Result (shown only when diagnosed) */}
        {cd.status === "diagnosed" && cd.diagnosis && (
          <div className="bg-green-50 rounded-2xl border border-green-200 shadow-sm p-8 mb-10">
            <h3 className="text-lg font-bold text-green-800 mb-4 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" /> 医生诊断结论
            </h3>
            <div className="space-y-4 text-sm text-green-900">
              <div>
                <span className="font-bold">诊断：</span>
                {cd.diagnosis.primary_diagnosis}
              </div>
              <div>
                <span className="font-bold">治疗方案：</span>
                {cd.diagnosis.treatment_plan}
              </div>
              {cd.diagnosis.prescription && (
                <div>
                  <span className="font-bold">处方：</span>
                  {cd.diagnosis.prescription}
                </div>
              )}
              {cd.diagnosis.follow_up && (
                <div>
                  <span className="font-bold">随访建议：</span>
                  {cd.diagnosis.follow_up}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Waiting state hint */}
        {(cd.status === "pending" || cd.status === "in_review") && (
          <div className="bg-blue-50/50 rounded-2xl border border-dashed border-blue-200 p-8 text-center">
            <Loader2 className="h-8 w-8 text-blue-400 mx-auto mb-4 animate-spin" />
            <h4 className="text-base font-bold text-blue-700 mb-2">
              {cd.status === "pending" ? "等待医生接诊..." : "医生正在审阅您的材料..."}
            </h4>
            <p className="text-sm text-blue-500 max-w-md mx-auto leading-relaxed">
              您的问诊材料已安全送达。系统将在医生完成诊断后自动更新此页面，您也可以随时刷新查看最新进度。
            </p>
            <div className="mt-6 flex items-center justify-center gap-4">
              <Link href="/workspace">
                <Button variant="outline" className="rounded-full border-blue-200 text-blue-600 hover:bg-blue-100">
                  <MessageSquare className="h-4 w-4 mr-2" /> 返回对话
                </Button>
              </Link>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center text-xs text-slate-400">
          <p>以上 AI 分析仅供参考，最终诊断请以医生结论为准。</p>
          <p className="mt-1">&copy; 2026 MedAgent Copilot</p>
        </div>
      </main>
    </div>
  );
}

// ── 导出：用 Suspense 包裹以满足 Next.js 15 对 useSearchParams 的要求 ──
export default function PatientStatusPage() {
  return (
    <React.Suspense fallback={
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
          <p className="text-sm text-slate-500 font-medium">正在加载...</p>
        </div>
      </div>
    }>
      <PatientStatusContent />
    </React.Suspense>
  );
}
