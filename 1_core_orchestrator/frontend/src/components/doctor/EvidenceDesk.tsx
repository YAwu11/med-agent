"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ShieldCheck, User, Image as ImageIcon, FileText, Activity, Loader2, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fetchCase, type CaseData } from "@/core/api/cases";
import { ImagingViewer } from "@/components/doctor/ImagingViewer";

interface EvidenceDeskProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isReviewPassed: boolean;
  onReviewPass: () => void;
  caseId?: string | null;  // When provided, fetch real data from API
}

export function EvidenceDesk({ activeTab, onTabChange, isReviewPassed, onReviewPass, caseId }: EvidenceDeskProps) {
  
  // ── API Data State ──────────────────────────────────
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!caseId) return;
    setIsLoading(true);
    fetchCase(caseId)
      .then((data) => {
        setCaseData(data);
        // Auto-select first evidence tab if available
        if (data.evidence.length > 0) {
          onTabChange("vitals"); // Default to vitals overview
        }
      })
      .catch((err) => {
        console.warn("[EvidenceDesk] Failed to fetch case data, using mock:", err);
        setCaseData(null);
      })
      .finally(() => setIsLoading(false));
  }, [caseId]);

  // Derive display values from API data or mock defaults
  const patientName = caseData?.patient_info?.name ?? "张建国";
  const patientAge = caseData?.patient_info?.age ?? 58;
  const patientSex = caseData?.patient_info?.sex ?? "男";
  const evidenceItems = caseData?.evidence ?? [];

  // Per-item review tracking
  const ALL_TABS = ["vitals", "imaging", "imaging_2", "labs", "lab_2", "lab_3"];
  const [reviewedTabs, setReviewedTabs] = useState<Set<string>>(new Set());
  const toggleReviewed = (tabId: string) => {
    setReviewedTabs(prev => {
      const next = new Set(prev);
      if (next.has(tabId)) next.delete(tabId); else next.add(tabId);
      return next;
    });
  };
  const allReviewed = ALL_TABS.every(t => reviewedTabs.has(t));
  
  // 提取一个公用的渲染左侧菜单按钮的小组件函数，保持代码整洁
  const renderTab = (id: string, label: string, Icon: React.ElementType, isAlert = false) => {
    const isActive = activeTab === id;
    const isReviewed = reviewedTabs.has(id);
    return (
      <div key={id} className="flex items-center gap-1">
        <button
          onClick={() => onTabChange(id)}
          className={cn(
            "flex-1 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ring-1",
            isActive 
              ? "bg-blue-50 text-blue-700 shadow-sm ring-blue-200 font-semibold" 
              : "bg-transparent text-slate-600 hover:bg-slate-200/50 ring-transparent hover:text-slate-900 font-medium"
          )}
        >
          <div className={cn("p-1.5 rounded-md", isActive ? "bg-white text-blue-600 shadow-sm" : "bg-white text-slate-400 border border-slate-200/50")}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="truncate">{label}</span>
          {isAlert && !isReviewed && <span className="ml-auto w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>}
        </button>
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
    <div className="flex w-full h-full flex-row relative bg-white overflow-hidden">
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
            {renderTab("vitals", "基础体征与历史", User)}
          </div>
          
          <div className="space-y-1">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 ml-2 flex items-center justify-between">
              医学影像 <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded mr-2">2</span>
            </div>
            {renderTab("imaging", "胸部 X 光正侧位片", ImageIcon, true)}
            {renderTab("imaging_2", "头颅 CT 平扫", ImageIcon)}
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 ml-2 flex items-center justify-between">
              化验单与检查 <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded mr-2">3</span>
            </div>
            {renderTab("labs", "血液生化全项 (最新)", FileText, true)}
            {renderTab("lab_2", "尿常规筛查", FileText)}
            {renderTab("lab_3", "12导联静态心电图", Activity)}
          </div>

        </div>
      </div>

      {/* 75% 右侧主视图 - 证据查看器与提交流程 (Detail View) */}
      <div className="flex-1 min-w-0 flex flex-col relative bg-slate-50/50">
        
        {/* 中心视野区 (Content Viewer) */}
        <div className="flex-1 overflow-y-auto p-8 relative">
        
        {activeTab === "vitals" && (
          <div className="animate-in fade-in duration-300 flex flex-col h-full">
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
                    <h3 className="text-xl font-bold text-slate-800 tracking-tight">{patientName}</h3>
                    <div className="text-sm text-slate-500 font-medium mt-0.5">{patientAge}岁 · {patientSex === "男" ? "男性" : patientSex === "女" ? "女性" : patientSex ?? "N/A"}</div>
                    <div className="flex items-center gap-2 mt-1.5">
                       <span className="bg-slate-100 px-2 py-0.5 rounded text-[10px] font-bold text-slate-500 tracking-widest uppercase">ID: {caseData?.case_id?.slice(0, 8) ?? "Pt-2941"}</span>
                       <span className="text-xs text-slate-500 font-medium">{caseData?.patient_info?.height_cm ?? 175}cm, {caseData?.patient_info?.weight_kg ?? 72}kg</span>
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
                       <Input className="p-0 h-auto border-none bg-transparent shadow-none text-xl font-bold text-slate-800 focus-visible:ring-0 placeholder:text-slate-300 placeholder:font-normal" placeholder="未录入" defaultValue="" />
                     </div>
                     <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 relative overflow-hidden transition-colors focus-within:ring-2 focus-within:ring-blue-100 focus-within:bg-white">
                       <div className="text-[10px] text-slate-500 font-bold mb-1">心率 (bpm)</div>
                       <Input className="p-0 h-auto border-none bg-transparent shadow-none text-xl font-bold text-slate-800 focus-visible:ring-0 placeholder:text-slate-300 placeholder:font-normal" placeholder="未录入" defaultValue="" />
                     </div>
                     <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 relative overflow-hidden transition-colors focus-within:ring-2 focus-within:ring-blue-100 focus-within:bg-white">
                       <div className="text-[10px] text-slate-500 font-bold mb-1">血压 (mmHg)</div>
                       <Input className="p-0 h-auto border-none bg-transparent shadow-none text-xl font-bold text-slate-800 focus-visible:ring-0 placeholder:text-slate-300 placeholder:font-normal" placeholder="未录入" defaultValue="" />
                     </div>
                     <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 relative overflow-hidden transition-colors focus-within:ring-2 focus-within:ring-blue-100 focus-within:bg-white">
                       <div className="text-[10px] text-slate-500 font-bold mb-1">血氧 (SpO2%)</div>
                       <Input className="p-0 h-auto border-none bg-transparent shadow-none text-xl font-bold text-slate-800 focus-visible:ring-0 placeholder:text-slate-300 placeholder:font-normal" placeholder="未录入" defaultValue="" />
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
                    defaultValue="咳嗽。"
                  />
                </div>
                <div className="border border-slate-200 bg-white p-5 rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                  <label className="text-sm font-medium text-slate-600 mb-3 block">现病史 (Present Illness)</label>
                  <Textarea 
                    className="resize-none border-none shadow-none focus-visible:ring-0 p-0 text-slate-800 font-bold placeholder:text-slate-300 placeholder:font-normal min-h-[60px]"
                    placeholder="未录入具体现病史... (N/A)"
                    defaultValue=""
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="border border-slate-200 bg-white p-4 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                    <label className="text-sm font-medium text-slate-600 mb-2 block">既往史 (Medical History)</label>
                    <Textarea 
                      className="resize-none border-none shadow-none focus-visible:ring-0 p-0 text-sm text-slate-800 font-semibold placeholder:text-slate-300 placeholder:font-normal min-h-[40px]"
                      placeholder="未录入 (N/A)"
                      defaultValue=""
                    />
                  </div>
                  <div className="border border-slate-200 bg-white p-4 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                    <label className="text-sm font-medium text-amber-600 mb-2 block">过敏与用药 (Allergies/Meds)</label>
                    <Textarea 
                      className="resize-none border-none shadow-none focus-visible:ring-0 p-0 text-sm text-slate-800 font-semibold placeholder:text-amber-200 placeholder:font-normal min-h-[40px]"
                      placeholder="未明示 (N/A)"
                      defaultValue=""
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

        {activeTab === "imaging" && (
          <ImagingViewer />
        )}

        {activeTab === "labs" && (
          <div className="animate-in fade-in duration-300 flex flex-col p-8 h-full bg-white border border-slate-200 rounded-xl m-8 shadow-sm">
             <div className="flex justify-between items-center mb-6">
               <h2 className="text-xl font-bold text-slate-800">血液生化全项分析</h2>
               <span className="bg-red-50 text-red-600 text-xs font-bold px-2 py-1 rounded">存在异常项</span>
             </div>
             <table className="w-full text-sm text-left text-slate-600">
                <thead className="text-xs text-slate-500 bg-slate-50 border-y border-slate-200">
                    <tr><th className="px-4 py-3">项目 (Item)</th><th className="px-4 py-3">结果 (Result)</th><th className="px-4 py-3">参考范围 (Ref)</th></tr>
                </thead>
                <tbody>
                    <tr className="border-b"><td className="px-4 py-3">白细胞计数 (WBC)</td><td className="px-4 py-3 text-red-600 font-bold">12.5 ↑</td><td className="px-4 py-3">4.0 - 10.0 x10^9/L</td></tr>
                    <tr className="border-b bg-red-50/30"><td className="px-4 py-3">中性粒细胞比例 (NE%)</td><td className="px-4 py-3 text-red-600 font-bold">78.2% ↑</td><td className="px-4 py-3">40.0 - 75.0 %</td></tr>
                    <tr className="border-b"><td className="px-4 py-3">血红蛋白 (HGB)</td><td className="px-4 py-3">135</td><td className="px-4 py-3">130 - 175 g/L</td></tr>
                    <tr className="border-b"><td className="px-4 py-3">血清钾 (K+)</td><td className="px-4 py-3 text-amber-600 font-bold">3.2 ↓</td><td className="px-4 py-3">3.5 - 5.5 mmol/L</td></tr>
                </tbody>
             </table>
          </div>
        )}

        {/* MOCK: 其他占位符 */}
        {activeTab === "imaging_2" && (
          <div className="animate-in fade-in duration-300 flex flex-col items-center justify-center h-full text-slate-400">
            <ImageIcon className="w-16 h-16 mb-4 opacity-50" />
            <p className="font-semibold text-lg text-slate-600">头颅 CT 平扫展示区</p>
            <p className="text-sm mt-2">暂无未处理异常，AI未检出出血点或占位。</p>
          </div>
        )}

        {activeTab === "lab_2" && (
          <div className="animate-in fade-in duration-300 flex flex-col items-center justify-center h-full text-slate-400">
            <FileText className="w-16 h-16 mb-4 opacity-50" />
            <p className="font-semibold text-lg text-slate-600">尿常规筛查报告</p>
            <p className="text-sm mt-2">各项指标正常</p>
          </div>
        )}

        {activeTab === "lab_3" && (
          <div className="animate-in fade-in duration-300 flex flex-col items-center justify-center h-full text-slate-400">
             <Activity className="w-16 h-16 mb-4 opacity-50" />
             <p className="font-semibold text-lg text-slate-600">12导联静态心电图</p>
             <p className="text-sm mt-2 border border-slate-200 bg-slate-50 p-4 rounded-lg text-slate-500 mt-6 shadow-sm">
                正常窦性心律，心率 88 bpm。无明显 S-T 段压低或抬高。
             </p>
          </div>
        )}
        </div>

        {/* 底部审核安全门 (Review Gate) */}
        <div className="h-20 shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur px-8 flex items-center justify-between shadow-[0_-8px_30px_rgba(0,0,0,0.04)] z-10 sticky bottom-0">
           <div className="text-sm text-slate-500 flex flex-col">
              <span className="font-medium text-slate-800">人工审核进度</span>
              <span className="text-xs">已审核 {reviewedTabs.size} / {ALL_TABS.length} 项</span>
           </div>
           <div className="flex items-center gap-3">
             <div className="flex items-center gap-1">
               {ALL_TABS.map(t => (
                 <div key={t} className={cn("w-2 h-2 rounded-full transition-colors", reviewedTabs.has(t) ? "bg-emerald-500" : "bg-slate-200")} />
               ))}
             </div>
             <Button 
                size="lg"
                onClick={onReviewPass}
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
               {isReviewPassed ? "证据链已锁定 (Locked)" : allReviewed ? "确认人工审核完成" : `还有 ${ALL_TABS.length - reviewedTabs.size} 项未审核`}
             </Button>
           </div>
        </div>
      </div>
    </div>
  );
}
