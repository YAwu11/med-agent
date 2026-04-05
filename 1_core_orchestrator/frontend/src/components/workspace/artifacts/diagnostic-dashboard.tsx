import { CheckCircleIcon, FileImageIcon, FileTextIcon, FlaskConicalIcon, PlayIcon, ShieldAlertIcon } from "lucide-react";
import { useCallback } from "react";
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
import { cn } from "@/lib/utils";

type SummaryFinding = {
  confidence?: number;
  disease?: string;
  location?: string;
  location_cn?: string;
};

type SummaryDoctorResult = {
  conclusion?: "abnormal" | "normal" | "pending";
  doctor_comment?: string;
  findings?: SummaryFinding[];
};

export function DiagnosticDashboard({
  className,
  threadId,
  pendingImaging,
  reviewedImaging,
  onClose,
  onOpenImagingReview,
  onOpenImagingViewer,
  onGenerateGlobalDiagnosis,
}: {
  className?: string;
  threadId: string;
  pendingImaging: ImagingReport | null;
  reviewedImaging: ImagingReport[];
  onClose?: () => void;
  onOpenImagingReview: () => void;
  onOpenImagingViewer: () => void;
  onGenerateGlobalDiagnosis: (summary: string) => void;
}) {

  const imagingStatus = pendingImaging ? "pending" : (reviewedImaging.length > 0 ? "reviewed" : "none");

  const handleGenerate = useCallback(() => {
    if (imagingStatus === "pending") {
      toast.error("仍有未审核的影像资料，请先完成审核");
      return;
    }

    // Build the grand summary
    let summary = "";
    if (reviewedImaging.length > 0) {
      const latest = reviewedImaging[reviewedImaging.length - 1];
      const docResult: SummaryDoctorResult = latest?.doctor_result ?? {};
      const findings = docResult.findings ?? [];
      const summaryParts = findings.map(
        (f) => `${f.disease ?? "未知病灶"}(${f.confidence !== undefined ? (f.confidence * 100).toFixed(0) + "%" : "极大概率"}, ${f.location_cn ?? f.location ?? "未知"})`
      );
      summary += `【影像学所见】:\n检出 ${findings.length} 个病灶: ${summaryParts.join("、")}。\n`;
      summary += `医生评估: ${docResult.conclusion === "normal" ? "正常" : docResult.conclusion === "abnormal" ? "异常" : "待定"}。\n`;
      if (docResult.doctor_comment) {
        summary += `附加说明: ${docResult.doctor_comment}\n`;
      }
    } else {
      summary += "【影像资料】: 未上传或无异常。\n";
    }

    summary += "\n【化验单】: (模块建设中，暂无异常)\n【电子病历】: (模块建设中，暂无特殊病史)\n";

    onGenerateGlobalDiagnosis(summary);
    toast.success("已提交全体证据资料，主 Agent 正在进行综合研判...");

  }, [imagingStatus, reviewedImaging, onGenerateGlobalDiagnosis]);

  return (
    <Artifact className={cn("flex flex-col bg-[#FDFBF7] shadow-sm", className)}>
      <ArtifactHeader className="px-3 border-b border-slate-200 shrink-0 bg-white">
        <div className="flex items-center gap-2 text-foreground">
          <ShieldAlertIcon className="w-4 h-4 text-sky-600" />
          <ArtifactTitle className="font-medium text-sm text-slate-800">总控诊断台 (Diagnostic Desk)</ArtifactTitle>
        </div>
      </ArtifactHeader>

      <ArtifactContent className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50/50">

        <div className="space-y-4">
          <h3 className="text-xs font-medium text-muted-foreground tracking-wider uppercase pl-1">
            多模态证据审核列阵
          </h3>

          <div className="grid gap-3">
            {/* 影像模块卡片 */}
            <div className={cn(
              "p-4 rounded-xl border flex items-center justify-between transition-all",
              imagingStatus === "pending" ? "bg-amber-50/50 border-amber-200" :
                imagingStatus === "reviewed" ? "bg-green-50/50 border-green-200 shadow-sm" :
                  "bg-white border-slate-200 opacity-60"
            )}>
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-2 rounded-lg",
                  imagingStatus === "pending" ? "bg-amber-100 text-amber-700" :
                    imagingStatus === "reviewed" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"
                )}>
                  <FileImageIcon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-slate-800">医学影像 (PACS)</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {imagingStatus === "pending" ? "包含未审核的新图" :
                      imagingStatus === "reviewed" ? `已完成 ${reviewedImaging.length} 份报告审核` : "暂无影像资料"}
                  </p>
                </div>
              </div>

              <div>
                {imagingStatus === "pending" && (
                  <Button size="sm" onClick={onOpenImagingReview} className="bg-amber-500 hover:bg-amber-600 text-white shadow-sm text-xs h-7 px-3">
                    立即审核
                  </Button>
                )}
                {imagingStatus === "reviewed" && (
                  <Button size="sm" variant="outline" onClick={onOpenImagingViewer} className="border-green-200 text-green-700 hover:bg-green-50 text-xs h-7 px-3 gap-1.5">
                    <CheckCircleIcon className="w-3.5 h-3.5" />
                    查看并修改
                  </Button>
                )}
              </div>
            </div>

            {/* 化验单预留卡片 */}
            <div className="p-4 rounded-xl border border-slate-200 bg-white opacity-50 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-slate-100 text-slate-400">
                  <FlaskConicalIcon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-slate-800">化验单 (LIS)</h4>
                  <p className="text-xs text-slate-500 mt-0.5">模块建设中</p>
                </div>
              </div>
            </div>

            {/* 病历预留卡片 */}
            <div className="p-4 rounded-xl border border-slate-200 bg-white opacity-50 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-slate-100 text-slate-400">
                  <FileTextIcon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-slate-800">电子病历 (EMR)</h4>
                  <p className="text-xs text-slate-500 mt-0.5">模块建设中</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 动态提示框 */}
        <div className="bg-sky-50 border border-sky-100 rounded-lg p-3 text-sm text-sky-800">
          <p>请在此聚合所有模态信息。只有医生您确认全部审核无误后，主诊断大脑才会收到指令并出具最权威的报告。</p>
        </div>

      </ArtifactContent>

      <div className="p-4 border-t border-slate-200 bg-white flex flex-col gap-2 shrink-0">
        <Button
          size="lg"
          onClick={handleGenerate}
          className={cn(
            "w-full gap-2 font-medium transition-all shadow-md",
            imagingStatus === "pending" ? "bg-slate-300 pointer-events-none" : "bg-sky-600 hover:bg-sky-700 text-white"
          )}
        >
          <PlayIcon className="w-4 h-4 fill-current" />
          ✨ 生成终极综合诊断
        </Button>
        {imagingStatus === "pending" && (
          <p className="text-[10px] text-amber-600 text-center w-full">⚠️ 等待影像审核完毕后方可解锁</p>
        )}
      </div>
    </Artifact>
  );
}
