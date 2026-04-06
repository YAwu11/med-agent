"use client";

/**
 * SynthesisPanel — 医生端 AI 综合诊断结果面板
 *
 * 轻量替代 DoctorChatSidebar，不依赖 LangGraph。
 * 直接通过 SSE 接收后端 /api/doctor/synthesize 的流式输出，
 * 用 Streamdown 渲染流式 Markdown。
 */

import {
  AlertTriangle,
  BookOpen,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";

import { Button } from "@/components/ui/button";
import { getBackendBaseURL } from "@/core/config";
import { streamdownPlugins } from "@/core/streamdown";

// ── SSE 事件类型定义 ─────────────────────────────────────────
interface SynthesisStatusEvent {
  type: "status";
  text: string;
}
interface SynthesisTokenEvent {
  type: "token";
  content: string;
}
interface SynthesisToolCallEvent {
  type: "tool_call";
  name: string;
  query: string;
}
interface SynthesisDoneEvent {
  type: "done";
}
interface SynthesisErrorEvent {
  type: "error";
  message: string;
}

type SynthesisEvent =
  | SynthesisStatusEvent
  | SynthesisTokenEvent
  | SynthesisToolCallEvent
  | SynthesisDoneEvent
  | SynthesisErrorEvent;

// ── Props ────────────────────────────────────────────────────
interface SynthesisPanelProps {
  /** case_id，点击综合诊断时触发 SSE 流 */
  caseId: string;
  /** 父组件传入的触发信号（递增数字或 truthy 值），变化时启动综合诊断 */
  triggerSignal: number;
}

export function SynthesisPanel({ caseId, triggerSignal }: SynthesisPanelProps) {
  // ── 状态 ────────────────────────────────────────────────
  const [content, setContent] = useState("");
  const [statusText, setStatusText] = useState("");
  const [toolCalls, setToolCalls] = useState<{ name: string; query: string }[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, statusText]);

  // ── 启动 SSE 流 ─────────────────────────────────────────
  const startSynthesis = useCallback(async () => {
    // 清理上一次
    abortRef.current?.abort();
    setContent("");
    setStatusText("");
    setToolCalls([]);
    setError(null);
    setIsRunning(true);
    setHasRun(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${getBackendBaseURL()}/api/doctor/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id: caseId }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          (errorData as { detail?: string }).detail ??
            `请求失败 (HTTP ${res.status})`
        );
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // 保留最后一行（可能不完整）
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as SynthesisEvent;

            switch (event.type) {
              case "status":
                setStatusText(event.text);
                break;
              case "token":
                setContent((prev) => prev + event.content);
                break;
              case "tool_call":
                setToolCalls((prev) => [
                  ...prev,
                  { name: event.name, query: event.query },
                ]);
                break;
              case "done":
                setIsRunning(false);
                setStatusText("");
                return;
              case "error":
                setError(event.message);
                setIsRunning(false);
                return;
            }
          } catch {
            // 忽略无法解析的行
          }
        }
      }

      // 流正常关闭
      setIsRunning(false);
      setStatusText("");
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message ?? "未知错误");
      setIsRunning(false);
    }
  }, [caseId]);

  // 监听触发信号
  useEffect(() => {
    if (triggerSignal > 0) {
      void startSynthesis();
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [triggerSignal, startSynthesis]);

  // ── 渲染 ────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-500" />
          <span className="text-sm font-semibold text-slate-800">
            AI 综合诊断分析
          </span>
        </div>
        {hasRun && !isRunning && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void startSynthesis()}
            className="h-7 gap-1.5 text-xs text-slate-500 hover:text-violet-600"
          >
            <RotateCcw className="h-3 w-3" />
            重新分析
          </Button>
        )}
      </div>

      {/* 内容区 */}
      <div ref={contentRef} className="flex-1 overflow-y-auto px-5 py-4">
        {/* 空态 */}
        {!hasRun && !isRunning && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-violet-50">
              <BookOpen className="h-8 w-8 text-violet-400" />
            </div>
            <p className="text-sm font-medium text-slate-600">
              等待启动综合诊断
            </p>
            <p className="mt-1 max-w-[240px] text-xs text-slate-400">
              请在左侧审核完病例资料后，点击「一键综合诊断」按钮
            </p>
          </div>
        )}

        {/* 工具调用状态 */}
        {toolCalls.length > 0 && (
          <div className="mb-4 space-y-2">
            {toolCalls.map((tc, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2"
              >
                <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                <div className="min-w-0">
                  <span className="text-xs font-medium text-blue-700">
                    知识库检索
                  </span>
                  <p className="mt-0.5 text-xs text-blue-600/80 break-words">
                    {tc.query}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 流式 Markdown 内容 */}
        {content && (
          <div className="prose prose-sm prose-slate max-w-none">
            <Streamdown
              remarkPlugins={streamdownPlugins.remarkPlugins}
            >
              {content}
            </Streamdown>
          </div>
        )}

        {/* 进行中状态 */}
        {isRunning && statusText && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
            <span>{statusText}</span>
          </div>
        )}

        {/* 加载骨架：还没有内容但正在运行 */}
        {isRunning && !content && !statusText && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>正在连接 AI 服务...</span>
          </div>
        )}

        {/* 错误 */}
        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div>
                <p className="text-sm font-medium text-red-800">分析失败</p>
                <p className="mt-1 text-xs text-red-600">{error}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void startSynthesis()}
              className="mt-3 h-7 gap-1.5 border-red-200 text-xs text-red-700 hover:bg-red-100"
            >
              <RotateCcw className="h-3 w-3" />
              重试
            </Button>
          </div>
        )}
      </div>

      {/* 底部免责声明 */}
      {content && !isRunning && (
        <div className="shrink-0 border-t border-slate-100 bg-slate-50/50 px-4 py-2">
          <p className="text-[11px] text-slate-400">
            ⚠️ 本报告由 AI 生成，仅供临床参考，最终诊断请以主治医师判断为准。
          </p>
        </div>
      )}
    </div>
  );
}
