"use client";

import { CheckIcon, ScanLineIcon, XIcon, Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Artifact,
  ArtifactContent,
  ArtifactHeader,
  ArtifactTitle,
  ArtifactActions,
  ArtifactAction,
} from "@/components/ai-elements/artifact";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitImagingReview, generateImagingDraft, type ImagingReport } from "@/core/imaging/api";
import { useI18n } from "@/core/i18n/hooks";
import { listUploadedFiles } from "@/core/uploads/api";
import { cn } from "@/lib/utils";

import { BboxCanvas, type Finding, type BrushStroke, type CanvasTool } from "./bbox-canvas";
import { FindingsList, CanvasToolbar, NewFindingForm } from "./findings-list";

// ── Undo/Redo History ─────────────────────────────────────────
interface CanvasSnapshot {
  findings: Finding[];
  brushStrokes: BrushStroke[];
}

function useUndoRedo(initial: CanvasSnapshot) {
  const [history, setHistory] = useState<CanvasSnapshot[]>([initial]);
  const [index, setIndex] = useState(0);

  const current = history[index]!;
  const canUndo = index > 0;
  const canRedo = index < history.length - 1;

  const push = useCallback(
    (snapshot: CanvasSnapshot) => {
      setHistory((prev) => {
        // Truncate future states and append new one
        const truncated = prev.slice(0, index + 1);
        // Limit history size to 50 to prevent memory bloat
        const limited = truncated.length >= 50 ? truncated.slice(-49) : truncated;
        return [...limited, snapshot];
      });
      setIndex((prev) => Math.min(prev + 1, 49));
    },
    [index],
  );

  const undo = useCallback(() => {
    if (canUndo) setIndex((i) => i - 1);
  }, [canUndo]);

  const redo = useCallback(() => {
    if (canRedo) setIndex((i) => i + 1);
  }, [canRedo]);

  return { current, push, undo, redo, canUndo, canRedo };
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function ImagingReviewPanel({
  className,
  threadId,
  report,
  onClose,
  onReviewComplete,
}: {
  className?: string;
  threadId: string;
  report: ImagingReport;
  onClose?: () => void;
  onReviewComplete?: (report: ImagingReport) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initial data
  const initialFindings: Finding[] = (report.doctor_result?.findings || report.ai_result?.findings || []).map(
    (f: any) => {
      const aiMatch = report.ai_result?.findings?.find((af: any) => af.id === f.id);
      return {
        ...f,
        ai_confidence: aiMatch ? aiMatch.confidence : f.ai_confidence,
      };
    }
  );
  const initialBrushStrokes: BrushStroke[] = report.doctor_result?.brush_strokes || [];

  // ── Undo/Redo state ──
  const undoRedo = useUndoRedo({
    findings: initialFindings,
    brushStrokes: initialBrushStrokes,
  });

  const editableFindings = undoRedo.current.findings;
  const brushStrokes = undoRedo.current.brushStrokes;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<CanvasTool>("pointer");
  const [doctorComment, setDoctorComment] = useState(report.doctor_result?.doctor_comment || "");
  const [conclusion, setConclusion] = useState<"normal" | "abnormal" | "pending">(
    report.doctor_result?.conclusion || "pending",
  );

  // ── Copilot State ──
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [copilotPrompt, setCopilotPrompt] = useState("");

  // ── Pending new rect (awaiting form input) ──
  const [pendingBbox, setPendingBbox] = useState<[number, number, number, number] | null>(null);

  // ── Image URL ──
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    async function fetchImage() {
      try {
        const res = await listUploadedFiles(threadId);
        const filename = report.image_path.split(/[/\\]/).pop();
        const file = res.files.find((f) => f.filename === filename);
        if (file) setImageUrl(file.artifact_url);
      } catch (err) {
        console.error("Failed to fetch image", err);
      }
    }
    fetchImage();
  }, [threadId, report.image_path]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoRedo.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        undoRedo.redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undoRedo]);

  // ── Finding CRUD → push to undo stack ──
  const pushSnapshot = useCallback(
    (newFindings: Finding[], newBrushStrokes?: BrushStroke[]) => {
      undoRedo.push({
        findings: newFindings,
        brushStrokes: newBrushStrokes ?? brushStrokes,
      });
    },
    [undoRedo, brushStrokes],
  );

  const handleFindingUpdate = useCallback(
    (id: string, patch: Partial<Finding>) => {
      const updated = editableFindings.map((f) => (f.id === id ? { ...f, ...patch } : f));
      pushSnapshot(updated);
    },
    [editableFindings, pushSnapshot],
  );

  const handleFindingDelete = useCallback(
    (id: string) => {
      const updated = editableFindings.filter((f) => f.id !== id);
      pushSnapshot(updated);
      if (selectedId === id) setSelectedId(null);
    },
    [editableFindings, pushSnapshot, selectedId],
  );

  // When doctor draws a rect → show form
  const handlePendingRect = useCallback(
    (bbox: [number, number, number, number]) => {
      setPendingBbox(bbox);
      setTool("pointer"); // Switch away from rect mode
    },
    [],
  );

  // When doctor submits the new finding form
  const handleNewFindingSubmit = useCallback(
    (data: { disease: string; location_cn: string }) => {
      if (!pendingBbox) return;
      const newFinding: Finding = {
        id: generateId(),
        disease: data.disease,
        confidence: 1.0,
        bbox: pendingBbox,
        location_cn: data.location_cn,
        doctor_note: "",
        reviewed_by_doctor: true,
      };
      pushSnapshot([...editableFindings, newFinding]);
      setSelectedId(newFinding.id);
      setPendingBbox(null);
    },
    [pendingBbox, editableFindings, pushSnapshot],
  );

  const handleNewFindingCancel = useCallback(() => {
    setPendingBbox(null);
  }, []);

  // Brush CRUD
  const handleBrushStrokeAdd = useCallback(
    (stroke: BrushStroke) => {
      undoRedo.push({
        findings: editableFindings,
        brushStrokes: [...brushStrokes, stroke],
      });
    },
    [undoRedo, editableFindings, brushStrokes],
  );

  // DenseNet probs
  const [densenetProbs, setDensenetProbs] = useState<Record<string, number>>(
    report.doctor_result?.densenet_probs || report.ai_result?.densenet_probs || {}
  );
  const aiDensenetProbs = report.ai_result?.densenet_probs || {};

  // ── Submit ──
  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const doctorResult = {
        findings: editableFindings,
        brush_strokes: brushStrokes,
        densenet_probs: densenetProbs,
        doctor_comment: doctorComment,
        conclusion,
      };
      await submitImagingReview(threadId, report.report_id, doctorResult);
      await queryClient.invalidateQueries({
        queryKey: ["imaging_reports", threadId],
      });
      toast.success("审核结果已提交");
      onReviewComplete?.({ ...report, doctor_result: doctorResult, status: "reviewed" });
    } catch (error) {
      console.error("Failed to submit review:", error);
      toast.error("提交失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    threadId, report, editableFindings, brushStrokes,
    doctorComment, conclusion, queryClient, onReviewComplete, densenetProbs
  ]);

  // ── Generate Draft (Copilot) ──
  const handleGenerateDraft = useCallback(async () => {
    setIsGeneratingDraft(true);
    try {
      const draftReqData = {
        findings: editableFindings,
        densenet_probs: densenetProbs,
      };
      const res = await generateImagingDraft(threadId, draftReqData, copilotPrompt);
      setDoctorComment((prev) => {
        const p = prev.trim();
        return p ? `${p}\n\n${res.report_text}` : res.report_text;
      });
      toast.success("已生成报告草稿");
      setCopilotPrompt("");
    } catch (err) {
      console.error(err);
      toast.error("生成失败请重试");
    } finally {
      setIsGeneratingDraft(false);
    }
  }, [threadId, editableFindings, densenetProbs, copilotPrompt]);



  const [newDisease, setNewDisease] = useState("");
  const handleAddDisease = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newDisease.trim()) return;
    setDensenetProbs(prev => ({
      ...prev,
      [newDisease.trim()]: 0.5
    }));
    setNewDisease("");
  }, [newDisease]);

  const handleDeleteDisease = useCallback((disease: string) => {
    setDensenetProbs(prev => {
      const next = { ...prev };
      delete next[disease];
      return next;
    });
  }, []);

  return (
    <Artifact className={cn("flex flex-col bg-[#FDFBF7] shadow-sm", className)}>
      <ArtifactHeader className="px-3 border-b border-slate-200 shrink-0 bg-white">
        <div className="flex items-center gap-2 text-foreground">
          <ScanLineIcon className="w-4 h-4 text-primary" />
          <ArtifactTitle className="font-medium text-sm text-slate-800">影像审核台</ArtifactTitle>
          <span className="ml-2 px-2 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 border border-amber-200 rounded-full">
            {(report as any).version > 0 ? `重编辑 v${(report as any).version}` : "待审核"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <CanvasToolbar
            tool={tool}
            onToolChange={setTool}
            readonly={false}
            canUndo={undoRedo.canUndo}
            canRedo={undoRedo.canRedo}
            onUndo={undoRedo.undo}
            onRedo={undoRedo.redo}
          />
          <ArtifactActions>
            <ArtifactAction
              icon={XIcon}
              label={t.common.close}
              onClick={() => onClose?.()}
              tooltip={t.common.close}
            />
          </ArtifactActions>
        </div>
      </ArtifactHeader>

      <ArtifactContent className="flex-1 overflow-y-auto p-4 space-y-6 bg-[#FDFBF7]">
        {/* 1. Canvas */}
        <div className="w-full aspect-square rounded-lg border border-slate-200 bg-slate-100 overflow-hidden shadow-sm">
          {imageUrl ? (
            <BboxCanvas
              imageUrl={imageUrl}
              findings={editableFindings}
              brushStrokes={brushStrokes}
              pendingBbox={pendingBbox}
              selectedId={selectedId}
              readonly={false}
              tool={tool}
              onFindingUpdate={handleFindingUpdate}
              onPendingRect={handlePendingRect}
              onFindingDelete={handleFindingDelete}
              onFindingSelect={setSelectedId}
              onBrushStrokeAdd={handleBrushStrokeAdd}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full opacity-50">
              <Loader2Icon className="w-8 h-8 mb-2 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">加载影像中...</p>
            </div>
          )}
        </div>

        {/* 2. New Finding Form (when pending bbox exists) */}
        {pendingBbox && (
          <NewFindingForm
            onSubmit={handleNewFindingSubmit}
            onCancel={handleNewFindingCancel}
          />
        )}

        {/* 3. Findings cards */}
        <FindingsList
          findings={editableFindings}
          selectedId={selectedId}
          readonly={false}
          onSelect={setSelectedId}
          onUpdate={handleFindingUpdate}
          onDelete={handleFindingDelete}
          onAddNew={() => setTool("rect")}
        />

        {/* 4. DenseNet probabilities (Clinical Dumbbell Chart) */}
        <div className="space-y-4 pt-2">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-medium text-muted-foreground tracking-wider uppercase">
              鉴别诊断分布 (Dumbbell)
            </h3>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-50/80 px-2 py-1 rounded-sm border border-slate-200 shadow-sm" title="琥珀色点代表AI最初的判断概率">
              <div className="w-2 h-2 rounded-full bg-amber-400"></div>
              <span>AI 初始预测节点</span>
            </div>
          </div>
          
          <div className="space-y-1 bg-slate-50/50 p-3 rounded-xl border border-slate-100 divide-y divide-slate-100">
            {Object.keys(densenetProbs).length === 0 && (
              <p className="text-xs text-slate-400 text-center py-4">暂无鉴别诊断数据</p>
            )}
            
            {Object.entries(densenetProbs).map(([disease, prob]: [string, any]) => {
              const docProb = prob * 100;
              const aiProbOriginal = aiDensenetProbs[disease];
              const aiProb = aiProbOriginal !== undefined ? aiProbOriginal * 100 : undefined;
              
              return (
                <div key={disease} className="group relative flex flex-col gap-1.5 py-2.5 px-2 hover:bg-white hover:rounded-lg hover:shadow-xs transition-colors border border-transparent hover:border-slate-200">
                  <div className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleDeleteDisease(disease)}
                        className="opacity-0 group-hover:opacity-100 p-1 -ml-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-all"
                        title="删除该诊断"
                      >
                        <XIcon className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-slate-700 font-medium font-mono">{disease}</span>
                    </div>
                    
                    <div className="flex items-center gap-3 font-mono text-[10px]">
                      {aiProb !== undefined && (
                        <span className="text-amber-500 bg-amber-50/50 px-1.5 py-0.5 rounded" title="机器初始预测概率">
                          AI: {aiProb.toFixed(1)}%
                        </span>
                      )}
                      <div className="flex items-center gap-0.5 text-sky-600 bg-sky-50 px-1 py-0.5 rounded border border-sky-100 focus-within:ring-1 focus-within:ring-sky-400/50 transition-all">
                        <input
                          type="number"
                          value={docProb.toFixed(1)}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) setDensenetProbs(p => ({ ...p, [disease]: Math.max(0, Math.min(100, val)) / 100 }));
                          }}
                          className="w-10 bg-transparent text-right outline-none appearance-none"
                          step="0.1"
                          min="0"
                          max="100"
                        />
                        <span className="pr-1">%</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Dumbbell Chart Track */}
                  <div className="relative h-4 mt-0.5 flex items-center shrink-0">
                    {/* Background faint track */}
                    <div className="absolute left-0 right-0 h-[3px] bg-slate-200/80 rounded-full pointer-events-none"></div>
                    
                    {/* Shift Line (Connection between AI and Doc) */}
                    {aiProb !== undefined && Math.abs(docProb - aiProb) > 0.5 && (
                      <div 
                        className={cn(
                          "absolute h-[3px] rounded-full z-10 opacity-80 pointer-events-none transition-all",
                          docProb > aiProb ? "bg-sky-400" : "bg-rose-400"
                        )}
                        style={{
                          left: `calc(${Math.min(docProb, aiProb)}%)`,
                          width: `calc(${Math.abs(docProb - aiProb)}%)`
                        }}
                      />
                    )}
                    
                    {/* AI Node (Static) */}
                    {aiProb !== undefined && (
                      <div 
                        className="absolute w-2 h-2 rounded-full bg-amber-400 shadow-sm z-20 pointer-events-none transition-all"
                        style={{ left: `calc(${aiProb}% - 4px)` }}
                        title={`AI: ${aiProb.toFixed(1)}%`}
                      />
                    )}
                    
                    {/* Doctor Node (Interactive Slider using CSS arbitrary variants) */}
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.001"
                      value={prob}
                      title="拖动修正概率"
                      onChange={(e) => {
                        setDensenetProbs(p => ({ ...p, [disease]: parseFloat(e.target.value) }));
                      }}
                      className={cn(
                        "absolute inset-0 w-full h-full appearance-none bg-transparent cursor-pointer z-30 outline-none",
                        "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3",
                        "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-sky-500 [&::-webkit-slider-thumb]:border-2",
                        "[&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-transform",
                        "[&::-webkit-slider-thumb]:hover:scale-125",
                        "[&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3",
                        "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-sky-500 [&::-moz-range-thumb]:border-2",
                        "[&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-sm [&::-moz-range-thumb]:transition-transform",
                        "[&::-moz-range-thumb]:hover:scale-125"
                      )}
                    />
                  </div>
                </div>
              );
            })}
            
            {/* Add New Form */}
            <form onSubmit={handleAddDisease} className="pt-3 mt-1 border-t border-slate-200/60 flex items-center gap-2">
              <input
                type="text"
                placeholder="新增其他疾病评估..."
                value={newDisease}
                onChange={e => setNewDisease(e.target.value)}
                className="flex-1 text-xs px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/50 transition-all font-mono placeholder:text-slate-400"
              />
              <Button type="submit" variant="outline" size="sm" className="h-[34px] text-xs px-3 bg-white hover:bg-slate-50 text-slate-600 shrink-0 border-slate-200" disabled={!newDisease.trim()}>
                添加诊断
              </Button>
            </form>
          </div>
        </div>

        {/* 5. Doctor input & Copilot */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-muted-foreground tracking-wider uppercase">
              诊断意见
            </h3>
            {/* AI Copilot Inline Trigger */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="例如: 重点描述右下肺..."
                value={copilotPrompt}
                onChange={e => setCopilotPrompt(e.target.value)}
                className="text-[11px] px-2 py-1 w-36 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-sky-400 focus:bg-white transition-all shadow-sm"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleGenerateDraft}
                disabled={isGeneratingDraft}
                className="h-7 text-[11px] px-2.5 bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100 hover:text-sky-800"
              >
                {isGeneratingDraft ? <Loader2Icon className="w-3 h-3 animate-spin" /> : "✨ 生成放射报告草稿"}
              </Button>
            </div>
          </div>
          <Textarea
            placeholder="输入最终影像学诊断意见..."
            value={doctorComment}
            onChange={(e) => setDoctorComment(e.target.value)}
            className="min-h-[100px] resize-none bg-white border-slate-200 text-sm text-slate-800 focus-visible:ring-1 focus-visible:ring-primary/50 shadow-sm"
          />
          <div className="flex gap-2 p-1 bg-slate-100/80 rounded-lg border border-slate-200 w-fit">
            {(["normal", "abnormal", "pending"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setConclusion(opt)}
                className={cn(
                  "px-4 py-1.5 text-xs font-medium rounded-md transition-all",
                  conclusion === opt
                    ? "bg-white shadow-sm text-slate-900 border border-slate-200/50"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/50",
                )}
              >
                {opt === "normal" ? "正常" : opt === "abnormal" ? "异常" : "待定"}
              </button>
            ))}
          </div>
        </div>
      </ArtifactContent>

      <div className="p-4 border-t border-slate-200 flex justify-end gap-3 shrink-0 bg-white">
        <Button
          variant="outline"
          className="border-slate-200 text-slate-700 hover:bg-slate-50"
          size="sm"
          onClick={() => toast.info("草稿已保存")}
        >
          保存草稿
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {isSubmitting ? "提交中..." : "确认提交"}
        </Button>
      </div>
    </Artifact>
  );
}
