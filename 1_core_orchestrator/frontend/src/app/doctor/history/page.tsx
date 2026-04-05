"use client";

import {
  Search,
  CheckCircle2,
  User,
  FileText,
  ImageIcon,
  Activity,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Inbox,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getBackendBaseURL } from "@/core/config";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────
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
  doctor_notes: string;
  diagnosed_at: string;
}

interface HistoryCaseItem {
  case_id: string;
  status: string;
  priority: string;
  patient_info: PatientInfo;
  evidence: EvidenceItem[];
  diagnosis?: DiagnosisInfo | null;
  created_at: string;
  updated_at: string;
}


// ── Helpers ────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const evidenceIcons: Record<string, React.ElementType> = {
  imaging: ImageIcon,
  lab: FileText,
  ecg: Activity,
  vitals: User,
  note: FileText,
};

// ── Component ──────────────────────────────────────────────
export default function DoctorHistoryPage() {
  const [cases, setCases] = useState<HistoryCaseItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Load diagnosed + closed cases from API
  useEffect(() => {
    const base = getBackendBaseURL();
    const load = async () => {
      try {
        const [diagRes, closedRes] = await Promise.all([
          fetch(`${base}/api/cases?status=diagnosed&limit=100`),
          fetch(`${base}/api/cases?status=closed&limit=100`),
        ]);
        const allCases: HistoryCaseItem[] = [];
        if (diagRes.ok) {
          const d = await diagRes.json();
          allCases.push(...(d.cases as HistoryCaseItem[]));
        }
        if (closedRes.ok) {
          const d = await closedRes.json();
          const ids = new Set(allCases.map((c) => c.case_id));
          for (const c of d.cases as HistoryCaseItem[]) {
            if (!ids.has(c.case_id)) allCases.push(c);
          }
        }
        setCases(allCases);
      } catch {
        console.info("[History] API unavailable");
      }
    };
    void load();
  }, []);

  const filteredCases = cases.filter(c => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (c.patient_info.name?.toLowerCase().includes(q) ?? false) ||
      (c.patient_info.chief_complaint?.toLowerCase().includes(q) ?? false) ||
      (c.diagnosis?.primary_diagnosis.toLowerCase().includes(q) ?? false) ||
      c.case_id.includes(q)
    );
  });

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-5xl mx-auto px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">历史病例库</h1>
            <p className="text-sm text-slate-500 mt-1">查阅已完成诊断的病例归档与诊断结论</p>
          </div>
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            {cases.length} 条记录
          </Badge>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="搜索 (姓名 / 主诉 / 诊断结论)..."
            className="pl-11 h-11 text-sm bg-white border-slate-200 rounded-xl shadow-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Case List */}
        <div className="space-y-4">
          {filteredCases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <Inbox className="h-12 w-12 mb-3 opacity-50" />
              <p className="text-sm font-medium">暂无匹配的历史病例</p>
            </div>
          ) : (
            filteredCases.map(c => {
              const isExpanded = expandedId === c.case_id;

              return (
                <div
                  key={c.case_id}
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all hover:shadow-md"
                >
                  {/* Case Header (clickable to expand) */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : c.case_id)}
                    className="w-full text-left p-6 flex items-center gap-5"
                  >
                    {/* Patient avatar */}
                    <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center text-green-600 shrink-0 border-2 border-white shadow-sm ring-1 ring-slate-100">
                      <User className="h-5 w-5" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-base font-bold text-slate-800">{c.patient_info.name ?? "未登记"}</span>
                        <span className="text-xs text-slate-400">{c.patient_info.age}岁 · {c.patient_info.sex}</span>
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-[10px]">
                          <CheckCircle2 className="h-3 w-3 mr-0.5" />
                          {c.status === "closed" ? "已归档" : "已诊断"}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-600 truncate">{c.patient_info.chief_complaint ?? "未填写主诉"}</p>
                    </div>

                    {/* Diagnosis tag */}
                    <div className="text-right shrink-0">
                      {c.diagnosis && (
                        <div className="text-sm font-semibold text-green-700 mb-1">{c.diagnosis.primary_diagnosis}</div>
                      )}
                      <div className="text-[11px] text-slate-400">{formatDate(c.created_at)}</div>
                    </div>

                    {/* Expand icon */}
                    <div className="shrink-0 text-slate-400">
                      {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </div>
                  </button>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 px-6 pb-6 pt-4 bg-slate-50/50 animate-in slide-in-from-top-2 duration-200">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Evidence */}
                        <div>
                          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">证据材料 ({c.evidence.length})</h4>
                          <div className="space-y-2">
                            {c.evidence.map((ev, idx) => {
                              const EvIcon = evidenceIcons[ev.type] ?? FileText;
                              return (
                                <div key={idx} className={cn(
                                  "flex items-start gap-3 p-3 rounded-xl border",
                                  ev.is_abnormal ? "border-amber-200 bg-amber-50/50" : "border-slate-200 bg-white"
                                )}>
                                  <div className={cn("p-1.5 rounded-lg", ev.is_abnormal ? "bg-amber-100 text-amber-600" : "bg-slate-100 text-slate-500")}>
                                    <EvIcon className="h-4 w-4" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-semibold text-slate-800">{ev.title}</span>
                                      {ev.is_abnormal && (
                                        <AlertCircle className="h-3 w-3 text-amber-500" />
                                      )}
                                    </div>
                                    {ev.ai_analysis && (
                                      <p className="text-xs text-slate-500 mt-1">{ev.ai_analysis}</p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                      {/* Diagnosis */}
                        {c.diagnosis && (
                          <div>
                            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">诊断结论</h4>
                            <div className="bg-white border border-green-200 rounded-xl p-4 space-y-3">
                              <div>
                                <span className="text-xs text-slate-500">主诊断</span>
                                <p className="text-sm font-bold text-green-800">{c.diagnosis.primary_diagnosis}</p>
                              </div>
                              <div>
                                <span className="text-xs text-slate-500">治疗方案</span>
                                <p className="text-sm text-slate-700">{c.diagnosis.treatment_plan}</p>
                              </div>
                              <div>
                                <span className="text-xs text-slate-500">医生批注</span>
                                <p className="text-sm text-slate-600">{c.diagnosis.doctor_notes}</p>
                              </div>
                              <div className="pt-2 border-t border-green-100 text-[11px] text-slate-400">
                                诊断时间：{formatDate(c.diagnosis.diagnosed_at)}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 操作按钮区 */}
                      <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-slate-100">
                        <Link href={`/doctor/chat/${c.case_id}`}>
                          <Button variant="outline" size="sm" className="rounded-lg text-xs">
                            <ArrowRight className="h-3.5 w-3.5 mr-1.5" /> 查看详情
                          </Button>
                        </Link>
                        {c.status === "diagnosed" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-lg text-xs bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const res = await fetch(`${getBackendBaseURL()}/api/cases/${c.case_id}/status`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ status: "closed" }),
                                });
                                if (res.ok) {
                                  setCases(prev => prev.map(item =>
                                    item.case_id === c.case_id ? { ...item, status: "closed" } : item
                                  ));
                                }
                              } catch (err) {
                                console.error("Archive failed:", err);
                              }
                            }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> 归档
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
