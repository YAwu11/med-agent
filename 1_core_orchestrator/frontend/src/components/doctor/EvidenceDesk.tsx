"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ShieldCheck, User, Image as ImageIcon, FileText, Activity, Loader2, CheckCircle2, Circle, Plus, Sparkles, Trash2, Pencil, Eye, Columns2, AlignJustify, ChevronDown, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fetchCase, type CaseData } from "@/core/api/cases";
import { ImagingViewer } from "@/components/doctor/ImagingViewer";
import { Streamdown } from "streamdown";
import { streamdownPlugins } from "@/core/streamdown";
import { LabMarkdownViewer } from "@/components/doctor/LabMarkdownViewer";
import { toast } from "sonner";

interface EvidenceDeskProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isReviewPassed: boolean;
  onReviewPass: () => void;
  caseId?: string | null;
  onSynthesisDiagnosis?: (summaryText: string) => void;
}

export function EvidenceDesk({ activeTab, onTabChange, isReviewPassed, onReviewPass, caseId, onSynthesisDiagnosis }: EvidenceDeskProps) {
  const router = useRouter();
  
  // ── API Data State ──────────────────────────────────
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // ── Local Edit State for Patient Info (Gap) ──────────
  const [localInfo, setLocalInfo] = useState<any>({});

  useEffect(() => {
    if (!caseId) return;
    setIsLoading(true);
    fetchCase(caseId)
      .then((data) => {
        setCaseData(data);
        if (data?.patient_info) {
          setLocalInfo(data.patient_info);
        }
        // Auto-select first evidence tab if available
        if (data.evidence.length > 0) {
          onTabChange("vitals"); // Default to vitals overview
        }
      })
      .finally(() => setIsLoading(false));

    // Basic polling mechanism to keep evidence in sync, especially for patient uploads or async backend ops
    const pollInterval = setInterval(() => {
      fetchCase(caseId)
        .then((data) => {
          setCaseData(data);
          // ⚠️ Note: We do NOT overwrite localInfo here to avoid destroying doctor's active form context
        })
        .catch((err) => {
          console.warn("[EvidenceDesk] Polling failed:", err);
        });
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [caseId]);

  // Derive display values from API data or mock defaults
  const patientName = caseData?.patient_info?.name ?? "张建国";
  const patientAge = caseData?.patient_info?.age ?? 58;
  const patientSex = caseData?.patient_info?.sex ?? "男";
  const evidenceItems = caseData?.evidence ?? [];

  // Create dynamic ALL_TABS from evidence Items
  const ALL_TABS: { id: string, label: string, type: string, item?: any }[] = [
    { id: "vitals", label: "基础体征与历史", type: "vitals" }
  ];
  evidenceItems.forEach((ev: any, i: number) => {
    ALL_TABS.push({
      id: `ev_${ev.evidence_id || i}`,
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
  const [isSynthesizing, setIsSynthesizing] = useState(false);
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

  // [Gap④] 综合诊断：拉取聚合摘要 → 注入 AI Chat
  const handleSynthesisDiagnosis = async () => {
    if (!caseId || !onSynthesisDiagnosis) return;
    setIsSynthesizing(true);
    try {
      const { getBackendBaseURL } = await import("@/core/config");
      const res = await fetch(`${getBackendBaseURL()}/api/cases/${caseId}/summary`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      const prompt = `请基于以下患者完整病历资料进行综合诊断分析，给出你的诊断意见、鉴别诊断、建议的进一步检查项目和初步治疗方案。\n\n---\n\n${data.summary}`;
      onSynthesisDiagnosis(prompt);
    } catch (err) {
      console.error("[Gap④] Failed to fetch case summary:", err);
    } finally {
      setIsSynthesizing(false);
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const targetThreadId = caseData?.patient_thread_id || caseId;
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
      const uploadData = await uploadRes.json();
      
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

  const handleSidebarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      uploadFiles(e.target.files);
    }
    // refresh input so same file can be uploaded again if needed
    e.target.value = "";
  };

  // ── Drag & Drop Handlers ─────────────────────────────
  // 核心防止闪烁方案：外层容器负责开启拖拽，开启后由全屏的全覆盖遮罩接管所有后续事件
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };
  
  // onDragOver 在外层只做默认拦截，具体 drop 和 leave 交给 overlay 处理
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  // ── Patient Info Update Handler ────────────────────────
  // To avoid race conditions and keystroke blocking, we use local state and a delayed patch.
  const syncTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  
  const updatePatientInfo = async (field: string, value: string | number) => {
    if (!caseId) return;
    
    // Optimistic update locally
    setLocalInfo((prev: any) => ({ ...prev, [field]: value }));

    // Debounce the PATCH to backend (500ms)
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(async () => {
      try {
        const { getBackendBaseURL } = await import("@/core/config");
        await fetch(`${getBackendBaseURL()}/api/cases/${caseId}/patient-info`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value })
        });
      } catch (e) {
        console.error("[Gap Update Patient Info] Failed:", e);
      }
    }, 500);
  };

  // ── Evidence Data Update Handler (HITL) ─────────────────
  const evidenceSyncTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const updateEvidenceData = async (evidenceId: string, newStructuredData: any[]) => {
    if (!caseId) return;

    // Optimistically update local caseData so the UI immediately reflects it
    // Note: OcrDocumentViewer already handles its local state safely, but we need 
    // caseData.evidence[i].structured_data to be updated so flipping tabs doesn't lose it.
    setCaseData((prev: any) => {
      if (!prev) return prev;
      const updatedEvidence = prev.evidence.map((ev: any) => 
        ev.evidence_id === evidenceId ? { ...ev, structured_data: newStructuredData } : ev
      );
      return { ...prev, evidence: updatedEvidence };
    });

    if (evidenceSyncTimeoutRef.current) clearTimeout(evidenceSyncTimeoutRef.current);
    evidenceSyncTimeoutRef.current = setTimeout(async () => {
      try {
        const { getBackendBaseURL } = await import("@/core/config");
        await fetch(`${getBackendBaseURL()}/api/cases/${caseId}/evidence/${evidenceId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ structured_data: newStructuredData })
        });
        console.log(`[HITL Sync] Evidence ${evidenceId} auto-saved`);
      } catch (e) {
        console.error("[HITL Sync] Failed to update evidence:", e);
      }
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
      setTimeout(() => router.push("/doctor/queue"), 1500);
    } catch (e) {
      console.error("Failed to submit diagnosis", e);
      toast.error("诊断提交失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const allReviewed = ALL_TABS.every(t => reviewedTabs.has(t.id));
  
  const activeTabData = ALL_TABS.find(t => t.id === activeTab);
  
  const handleDeleteEvidence = async (e: React.MouseEvent, evidenceId: string) => {
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
  const renderTab = (id: string, label: string, Icon: React.ElementType, isAlert = false, evidenceId?: string) => {
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
              uploadFiles(e.dataTransfer.files);
            }
          }}
        >
          {/* pointer-events-none 确保鼠标在内部文本上方游走时不触发 leave 事件 */}
          <div className="flex flex-col items-center justify-center p-12 bg-white/90 rounded-2xl shadow-2xl border-2 border-dashed border-blue-500 scale-105 transition-transform duration-200 pointer-events-none">
            <div className="w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center mb-6 animate-bounce">
              <Plus className="h-12 w-12 text-blue-600" />
            </div>
            <h3 className="text-2xl font-bold text-slate-800 mb-3 tracking-tight">松开鼠标上传作为证据</h3>
            <p className="text-slate-500 font-medium">支持拖入图片、PDF及电子病历文件</p>
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
          <input
            type="file"
            id="sidebarFileSelect"
            className="hidden"
            multiple
            onChange={handleSidebarUpload}
          />
          <Button 
            variant="outline" 
            className="w-full justify-center gap-2 bg-white backdrop-blur border-blue-200 text-blue-600 hover:bg-blue-50 transition-all shadow-sm rounded-xl py-6"
            onClick={() => document.getElementById('sidebarFileSelect')?.click()}
            disabled={isUploadingEvidence}
          >
            <span className="inline-flex h-4 w-4 items-center justify-center">
              {isUploadingEvidence ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </span>
            <span>{isUploadingEvidence ? "上传中..." : "补充医疗附件"}</span>
          </Button>
        </div>
      </div>

      {/* 75% 右侧主视图 - 证据查看器与提交流程 (Detail View) */}
      <div className="flex-1 min-w-0 flex flex-col relative bg-slate-50/50">
        
        {/* 中心视野区 (Content Viewer) */}
        <div className="flex-1 overflow-y-auto relative">
        
        {activeTab === "vitals" && (
          <div className="animate-in fade-in duration-300 flex flex-col h-full p-8 max-w-7xl mx-auto w-full">
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
                
                <div className="flex items-center gap-4 mb-8">
                  <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 border-[3px] border-white shadow-md ring-1 ring-slate-100 shrink-0">
                     <User className="h-7 w-7" />
                  </div>
                  <div className="flex flex-col">
                    <Input 
                      className="p-0 h-auto border-none shadow-none text-xl font-bold tracking-tight text-slate-800 focus-visible:ring-0 placeholder:text-slate-300 placeholder:font-normal bg-transparent"
                      value={localInfo?.name ?? ""}
                      onChange={(e) => updatePatientInfo("name", e.target.value)}
                      placeholder="姓名未登记"
                    />
                    <div className="flex items-center gap-1 text-sm text-slate-500 font-medium mt-0.5">
                      <Input 
                        className="w-12 h-5 p-0 border-none shadow-none focus-visible:ring-0 bg-transparent text-center"
                        value={localInfo?.age ?? ""}
                        onChange={(e) => updatePatientInfo("age", e.target.value ? parseInt(e.target.value) : "")}
                        placeholder="--"
                      />
                      岁 · 
                      <select 
                        className="bg-transparent border-none focus:ring-0 text-slate-500 p-0 text-sm cursor-pointer"
                        value={localInfo?.sex ?? ""}
                        onChange={(e) => updatePatientInfo("sex", e.target.value)}
                      >
                        <option value="男">男性</option>
                        <option value="女">女性</option>
                        <option value="">未知</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                       <span className="bg-slate-100 px-2 py-0.5 rounded text-[10px] font-bold text-slate-500 tracking-widest uppercase truncate max-w-[80px]" title={caseData?.case_id}>ID: {caseData?.case_id?.slice(0, 8) ?? "Pt-2941"}</span>
                       <div className="flex items-center text-xs text-slate-500 font-medium">
                         <Input 
                            className="w-10 h-5 p-0 border-none shadow-none focus-visible:ring-0 bg-transparent text-right"
                            value={localInfo?.height_cm ?? ""}
                            onChange={(e) => updatePatientInfo("height_cm", e.target.value)}
                            onBlur={(e) => updatePatientInfo("height_cm", parseFloat(e.target.value) || 0)}
                            placeholder="--"
                          />cm, 
                         <Input 
                            className="w-10 h-5 p-0 border-none shadow-none focus-visible:ring-0 bg-transparent text-right ml-1"
                            value={localInfo?.weight_kg ?? ""}
                            onChange={(e) => updatePatientInfo("weight_kg", e.target.value)}
                            onBlur={(e) => updatePatientInfo("weight_kg", parseFloat(e.target.value) || 0)}
                            placeholder="--"
                          />kg
                       </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-5 mt-auto">
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Activity className="h-4 w-4 text-blue-500" /> 核心生命体征 (Vitals)
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                     <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 relative overflow-hidden transition-colors focus-within:ring-2 focus-within:ring-blue-100 focus-within:bg-white">
                       <div className="text-[10px] text-slate-500 font-bold mb-1">体温 (°C)</div>
                       <Input onChange={(e) => updatePatientInfo("temperature", e.target.value)} onBlur={(e) => updatePatientInfo("temperature", parseFloat(e.target.value) || 0)} className="p-0 h-auto border-none bg-transparent shadow-none text-xl font-bold text-slate-800 focus-visible:ring-0 placeholder:text-slate-300 placeholder:font-normal" placeholder="未录入" value={localInfo?.temperature ?? ""} />
                     </div>
                     <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 relative overflow-hidden transition-colors focus-within:ring-2 focus-within:ring-blue-100 focus-within:bg-white">
                       <div className="text-[10px] text-slate-500 font-bold mb-1">心率 (bpm)</div>
                       <Input onChange={(e) => updatePatientInfo("heart_rate", e.target.value ? parseInt(e.target.value) : "")} className="p-0 h-auto border-none bg-transparent shadow-none text-xl font-bold text-slate-800 focus-visible:ring-0 placeholder:text-slate-300 placeholder:font-normal" placeholder="未录入" value={localInfo?.heart_rate ?? ""} />
                     </div>
                     <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 relative overflow-hidden transition-colors focus-within:ring-2 focus-within:ring-blue-100 focus-within:bg-white">
                       <div className="text-[10px] text-slate-500 font-bold mb-1">血压 (mmHg)</div>
                       <Input onChange={(e) => updatePatientInfo("blood_pressure", e.target.value)} className="p-0 h-auto border-none bg-transparent shadow-none text-xl font-bold text-slate-800 focus-visible:ring-0 placeholder:text-slate-300 placeholder:font-normal" placeholder="未录入" value={localInfo?.blood_pressure ?? ""} />
                     </div>
                     <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 relative overflow-hidden transition-colors focus-within:ring-2 focus-within:ring-blue-100 focus-within:bg-white">
                       <div className="text-[10px] text-slate-500 font-bold mb-1">血氧 (SpO2%)</div>
                       <Input onChange={(e) => updatePatientInfo("spo2", e.target.value)} onBlur={(e) => updatePatientInfo("spo2", parseFloat(e.target.value) || 0)} className="p-0 h-auto border-none bg-transparent shadow-none text-xl font-bold text-slate-800 focus-visible:ring-0 placeholder:text-slate-300 placeholder:font-normal" placeholder="未录入" value={localInfo?.spo2 ?? ""} />
                     </div>
                  </div>
                </div>
              </div>

              {/* === 右侧：主诉与既往史文本流 (65%) === */}
              <div className="flex-1 space-y-4">
                <div className="border border-slate-200 bg-white p-5 rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                  <label className="text-sm font-medium text-slate-600 mb-3 block">主诉 (Chief Complaint)</label>
                  <Textarea 
                    className="resize-none border-none shadow-none focus-visible:ring-0 p-0 text-slate-800 font-bold placeholder:text-slate-300 placeholder:font-normal min-h-[40px]"
                    placeholder="未记录 (N/A)"
                    value={localInfo?.chief_complaint ?? ""}
                    onChange={(e) => updatePatientInfo("chief_complaint", e.target.value)}
                  />
                </div>
                <div className="border border-slate-200 bg-white p-5 rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                  <label className="text-sm font-medium text-slate-600 mb-3 block">现病史 (Present Illness)</label>
                  <Textarea 
                    className="resize-none border-none shadow-none focus-visible:ring-0 p-0 text-slate-800 font-bold placeholder:text-slate-300 placeholder:font-normal min-h-[60px]"
                    placeholder="未录入具体现病史... (N/A)"
                    value={localInfo?.present_illness ?? ""}
                    onChange={(e) => updatePatientInfo("present_illness", e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="border border-slate-200 bg-white p-4 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                    <label className="text-sm font-medium text-slate-600 mb-2 block">既往史 (Medical History)</label>
                    <Textarea 
                      className="resize-none border-none shadow-none focus-visible:ring-0 p-0 text-sm text-slate-800 font-semibold placeholder:text-slate-300 placeholder:font-normal min-h-[40px]"
                      placeholder="未录入 (N/A)"
                      value={localInfo?.medical_history ?? ""}
                      onChange={(e) => updatePatientInfo("medical_history", e.target.value)}
                    />
                  </div>
                  <div className="border border-slate-200 bg-white p-4 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                    <label className="text-sm font-medium text-slate-600 mb-2 block">过敏与用药 (Allergies & Meds)</label>
                    <Textarea 
                      className="resize-none border-none shadow-none focus-visible:ring-0 p-0 text-sm text-slate-800 font-semibold placeholder:text-slate-300 placeholder:font-normal min-h-[40px]"
                      placeholder="无已知过敏史 (N/A)"
                      value={localInfo?.allergies ?? ""}
                      onChange={(e) => updatePatientInfo("allergies", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 医生批注区 (Doctor's Annotation) */}
            <div className="mt-8 border-2 border-dashed border-blue-200 bg-[#f8fbff] p-5 rounded-xl relative group focus-within:border-blue-400 focus-within:bg-blue-50/50 transition-colors flex-1 flex flex-col min-h-[200px]">
              <div className="absolute -top-3 left-4 bg-blue-100 text-blue-700 text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5 shadow-[0_2px_4px_rgba(0,0,0,0.02)] border border-blue-200">
                 <User className="w-3.5 h-3.5" />
                 医生诊疗批注板 (Doctor's Notepad)
              </div>
              <Textarea 
                 placeholder="全白板模式：向下占据全部剩余空间。在此键入您对该患者病历的分析、修正、或者推断。这些信息将充当后续 LangGraph 的高权重先验知识..."
                 className="mt-2 w-full flex-1 border-none bg-transparent shadow-none focus-visible:ring-0 placeholder:text-blue-300 text-slate-700 text-lg leading-relaxed resize-none p-0"
              />
            </div>
          </div>
        )}

        {activeTabData?.type === "imaging" && (
          <ImagingViewer 
             reportId={activeTabData.item?.evidence_id} 
             threadId={caseData?.patient_thread_id}
             imagePath={activeTabData.item?.file_path} 
             initialStructuredData={activeTabData.item?.structured_data} 
          />
        )}

        {(activeTabData?.type === "lab" || activeTabData?.type === "ecg" || activeTabData?.type === "note") && (
          <div className="animate-in fade-in duration-300 h-full flex-1 w-full bg-[#fdfbf7]">
             {(() => {
               const rawText = activeTabData.item?.ai_analysis || "";

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
                   title={activeTabData.item?.title}
                   isAbnormal={activeTabData.item?.is_abnormal}
                   evidenceId={activeTabData.item?.evidence_id}
                   caseId={caseId}
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
                onClick={handleSubmitDiagnosis}
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
               <Button
                 size="lg"
                 onClick={handleSynthesisDiagnosis}
                 disabled={isSynthesizing || !caseId}
                 className="px-6 py-6 text-base rounded-full font-semibold bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5 gap-2"
               >
                 {isSynthesizing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                 {isSynthesizing ? "汇总中..." : "一键综合诊断"}
               </Button>
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
