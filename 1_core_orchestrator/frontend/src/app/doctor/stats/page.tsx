"use client";

import {
  BarChart3,
  TrendingUp,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Activity,
  ImageIcon,
  FileText,
  Zap,
  HeartPulse,
} from "lucide-react";
import React, { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────
interface Stats {
  total: number;
  pending: number;
  in_review: number;
  diagnosed: number;
  closed: number;
  priority_breakdown: { critical: number; high: number; medium: number; low: number };
  evidence_types: { imaging: number; lab: number; ecg: number; vitals: number; note: number };
  abnormal_evidence_count: number;
  top_diagnoses: { name: string; count: number }[];
}

// ── Empty initial state (API loads real data) ──────────────
const EMPTY_STATS: Stats = {
  total: 0,
  pending: 0,
  in_review: 0,
  diagnosed: 0,
  closed: 0,
  priority_breakdown: { critical: 0, high: 0, medium: 0, low: 0 },
  evidence_types: { imaging: 0, lab: 0, ecg: 0, vitals: 0, note: 0 },
  abnormal_evidence_count: 0,
  top_diagnoses: [],
};

// ── Reusable stat card ─────────────────────────────────────
function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "blue",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color?: "blue" | "amber" | "green" | "red" | "purple" | "slate";
}) {
  const palette: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    amber: "bg-amber-50 text-amber-600 border-amber-100",
    green: "bg-green-50 text-green-600 border-green-100",
    red: "bg-red-50 text-red-600 border-red-100",
    purple: "bg-purple-50 text-purple-600 border-purple-100",
    slate: "bg-slate-50 text-slate-600 border-slate-100",
  };
  const iconBg: Record<string, string> = {
    blue: "bg-blue-100 text-blue-600",
    amber: "bg-amber-100 text-amber-600",
    green: "bg-green-100 text-green-600",
    red: "bg-red-100 text-red-600",
    purple: "bg-purple-100 text-purple-600",
    slate: "bg-slate-100 text-slate-600",
  };

  return (
    <div className={cn("rounded-2xl border p-6 transition-all hover:shadow-md", palette[color])}>
      <div className="flex items-center justify-between mb-4">
        <div className={cn("p-2.5 rounded-xl", iconBg[color])}>
          <Icon className="h-5 w-5" />
        </div>
        {sub && <span className="text-xs font-medium opacity-70">{sub}</span>}
      </div>
      <div className="text-3xl font-extrabold tracking-tight">{value}</div>
      <div className="text-sm font-medium mt-1 opacity-80">{label}</div>
    </div>
  );
}

// ── Simple bar chart (pure CSS) ────────────────────────────
function SimpleBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-slate-600 w-28 shrink-0 truncate font-medium">{label}</span>
      <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-700", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-bold text-slate-700 w-10 text-right">{value}</span>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────
