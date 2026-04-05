"use client";

import {
  Clock,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Search,
  RefreshCw,
  User,
  ImageIcon,
  FileText,
  Activity,
  Inbox,
  Upload,
  Plus,
  Loader2,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getBackendBaseURL } from "@/core/config";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────
interface PatientInfo {
  name?: string | null;
  age?: number | null;
  sex?: string | null;
  phone?: string | null;
  chief_complaint?: string | null;
  present_illness?: string | null;
}

interface EvidenceItem {
  type: string;
  title: string;
  is_abnormal: boolean;
}

interface CaseItem {
  case_id: string;
  patient_thread_id: string;
  status: string;
  priority: string;
  patient_info: PatientInfo;
  evidence: EvidenceItem[];
  created_at: string;
  updated_at: string;
}

interface CaseCounts {
  total: number;
  pending: number;
  in_review: number;
  diagnosed: number;
  closed: number;
}

const EMPTY_COUNTS: CaseCounts = { total: 0, pending: 0, in_review: 0, diagnosed: 0, closed: 0 };

// ── Helpers ────────────────────────────────────────────────
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

const priorityConfig: Record<string, { label: string; color: string; dot: string }> = {
  critical: { label: "紧急", color: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
  high: { label: "高", color: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  medium: { label: "中", color: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  low: { label: "低", color: "bg-slate-50 text-slate-600 border-slate-200", dot: "bg-slate-400" },
};

const statusConfig: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  pending: { label: "待审", icon: Clock, color: "text-amber-600" },
  in_review: { label: "审阅中", icon: RefreshCw, color: "text-blue-600" },
  diagnosed: { label: "已诊断", icon: CheckCircle2, color: "text-green-600" },
  closed: { label: "已归档", icon: Inbox, color: "text-slate-400" },
};

const evidenceIcons: Record<string, React.ElementType> = {
  imaging: ImageIcon,
  lab: FileText,
  ecg: Activity,
  vitals: User,
  note: FileText,
};

// ── Component ──────────────────────────────────────────────
export default function DoctorQueuePage() {
  const router = useRouter();
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [counts, setCounts] = useState<CaseCounts>(EMPTY_COUNTS);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [selectedCase, setSelectedCase] = useState<CaseItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // ── New Case Dialog state ──
  const [isCreating, setIsCreating] = useState(false);

  // Fetch cases from API
  const loadCases = async () => {
    try {
      const res = await fetch(`${getBackendBaseURL()}/api/cases?limit=100`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCases(data.cases as CaseItem[]);
      setCounts(data.counts);
      // Auto-select first if nothing selected
      if (data.cases.length > 0) {
        setSelectedCase((prev) => prev ?? (data.cases[0] as CaseItem));
      }
    } catch {
      console.info("[Queue] API unavailable");
    }
  };

  // Filter cases
  const filteredCases = cases.filter(c => {
    if (activeFilter !== "all" && c.status !== activeFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        (c.patient_info.name?.toLowerCase().includes(q) ?? false) ||
        (c.patient_info.chief_complaint?.toLowerCase().includes(q) ?? false) ||
        c.case_id.includes(q)
      );
    }
    return true;
  });

  // Load cases on mount + SSE subscription for real-time updates
  useEffect(() => {
    void loadCases();

    // SSE subscription (best-effort, non-blocking)
    let cleanup: (() => void) | undefined;
    import("@/core/api/cases").then(({ subscribeToCaseEvents }) => {
      cleanup = subscribeToCaseEvents(
        (event) => {
          // Refresh the case list on any relevant event
          if (["new_case", "status_change", "new_evidence", "diagnosed"].includes(event.type)) {
            void loadCases();
          }
        },
        () => undefined,
      );
    }).catch(() => undefined);

    return () => cleanup?.();
  }, []);

  const handleAcceptCase = async (caseItem: CaseItem) => {
    // Update status to in_review via API
    try {
      await fetch(`${getBackendBaseURL()}/api/cases/${caseItem.case_id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in_review" }),
      });
    } catch { /* best-effort */ }
    router.push(`/doctor/chat/${caseItem.case_id}`);
  };

  const uploadRef = React.useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);

  // Doctor-side upload handler: uploads file to a selected case's thread
  const handleDoctorUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedCase) return;
    await uploadFiles(files);
  };

  const uploadFiles = async (files: FileList | File[]) => {
    if (!selectedCase) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      for (const file of Array.from(files)) {
        formData.append("files", file);
      }
      // Use the case's thread_id (patient_thread_id) for the uploads API
      const threadId = selectedCase.patient_thread_id ?? selectedCase.case_id;
      const res = await fetch(
        `${getBackendBaseURL()}/api/threads/${threadId}/uploads`,
        { method: "POST", body: formData }
      );
      if (res.ok) {
        void loadCases(); // Refresh to pick up new evidence
      }
    } catch (err) {
      console.error("[DoctorUpload] Failed:", err);
    } finally {
      setIsUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  // ── Drag & Drop Handlers ─────────────────────────────
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      void uploadFiles(e.dataTransfer.files);
    }
  };

  // ── Create new case handler ──
  const handleQuickCreateCase = async () => {
    setIsCreating(true);
    try {
      const res = await fetch(`${getBackendBaseURL()}/api/cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priority: "medium",
          patient_info: {
            name: "新增病患",
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        
        // 自动将状态设为接诊 (in_review)
        await fetch(`${getBackendBaseURL()}/api/cases/${data.case_id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "in_review" })
        });
        
        toast.success("病例创建成功，正在跳转填写页面...");
        router.push(`/doctor/chat/${data.case_id}`);
      }
    } catch (err) {
      console.error("[QuickCreateCase] Failed:", err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteCase = async (caseId: string) => {
    if (!window.confirm("确定要永久删除此病例及所有相关数据吗？这是一项不可逆操作。")) return;
    try {
      const res = await fetch(`${getBackendBaseURL()}/api/cases/${caseId}`, { method: "DELETE" });
      if (res.ok) {
        if (selectedCase?.case_id === caseId) {
          setSelectedCase(null);
        }
        await loadCases();
      } else {
        alert("删除失败，请稍后重试");
      }
    } catch (err) {
      console.error("[DeleteCase] Failed:", err);
      alert("删除失败，请检查网络连接");
    }
  };

  const filterButtons = [
    { key: "all", label: "全部", count: counts.total },
    { key: "pending", label: "待审", count: counts.pending, dot: "bg-amber-500" },
    { key: "in_review", label: "审阅中", count: counts.in_review, dot: "bg-blue-500" },
    { key: "diagnosed", label: "已诊断", count: counts.diagnosed, dot: "bg-green-500" },
  ];

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-slate-50">
      {/* Left Panel: Case List */}
      <div className="w-[420px] xl:w-[480px] shrink-0 border-r border-slate-200 bg-white flex flex-col">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">候诊队列</h1>
            <div className="flex items-center gap-2">
              {/* 新建病例 */}
              <Button
                variant="default"
                size="sm"
                className="h-7 gap-1.5 text-xs bg-blue-600 hover:bg-blue-700"
                onClick={handleQuickCreateCase}
                disabled={isCreating}
              >
                {isCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                新建病例
              </Button>
              {/* [ADR-021] 医生端上传按钮 */}
              <input
                ref={uploadRef}
                type="file"
                className="hidden"
                accept="image/*,.pdf,.dcm"
                multiple
                onChange={handleDoctorUpload}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                disabled={!selectedCase || isUploading}
                onClick={() => uploadRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                {isUploading ? "上传中..." : "上传文件"}
              </Button>
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                {counts.pending} 待审
              </Badge>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="搜索病例 (主诉 / 编号)..."
              className="pl-9 h-9 text-sm bg-slate-50 border-slate-200"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-2">
            {filterButtons.map(f => (
              <button
                key={f.key}
                onClick={() => setActiveFilter(f.key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
                  activeFilter === f.key
                    ? "bg-slate-800 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                {f.dot && <span className={cn("w-1.5 h-1.5 rounded-full", f.dot)} />}
                {f.label}
                <span className={cn(
                  "text-[10px] font-bold ml-0.5",
                  activeFilter === f.key ? "text-slate-300" : "text-slate-400"
                )}>
                  {f.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Case Cards List */}
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {filteredCases.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Inbox className="h-12 w-12 mb-3 opacity-50" />
                <p className="text-sm font-medium">暂无匹配的病例</p>
              </div>
            ) : (
              filteredCases.map(c => {
                const prio = priorityConfig[c.priority] ?? { label: "中", color: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" };
                const stat = statusConfig[c.status] ?? { label: "待审", icon: Clock, color: "text-amber-600" };
                const isSelected = selectedCase?.case_id === c.case_id;
                const StatIcon = stat.icon;
                const abnormalCount = c.evidence.filter(e => e.is_abnormal).length;

                return (
                  <button
                    key={c.case_id}
                    onClick={() => setSelectedCase(c)}
                    className={cn(
                      "w-full text-left p-4 rounded-xl border transition-all duration-200",
                      isSelected
                        ? "bg-blue-50/70 border-blue-200 shadow-sm ring-1 ring-blue-100"
                        : "bg-white border-slate-100 hover:border-slate-200 hover:shadow-sm"
                    )}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", prio.color)}>
                          <span className={cn("w-1.5 h-1.5 rounded-full mr-1", prio.dot)} />
                          {prio.label}
                        </Badge>
                        <span className="text-[11px] text-slate-400 font-mono">{c.case_id.slice(0, 8)}</span>
                      </div>
                      <div className={cn("flex items-center gap-1 text-[11px] font-medium", stat.color)}>
                        <StatIcon className="h-3 w-3" />
                        {stat.label}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-bold text-slate-900">{c.patient_info.name ?? "未登记"}</span>
                      <span className="text-[11px] text-slate-400">·</span>
                      <span className="text-xs text-slate-500">{c.patient_info.chief_complaint ?? "主诉未填写"}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 text-[11px] text-slate-500">
                        <span>{c.patient_info.age ?? "?"}岁 {c.patient_info.sex ?? ""}</span>
                        <span>·</span>
                        <span>{c.evidence.length} 项证据</span>
                        {abnormalCount > 0 && (
                          <span className="text-red-500 font-semibold flex items-center gap-0.5">
                            <AlertCircle className="h-3 w-3" />{abnormalCount} 异常
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400">{timeAgo(c.created_at)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right Panel: Case Preview */}
      <div 
        className={cn("flex-1 min-w-0 flex flex-col bg-slate-50 relative", isDragging ? "ring-4 ring-inset ring-blue-400" : "")}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* 拖拽上传遮罩 */}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-blue-50/80 backdrop-blur-sm pointer-events-none">
            <div className="flex flex-col items-center justify-center p-12 bg-white rounded-2xl shadow-xl border-2 border-dashed border-blue-400">
              <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6 text-blue-500">
                <Plus className="h-10 w-10 text-blue-500" />
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">松开鼠标上传附件</h3>
              <p className="text-slate-500">直接补充该患者的病程图片或数据文件</p>
            </div>
          </div>
        )}

        {selectedCase ? (
          <>
            {/* Preview Header */}
            <div className="px-8 py-6 bg-white border-b border-slate-200 shadow-[0_4px_12px_rgba(0,0,0,0.02)]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800 tracking-tight">
                    患者概要
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Case ID: <span className="font-mono">{selectedCase.case_id}</span>
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">
                    Thread (沙盒): {selectedCase.patient_thread_id}
                  </p>
                </div>
                <div className="flex gap-3 items-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteCase(selectedCase.case_id)}
                    className="text-slate-400 hover:text-red-600 hover:bg-red-50 mr-2"
                    title="删除病例"
                  >
                    <Trash2 className="h-5 w-5" />
                  </Button>
                  {selectedCase.status === "pending" && (
                    <Button
                      size="lg"
                      onClick={() => handleAcceptCase(selectedCase)}
                      className="bg-blue-600 hover:bg-blue-700 text-white rounded-full px-8 shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5"
                    >
                      接诊 (Accept) <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  )}
                  {selectedCase.status === "in_review" && (
                    <Button
                      size="lg"
                      onClick={() => handleAcceptCase(selectedCase)}
                      className="bg-green-600 hover:bg-green-700 text-white rounded-full px-8 shadow-md"
                    >
                      继续审阅 <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Patient Quick Profile */}
              <div className="flex items-center gap-6">
                <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 border-2 border-white shadow-sm ring-1 ring-slate-100 shrink-0">
                  <User className="h-6 w-6" />
                </div>
                <div className="flex gap-6">
                  <div>
                    <div className="text-xs text-slate-500 mb-0.5">姓名</div>
                    <div className="text-lg font-bold text-slate-800">
                      {selectedCase.patient_info.name ?? "未登记"}
                    </div>
                  </div>
                  <div className="border-l border-slate-200 pl-6">
                    <div className="text-xs text-slate-500 mb-0.5">年龄/性别</div>
                    <div className="text-lg font-bold text-slate-800">
                      {selectedCase.patient_info.age ?? "?"}岁 {selectedCase.patient_info.sex ?? ""}
                    </div>
                  </div>
                  <div className="border-l border-slate-200 pl-6">
                    <div className="text-xs text-slate-500 mb-0.5">主诉</div>
                    <div className="text-sm font-semibold text-slate-700 max-w-md">
                      {selectedCase.patient_info.chief_complaint ?? "未填写"}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Evidence Summary */}
            <div className="flex-1 overflow-y-auto p-8">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4">
                证据清单 ({selectedCase.evidence.length} 项)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectedCase.evidence.map((ev, idx) => {
                  const EvIcon = evidenceIcons[ev.type] ?? FileText;
                  return (
                    <div
                      key={idx}
                      className={cn(
                        "flex items-center gap-4 p-4 rounded-xl border bg-white transition-all hover:shadow-sm",
                        ev.is_abnormal
                          ? "border-red-200 bg-red-50/30"
                          : "border-slate-200"
                      )}
                    >
                      <div className={cn(
                        "p-2.5 rounded-lg shrink-0",
                        ev.is_abnormal ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-500"
                      )}>
                        <EvIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{ev.title}</p>
                        <p className="text-xs text-slate-500 capitalize">{ev.type}</p>
                      </div>
                      {ev.is_abnormal && (
                        <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200 text-[10px] shrink-0">
                          异常
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* AI Summary placeholder */}
              <div className="mt-8 p-6 rounded-xl border border-dashed border-blue-200 bg-blue-50/30">
                <h4 className="text-sm font-bold text-blue-700 mb-2 flex items-center gap-2">
                  <Activity className="h-4 w-4" /> AI 初筛摘要
                </h4>
                <p className="text-sm text-blue-600/80 leading-relaxed">
                  基于患者上传的 {selectedCase.evidence.length} 项证据，AI 已完成初步分析。
                  {selectedCase.evidence.some(e => e.is_abnormal)
                    ? "检出异常指标，建议优先审阅高亮证据项。"
                    : "各项指标暂未发现明显异常。"
                  }
                  请点击「接诊」进入 Evidence Desk 进行详细审阅。
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <Inbox className="h-16 w-16 mb-4 opacity-30" />
            <p className="text-lg font-medium text-slate-500">从左侧选择一个病例</p>
            <p className="text-sm mt-1">查看患者详情与证据摘要</p>
          </div>
        )}
      </div>

    </div>
  );
}
