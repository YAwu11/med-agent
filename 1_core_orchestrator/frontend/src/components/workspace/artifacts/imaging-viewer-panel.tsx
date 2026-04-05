import { ScanLineIcon, XIcon, EditIcon, RefreshCwIcon, CheckCircleIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Artifact,
  ArtifactContent,
  ArtifactHeader,
  ArtifactTitle,
  ArtifactActions,
  ArtifactAction,
} from "@/components/ai-elements/artifact";
import { Button } from "@/components/ui/button";
import type { ImagingReport } from "@/core/imaging/api";
import { listUploadedFiles } from "@/core/uploads/api";
import { cn } from "@/lib/utils";

import { BboxCanvas, type Finding, type BrushStroke } from "./bbox-canvas";
import { FindingsList } from "./findings-list";

type ViewerFindingInput = Partial<Finding> & {
  disease?: string;
};

type ViewerBrushStrokeInput = Partial<BrushStroke> & {
  tool?: string;
  width?: number;
};

export function ImagingViewerPanel({
  className,
  threadId,
  report,
  onClose,
  onReEdit,
  onReJudge,
}: {
  className?: string;
  threadId: string;
  report: ImagingReport;
  onClose?: () => void;
  onReEdit?: (report: ImagingReport) => void;
  onReJudge?: (summary: string) => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const doctorResult = report.doctor_result ?? {};
  const rawFindings = (doctorResult.findings ?? report.ai_result?.findings ?? []) as ViewerFindingInput[];
  const findings: Finding[] = rawFindings.map((finding, index) => ({
    ...finding,
    bbox: finding.bbox ?? [0, 0, 0, 0],
    confidence: finding.confidence ?? 0,
    disease: finding.disease ?? "",
    id: finding.id ?? `finding_${index}`,
  }));
  const rawBrushStrokes = (doctorResult.brush_strokes ?? []) as ViewerBrushStrokeInput[];
  const brushStrokes: BrushStroke[] = rawBrushStrokes.map((brush, index) => ({
    color: brush.color ?? "#ff6b6b",
    id: brush.id ?? `stroke_${index}`,
    points: brush.points ?? [],
    strokeWidth: brush.strokeWidth ?? brush.width ?? 2,
    tool: brush.tool === "eraser" ? "eraser" : "brush",
  }));
  const version = report.version ?? 1;
  const doctorComment = doctorResult.doctor_comment ?? "";
  const conclusion = doctorResult.conclusion ?? "pending";

  // Fetch image URL
  useEffect(() => {
    async function fetchImage() {
      try {
        const res = await listUploadedFiles(threadId);
        const filename = report.image_path.split(/[/\\]/).pop();
        const file = res.files.find((f) => f.filename === filename);
        if (file) setImageUrl(file.artifact_url);
      } catch (err) {
        console.error("Failed to list files for image", err);
      }
    }
    void fetchImage();
  }, [threadId, report.image_path]);

  // Re-Judge trigger removed in Phase 6: All re-judging now happens at the unified Dashboard level.

  const conclusionLabel = conclusion === "normal" ? "正常" : conclusion === "abnormal" ? "异常" : "待定";
  const conclusionColor = conclusion === "normal" ? "text-green-400" : conclusion === "abnormal" ? "text-amber-400" : "text-muted-foreground";

  return (
    <Artifact className={cn("flex flex-col bg-[#FDFBF7] shadow-sm", className)}>
      <ArtifactHeader className="px-3 border-b border-slate-200 shrink-0 bg-white">
        <div className="flex items-center gap-2 text-foreground">
          <ScanLineIcon className="w-4 h-4 text-primary" />
          <ArtifactTitle className="font-medium text-sm text-slate-800">影像诊断</ArtifactTitle>
          <span className="ml-1 px-2 py-0.5 text-[10px] font-medium bg-green-50 text-green-600 border border-green-200 rounded-full flex items-center gap-1">
            <CheckCircleIcon className="w-3 h-3" />
            已审核 v{version}
          </span>
        </div>
        <ArtifactActions>
          <ArtifactAction icon={XIcon} label="关闭" onClick={() => onClose?.()} tooltip="关闭" />
        </ArtifactActions>
      </ArtifactHeader>

      <ArtifactContent className="flex-1 overflow-y-auto p-4 space-y-6 bg-[#FDFBF7]">
        {/* Canvas (readonly) */}
        <div className="w-full aspect-square rounded-lg border border-slate-200 bg-slate-100 overflow-hidden shadow-sm">
          {imageUrl ? (
            <BboxCanvas
              imageUrl={imageUrl}
              findings={findings}
              brushStrokes={brushStrokes}
              selectedId={selectedId}
              readonly={true}
              tool="pointer"
              onFindingSelect={setSelectedId}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              加载影像中...
            </div>
          )}
        </div>

        {/* Conclusion banner */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">诊断结论</span>
            <span className={cn("text-sm font-bold", conclusionColor)}>{conclusionLabel}</span>
          </div>
          {doctorComment && (
            <p className="mt-2 text-sm text-slate-700">{doctorComment}</p>
          )}
        </div>

        {/* Findings list (readonly) */}
        <FindingsList
          findings={findings}
          selectedId={selectedId}
          readonly={true}
          onSelect={setSelectedId}
        />
      </ArtifactContent>

      {/* Action bar */}
      <div className="p-4 border-t border-slate-200 flex justify-end gap-3 shrink-0 bg-white">
        <Button
          variant="outline"
          className="border-slate-200 text-slate-700 hover:bg-slate-50 gap-1.5"
          size="sm"
          onClick={() => onReEdit?.(report)}
        >
          <EditIcon className="w-3.5 h-3.5" />
          重新编辑
        </Button>
      </div>
    </Artifact>
  );
}
