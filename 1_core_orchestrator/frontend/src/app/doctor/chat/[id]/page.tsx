"use client";

import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { EvidenceDesk } from "@/components/doctor/EvidenceDesk";
import { SynthesisPanel } from "@/components/doctor/SynthesisPanel";

// ── 侧栏宽度约束 (px) ──────────────────────────────────
const MIN_WIDTH = 280;       // 最窄可用宽度
const MAX_WIDTH_RATIO = 0.55; // 最宽不超过视口 55%
const DEFAULT_WIDTH = 400;   // 初始宽度
const COLLAPSE_THRESHOLD = 120; // 拖到低于此值自动收起

export default function DoctorChatPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = React.use(params);

  // ── 状态 ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<string>("vitals");
  const [isReviewPassed, setIsReviewPassed] = useState(false);

  // 综合诊断触发信号：每次递增来触发 SynthesisPanel 的 SSE 流
  const [synthesisTrigger, setSynthesisTrigger] = useState(0);

  // 侧栏宽度 & 折叠状态
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  // 记住折叠前的宽度，恢复时用
  const lastWidthRef = useRef(DEFAULT_WIDTH);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── 综合诊断回调 ──────────────────────────────────────
  const handleSynthesisDiagnosis = useCallback(() => {
    // 展开侧栏 + 触发 SSE 流
    setIsCollapsed(false);
    setSidebarWidth(lastWidthRef.current || DEFAULT_WIDTH);
    setSynthesisTrigger((prev) => prev + 1);
  }, []);

  // ── 拖拽逻辑 ─────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const maxWidth = containerRect.width * MAX_WIDTH_RATIO;

      // 从右边算：鼠标距容器右边的距离就是侧栏宽度
      let newWidth = containerRect.right - e.clientX;

      // 低于阈值 → 自动收起
      if (newWidth < COLLAPSE_THRESHOLD) {
        setIsCollapsed(true);
        setIsDragging(false);
        return;
      }

      // 钳位
      newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, newWidth));
      setSidebarWidth(newWidth);
      lastWidthRef.current = newWidth;
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    // 添加到 document 级别，这样鼠标快速拖动也不会丢失
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    // 拖拽时禁止文字选中
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isDragging]);

  // ── 折叠 / 展开 ──────────────────────────────────────
  const toggleCollapse = useCallback(() => {
    if (isCollapsed) {
      // 展开：恢复之前的宽度
      setIsCollapsed(false);
      setSidebarWidth(lastWidthRef.current || DEFAULT_WIDTH);
    } else {
      // 折叠：记住当前宽度
      lastWidthRef.current = sidebarWidth;
      setIsCollapsed(true);
    }
  }, [isCollapsed, sidebarWidth]);

  return (
    <div
      ref={containerRef}
      className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-slate-50"
    >
      {/* 左主视图 - Medical Evidence Desk（自动填充剩余空间） */}
      <div className="flex-1 min-w-0 bg-slate-50 relative flex flex-col shadow-inner overflow-hidden">
        <EvidenceDesk
          activeTab={activeTab}
          onTabChange={setActiveTab}
          isReviewPassed={isReviewPassed}
          onReviewPass={() => setIsReviewPassed(true)}
          caseId={resolvedParams.id}
          onSynthesisDiagnosis={handleSynthesisDiagnosis}
        />
      </div>

      {/* ── 拖拽分隔条（展开态才渲染） ─────────────── */}
      {!isCollapsed && (
        <div
          onMouseDown={handleMouseDown}
          className="relative w-[5px] shrink-0 cursor-col-resize z-30 group"
        >
          {/* 底色：默认透明，hover 显蓝线 */}
          <div className={`
            absolute inset-0 transition-colors duration-200
            ${isDragging ? "bg-blue-500/60" : "bg-transparent group-hover:bg-blue-400/40"}
          `} />

          {/* 居中小圆点指示器 */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-[3px] opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className={`w-1 h-1 rounded-full ${isDragging ? "bg-blue-500" : "bg-slate-400 group-hover:bg-blue-500"}`} />
            <div className={`w-1 h-1 rounded-full ${isDragging ? "bg-blue-500" : "bg-slate-400 group-hover:bg-blue-500"}`} />
            <div className={`w-1 h-1 rounded-full ${isDragging ? "bg-blue-500" : "bg-slate-400 group-hover:bg-blue-500"}`} />
          </div>

          {/* 折叠触发区：hover 时在分隔条左侧浮出小箭头 */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleCollapse(); }}
            className="absolute -left-[14px] top-1/2 -translate-y-1/2 h-10 w-[14px] rounded-l-md
                       bg-white/90 backdrop-blur border border-r-0 border-slate-200/80
                       flex items-center justify-center
                       opacity-0 group-hover:opacity-100 transition-all duration-200
                       hover:bg-blue-50 hover:border-blue-300 shadow-sm z-40"
            title="收起 AI 诊断"
          >
            <ChevronRight className="h-3 w-3 text-slate-400 group-hover:text-blue-500" />
          </button>
        </div>
      )}

      {/* ── 右侧 AI 综合诊断面板 ─────────────────────── */}
      {isCollapsed ? (
        /* 折叠态：右侧边缘垂直居中的浮动展开按钮 */
        <button
          onClick={toggleCollapse}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-50
                     flex items-center gap-2 pl-3 pr-2 py-4
                     bg-blue-600 text-white
                     rounded-l-xl shadow-lg shadow-blue-300/50
                     hover:bg-blue-700 hover:shadow-blue-400/60 hover:pr-3
                     transition-all duration-300 ease-out
                     group cursor-pointer"
          title="展开 AI 诊断"
        >
          <ChevronLeft className="h-5 w-5 transition-transform duration-300 group-hover:-translate-x-0.5" />
          <MessageSquare className="h-5 w-5" />
          <span className="text-xs font-medium whitespace-nowrap">AI 诊断</span>
        </button>
      ) : (
        /* 展开态：SynthesisPanel 替代原 DoctorChatSidebar */
        <div
          className="shrink-0 border-l border-slate-200 bg-white/50 relative flex flex-col shadow-[-4px_0_12px_rgba(0,0,0,0.02)] z-20"
          style={{ width: `${sidebarWidth}px` }}
        >
          <SynthesisPanel
            caseId={resolvedParams.id}
            triggerSignal={synthesisTrigger}
          />
        </div>
      )}
    </div>
  );
}