export default function DoctorStatsPage() {
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    import("@/core/api/cases")
      .then(({ fetchDoctorStats }) => fetchDoctorStats())
      .then((data) => {
        const statsData = data as unknown as Stats;
        if (statsData && statsData.total >= 0 && statsData.priority_breakdown) {
          setStats(statsData);
          setIsLive(true);
        }
      })
      .catch(() => {
        console.info("[Stats] API unavailable, using mock data");
      });
  }, []);

  const totalEvidence = stats.evidence_types ? Object.values(stats.evidence_types).reduce((a, b) => a + b, 0) : 1;
  const maxDiagCount = stats.top_diagnoses?.length > 0 ? stats.top_diagnoses[0]!.count : 1;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">诊疗统计看板</h1>
            <p className="text-sm text-slate-500 mt-1">实时监控诊断工作负荷与质量指标</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={cn(
              "text-xs",
              isLive ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-50 text-slate-500 border-slate-200"
            )}>
              {isLive ? "● 实时数据" : "○ 演示数据"}
            </Badge>
          </div>
        </div>

        {/* KPI Cards Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <MetricCard icon={Users} label="总接诊量" value={stats.total} sub="累计" color="blue" />
          <MetricCard icon={Clock} label="待审病例" value={stats.pending} sub="队列中" color="amber" />
          <MetricCard icon={CheckCircle2} label="已诊断" value={stats.diagnosed} sub="完成" color="green" />
          <MetricCard icon={AlertTriangle} label="异常指标" value={stats.abnormal_evidence_count} sub="需关注" color="red" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Priority Breakdown */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h3 className="text-base font-bold text-slate-800 mb-5 flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" /> 优先级分布
            </h3>
            <div className="space-y-4">
              <SimpleBar label="🔴 紧急 (Critical)" value={stats.priority_breakdown.critical} max={stats.total} color="bg-red-500" />
              <SimpleBar label="🟠 高 (High)" value={stats.priority_breakdown.high} max={stats.total} color="bg-amber-500" />
              <SimpleBar label="🔵 中 (Medium)" value={stats.priority_breakdown.medium} max={stats.total} color="bg-blue-500" />
              <SimpleBar label="⚪ 低 (Low)" value={stats.priority_breakdown.low} max={stats.total} color="bg-slate-400" />
            </div>
          </div>

          {/* Evidence Type Distribution */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h3 className="text-base font-bold text-slate-800 mb-5 flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-500" /> 证据类型分布
            </h3>
            <div className="space-y-4">
              <SimpleBar label="🖼️ 医学影像" value={stats.evidence_types.imaging} max={totalEvidence} color="bg-blue-500" />
              <SimpleBar label="🧪 化验报告" value={stats.evidence_types.lab} max={totalEvidence} color="bg-green-500" />
              <SimpleBar label="💓 心电图" value={stats.evidence_types.ecg} max={totalEvidence} color="bg-red-400" />
              <SimpleBar label="📋 体征记录" value={stats.evidence_types.vitals} max={totalEvidence} color="bg-purple-400" />
              <SimpleBar label="📝 医生批注" value={stats.evidence_types.note} max={totalEvidence} color="bg-slate-400" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Diagnoses */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h3 className="text-base font-bold text-slate-800 mb-5 flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-green-500" /> Top 5 疾病分布
            </h3>
            {stats.top_diagnoses.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">暂无诊断数据</p>
            ) : (
              <div className="space-y-4">
                {stats.top_diagnoses.map((d, idx) => (
                  <SimpleBar
                    key={d.name}
                    label={`${idx + 1}. ${d.name}`}
                    value={d.count}
                    max={maxDiagCount}
                    color={["bg-blue-500", "bg-green-500", "bg-amber-500", "bg-purple-500", "bg-red-400"][idx] ?? "bg-slate-400"}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Status Pipeline */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h3 className="text-base font-bold text-slate-800 mb-5 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-purple-500" /> 工作流水线状态
            </h3>
            <div className="flex items-center gap-3">
              {[
                { label: "待审", value: stats.pending, color: "bg-amber-500", textColor: "text-amber-700" },
                { label: "审阅中", value: stats.in_review, color: "bg-blue-500", textColor: "text-blue-700" },
                { label: "已诊断", value: stats.diagnosed, color: "bg-green-500", textColor: "text-green-700" },
                { label: "已归档", value: stats.closed, color: "bg-slate-400", textColor: "text-slate-600" },
              ].map((stage, idx) => (
                <React.Fragment key={stage.label}>
                  <div className="flex-1 text-center">
                    <div className={cn("text-2xl font-extrabold", stage.textColor)}>{stage.value}</div>
                    <div className="text-xs text-slate-500 mt-1">{stage.label}</div>
                    <div className={cn("h-1.5 rounded-full mt-3", stage.color)} />
                  </div>
                  {idx < 3 && (
                    <div className="text-slate-300 text-lg shrink-0">→</div>
                  )}
                </React.Fragment>
              ))}
            </div>
            <div className="mt-6 p-4 bg-slate-50 rounded-xl text-center">
              <p className="text-xs text-slate-500">
                转化率：<span className="font-bold text-green-700">{stats.total > 0 ? Math.round(((stats.diagnosed + stats.closed) / stats.total) * 100) : 0}%</span> 的病例已完成诊断
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
