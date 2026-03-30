"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  Search as SearchIcon,
  CheckCircle2,
  FileCheck,
  Loader2,
  HeartPulse,
  User,
  FileText,
  ImageIcon,
  Activity,
  AlertCircle,
  MessageSquare,
  ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── Mock Case for demonstration ────────────────────
const MOCK_CASE = {
  case_id: "a1b2c3d4e5f6",
  status: "in_review" as string,
  priority: "critical",
  patient_info: {
    name: "张建国",
    age: 58,
    sex: "男",
    chief_complaint: "连续咳嗽3周，伴有低烧、胸闷",
  },
  evidence: [
    { type: "imaging", title: "胸部 X 光正侧位片", is_abnormal: true, ai_analysis: "右下肺野可见斑片状阴影，建议进一步 CT 检查。" },
    { type: "lab", title: "血液生化全项", is_abnormal: true, ai_analysis: "白细胞计数偏高 (12.3×10⁹/L)，C反应蛋白升高。" },
  ],
  diagnosis: null as null | {
    primary_diagnosis: string;
    treatment_plan: string;
    prescription: string;
    follow_up: string;
  },
  created_at: new Date(Date.now() - 45 * 60000).toISOString(),
  updated_at: new Date(Date.now() - 10 * 60000).toISOString(),
};

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

export default function PatientStatusPage() {
  const [caseData] = useState(MOCK_CASE);
  const currentStepIdx = statusOrder.indexOf(caseData.status);

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
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
            Case: {caseData.case_id.slice(0, 8)}
          </Badge>
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
                <h2 className="text-2xl font-bold text-slate-800">{caseData.patient_info.name}</h2>
                <Badge variant="outline" className={cn(
                  "text-xs",
                  caseData.priority === "critical" ? "bg-red-50 text-red-700 border-red-200" :
                  caseData.priority === "high" ? "bg-amber-50 text-amber-700 border-amber-200" :
                  "bg-blue-50 text-blue-700 border-blue-200"
                )}>
                  {caseData.priority === "critical" ? "紧急" : caseData.priority === "high" ? "高优先" : "普通"}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-sm text-slate-500">
                <span>{caseData.patient_info.age}岁 · {caseData.patient_info.sex}</span>
                <span className="text-slate-300">|</span>
                <span className="text-slate-700 font-medium">{caseData.patient_info.chief_complaint}</span>
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
                    {isCurrent && caseData.status === "in_review" ? (
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
            <FileText className="h-5 w-5 text-blue-600" /> 已提交的证据材料 ({caseData.evidence.length})
          </h3>
          <div className="space-y-4">
            {caseData.evidence.map((ev, idx) => {
              const EvIcon = evidenceIcons[ev.type] || FileText;
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
        {caseData.status === "diagnosed" && caseData.diagnosis && (
          <div className="bg-green-50 rounded-2xl border border-green-200 shadow-sm p-8 mb-10">
            <h3 className="text-lg font-bold text-green-800 mb-4 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" /> 医生诊断结论
            </h3>
            <div className="space-y-4 text-sm text-green-900">
              <div>
                <span className="font-bold">诊断：</span>
                {caseData.diagnosis.primary_diagnosis}
              </div>
              <div>
                <span className="font-bold">治疗方案：</span>
                {caseData.diagnosis.treatment_plan}
              </div>
              {caseData.diagnosis.prescription && (
                <div>
                  <span className="font-bold">处方：</span>
                  {caseData.diagnosis.prescription}
                </div>
              )}
              {caseData.diagnosis.follow_up && (
                <div>
                  <span className="font-bold">随访建议：</span>
                  {caseData.diagnosis.follow_up}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Waiting state hint */}
        {(caseData.status === "pending" || caseData.status === "in_review") && (
          <div className="bg-blue-50/50 rounded-2xl border border-dashed border-blue-200 p-8 text-center">
            <Loader2 className="h-8 w-8 text-blue-400 mx-auto mb-4 animate-spin" />
            <h4 className="text-base font-bold text-blue-700 mb-2">
              {caseData.status === "pending" ? "等待医生接诊..." : "医生正在审阅您的材料..."}
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
