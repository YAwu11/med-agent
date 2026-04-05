"use client";

import { ActivityIcon, TimerResetIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  buildToolChainWarnings,
  type ToolChainDiagnostics,
} from "@/core/threads/tool-diagnostics";
import { cn } from "@/lib/utils";

import { Tooltip } from "./tooltip";

function formatMs(value: number) {
  if (value < 1_000) {
    return `${value}ms`;
  }
  return `${(value / 1_000).toFixed(1)}s`;
}

export function ToolChainIndicator({
  diagnostics,
  className,
}: {
  diagnostics: ToolChainDiagnostics | null;
  className?: string;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!diagnostics) {
      return;
    }

    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [diagnostics]);

  const warnings = useMemo(
    () => (diagnostics ? buildToolChainWarnings(diagnostics, nowMs) : []),
    [diagnostics, nowMs],
  );

  if (!diagnostics) {
    return null;
  }

  const firstStageLatency =
    diagnostics.streamStartedAtMs != null
      ? diagnostics.streamStartedAtMs - diagnostics.submittedAtMs
      : null;
  const activeTool = [...diagnostics.tools]
    .reverse()
    .find((tool) => tool.finishedAtMs == null);
  const badgeLabel = warnings.length > 0
    ? "链路告警"
    : activeTool
      ? `工具中 ${activeTool.name}`
      : diagnostics.tools.length > 0
        ? `链路 ${diagnostics.tools.length} 工具`
        : "等待工具";

  const tooltipContent = (
    <div className="space-y-2 text-xs">
      <div className="font-medium text-slate-100">工具链路诊断</div>
      <div className="flex items-center justify-between gap-4">
        <span>提交到运行创建</span>
        <span className="font-mono">
          {firstStageLatency == null ? "等待中" : formatMs(firstStageLatency)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span>工具调用次数</span>
        <span className="font-mono">{diagnostics.tools.length}</span>
      </div>
      {diagnostics.tools.length > 0 ? (
        <div className="space-y-1 border-t border-slate-700 pt-2">
          {diagnostics.tools.slice(-4).map((tool, index) => (
            <div
              key={`${tool.name}-${tool.runId ?? "no-run"}-${tool.startedAtMs}-${index}`}
              className="flex items-center justify-between gap-4"
            >
              <span className="truncate text-slate-200">{tool.name}</span>
              <span className="font-mono text-slate-300">
                {tool.durationMs != null
                  ? formatMs(tool.durationMs)
                  : formatMs(Math.max(0, nowMs - tool.startedAtMs))}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div className="space-y-1 border-t border-slate-700 pt-2 text-amber-300">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <Tooltip content={tooltipContent}>
      <button
        type="button"
        className={cn(
          "inline-flex cursor-default items-center gap-1.5 text-xs",
          className,
        )}
      >
        <Badge
          variant="outline"
          className={cn(
            "border-slate-200 bg-white/80 px-2 py-1 text-[11px] font-medium text-slate-600",
            warnings.length > 0 && "border-amber-200 bg-amber-50 text-amber-800",
            activeTool && warnings.length === 0 && "border-cyan-200 bg-cyan-50 text-cyan-800",
          )}
        >
          {warnings.length > 0 ? (
            <TriangleAlertIcon />
          ) : activeTool ? (
            <WrenchIcon />
          ) : diagnostics.tools.length > 0 ? (
            <ActivityIcon />
          ) : (
            <TimerResetIcon />
          )}
          <span>{badgeLabel}</span>
        </Badge>
      </button>
    </Tooltip>
  );
}