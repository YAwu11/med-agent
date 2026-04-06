import { CheckIcon, XIcon, MessageSquareIcon, PlusIcon, MousePointerIcon, SquareIcon, PenToolIcon, EraserIcon, Undo2Icon, Redo2Icon, UserCheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { Finding, CanvasTool } from "./bbox-canvas";

// ── Toolbar ──────────────────────────────────────────────────
export function CanvasToolbar({
  tool,
  onToolChange,
  readonly,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  tool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  readonly: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}) {
  if (readonly) return null;

  const tools: { id: CanvasTool; icon: typeof MousePointerIcon; label: string }[] = [
    { id: "pointer", icon: MousePointerIcon, label: "选择 (V)" },
    { id: "rect", icon: SquareIcon, label: "矩形 (R)" },
    { id: "brush", icon: PenToolIcon, label: "画笔 (B)" },
    { id: "eraser", icon: EraserIcon, label: "橡皮擦 (E)" },
  ];

  return (
    <div className="flex items-center gap-1 p-1 bg-white rounded-lg border border-slate-200 shadow-sm w-fit">
      {tools.map((t) => (
        <button
          key={t.id}
          onClick={() => onToolChange(t.id)}
          className={cn(
            "p-1.5 rounded-md transition-all",
            tool === t.id
              ? "bg-slate-100 text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-900 hover:bg-slate-50",
          )}
          title={t.label}
        >
          <t.icon className="w-4 h-4" />
        </button>
      ))}
      <div className="w-px h-4 bg-slate-200 mx-0.5" />
      <button
        onClick={onUndo}
        disabled={!canUndo}
        className={cn(
          "p-1.5 rounded-md transition-all",
          canUndo
            ? "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
            : "text-slate-300 cursor-not-allowed",
        )}
        title="撤回 (Ctrl+Z)"
      >
        <Undo2Icon className="w-4 h-4" />
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        className={cn(
          "p-1.5 rounded-md transition-all",
          canRedo
            ? "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
            : "text-slate-300 cursor-not-allowed",
        )}
        title="重做 (Ctrl+Shift+Z)"
      >
        <Redo2Icon className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── New Finding Form (inline) ────────────────────────────────
export function NewFindingForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: { disease: string; location_cn: string }) => void;
  onCancel: () => void;
}) {
  return (
    <div className="bg-white border border-sky-200 rounded-xl p-4 space-y-3 animate-in slide-in-from-top-2 duration-200 shadow-sm relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full bg-sky-400"></div>
      <div className="flex items-center gap-2 mb-2 pl-2">
        <UserCheckIcon className="w-4 h-4 text-sky-600" />
        <h4 className="text-sm font-medium text-sky-800">新增病灶信息</h4>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.target as HTMLFormElement;
          const disease = (form.elements.namedItem("disease") as HTMLInputElement).value.trim();
          const location_cn = (form.elements.namedItem("location_cn") as HTMLInputElement).value.trim();
          if (!disease) return;
          onSubmit({ disease, location_cn: location_cn || "待标注" });
        }}
        className="space-y-3 pl-2"
      >
        <div>
          <label className="text-xs text-slate-500 mb-1 block font-medium">病灶名称 *</label>
          <input
            name="disease"
            type="text"
            autoFocus
            placeholder="例: 肺结节、胸膜增厚..."
            className="w-full bg-slate-50 border border-slate-200 rounded-md text-sm py-2 px-3 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/50 text-slate-800 placeholder:text-slate-400 transition-all"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block font-medium">位置描述</label>
          <input
            name="location_cn"
            type="text"
            placeholder="例: 右上肺野、左下肺门旁..."
            className="w-full bg-slate-50 border border-slate-200 rounded-md text-sm py-2 px-3 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/50 text-slate-800 placeholder:text-slate-400 transition-all"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} className="text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100">
            取消
          </Button>
          <Button type="submit" size="sm" className="text-xs bg-sky-500 hover:bg-sky-600 text-white shadow-sm">
            确认添加
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Findings List ──────────────────────────────────────────────
export function FindingsList({
  findings,
  selectedId,
  readonly,
  onSelect,
  onUpdate,
  onDelete,
  onAddNew,
}: {
  findings: Finding[];
  selectedId: string | null;
  readonly: boolean;
  onSelect?: (id: string | null) => void;
  onUpdate?: (id: string, patch: Partial<Finding>) => void;
  onDelete?: (id: string) => void;
  onAddNew?: () => void;
}) {
  return (
    <div className="space-y-3">
      {findings.length > 0 && (
        <div className="flex justify-end -mb-1 mt-1">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-50/80 px-2 py-1 rounded-sm border border-slate-200 shadow-sm" title="琥珀色针形标记代表AI模型最初的推断概率">
            <div className="w-1 h-2.5 bg-amber-400 rounded-[1px]"></div>
            <span>AI 初始预测标尺</span>
          </div>
        </div>
      )}
      {findings.map((finding) => {
        const displayId = finding.id.substring(0, 4);
        const isSelected = finding.id === selectedId;
        const isDoctor = finding.reviewed_by_doctor;

        return (
          <div
            key={finding.id}
            className={cn(
              "bg-white rounded-xl border p-4 shadow-sm cursor-pointer transition-all",
              isSelected
                ? "border-sky-400 ring-1 ring-sky-400/30"
                : "border-slate-200 hover:border-slate-300",
            )}
            onClick={() => onSelect?.(finding.id)}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    isDoctor ? "bg-sky-500" : isSelected ? "bg-sky-500" : "bg-teal-500",
                  )}
                />
                {readonly ? (
                  <h4 className="font-medium text-sm text-slate-800 truncate">
                    病灶 #{displayId} · {finding.disease}
                  </h4>
                ) : (
                  <input
                    type="text"
                    value={finding.disease}
                    onChange={(e) => {
                      onUpdate?.(finding.id, {
                        disease: e.target.value,
                        reviewed_by_doctor: true,
                      });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium text-sm text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-sky-400 focus:outline-none transition-colors flex-1 min-w-0"
                  />
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {isDoctor && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-sky-50 text-sky-600 border border-sky-200 rounded-full whitespace-nowrap">
                    <UserCheckIcon className="w-3 h-3" />
                    医生
                  </span>
                )}
                <Badge
                  variant="outline"
                  className="text-xs font-mono font-medium border-slate-200 text-slate-500 bg-slate-50 whitespace-nowrap"
                >
                  {(finding.confidence * 100).toFixed(1)}%
                </Badge>
              </div>
            </div>

            {!readonly ? (
              <div className="relative mb-3 flex items-center h-4 group pb-1">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={finding.confidence}
                  title="调整概率"
                  onChange={(e) => {
                    onUpdate?.(finding.id, {
                      confidence: parseFloat(e.target.value),
                      reviewed_by_doctor: true,
                    });
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    "w-full h-1.5 rounded-full appearance-none bg-slate-200 cursor-ew-resize relative z-20",
                    "focus:outline-none focus:ring-2 focus:ring-sky-400/50",
                    isDoctor || isSelected ? "accent-sky-500" : "accent-teal-500"
                  )}
                  style={{
                    background: `linear-gradient(to right, ${isDoctor || isSelected ? '#0ea5e9' : '#14b8a6'} 0%, ${isDoctor || isSelected ? '#0ea5e9' : '#14b8a6'} ${finding.confidence * 100}%, #e2e8f0 ${finding.confidence * 100}%, #e2e8f0 100%)`
                  }}
                />
                {finding.ai_confidence !== undefined && (
                  <div 
                    className="absolute h-3.5 w-[3px] bg-amber-400 rounded-sm z-30 pointer-events-none"
                    style={{ left: `calc(${finding.ai_confidence * 100}% - 1.5px)` }}
                    title={`AI 预测概率: ${(finding.ai_confidence * 100).toFixed(1)}%`}
                  />
                )}
              </div>
            ) : (
              <div className="relative mb-3 h-4 flex items-center pb-1">
                <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden relative z-10">
                  <div 
                    className={cn("h-full rounded-full", isDoctor ? "bg-sky-500" : isSelected ? "bg-sky-500" : "bg-teal-500")}
                    style={{ width: `${finding.confidence * 100}%` }}
                  />
                </div>
                {finding.ai_confidence !== undefined && (
                  <div 
                    className="absolute h-3.5 w-[3px] bg-amber-400 rounded-sm z-20 pointer-events-none"
                    style={{ left: `calc(${finding.ai_confidence * 100}% - 1.5px)` }}
                    title={`AI 预测概率: ${(finding.ai_confidence * 100).toFixed(1)}%`}
                  />
                )}
              </div>
            )}

            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-slate-500 font-medium whitespace-nowrap">位置:</span>
              {readonly ? (
                <p className="text-xs text-slate-700 flex-1 truncate">
                  {finding.location_cn ?? finding.location ?? "待标注"}
                </p>
              ) : (
                <input
                  type="text"
                  value={finding.location_cn ?? finding.location ?? ""}
                  placeholder="待标注"
                  onChange={(e) => {
                    onUpdate?.(finding.id, {
                      location_cn: e.target.value,
                      reviewed_by_doctor: true,
                    });
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-sky-400 focus:outline-none transition-colors flex-1 min-w-0"
                />
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <MessageSquareIcon className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="添加医生批注..."
                  value={finding.doctor_note ?? ""}
                  onChange={(e) => onUpdate?.(finding.id, {
                    doctor_note: e.target.value,
                    reviewed_by_doctor: true,
                  })}
                  onClick={(e) => e.stopPropagation()}
                  readOnly={readonly}
                  className="w-full bg-slate-50 border border-slate-200 rounded-md text-xs py-2 pl-8 pr-2 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/50 text-slate-800 transition-colors placeholder:text-slate-400"
                />
              </div>
              {!readonly && (
                <>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    className="shrink-0 border-teal-200 text-teal-600 hover:bg-teal-50 hover:border-teal-300 transition-colors bg-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdate?.(finding.id, { reviewed_by_doctor: true });
                    }}
                    title="标记为已审核"
                  >
                    <CheckIcon className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    className="shrink-0 border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300 transition-colors bg-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete?.(finding.id);
                    }}
                  >
                    <XIcon className="w-4 h-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {!readonly && (
        <Button
          variant="outline"
          className="w-full border-dashed border-slate-300 text-slate-500 hover:text-slate-700 hover:border-slate-400 hover:bg-slate-50 text-xs py-6 transition-all"
          onClick={onAddNew}
        >
          <PlusIcon className="w-4 h-4 mr-2" />
          新增病灶（切换到矩形工具后在画布上绘制）
        </Button>
      )}
    </div>
  );
}
