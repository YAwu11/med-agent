import { FileImageIcon, FileTextIcon, ShieldAlertIcon } from "lucide-react";

import { resolveArtifactURL } from "@/core/artifacts/utils";

interface BrainArtifactSpatialInfo {
  location?: string | null;
  clinical_warning?: string | null;
  volumes?: {
    ET?: number | null;
    ED?: number | null;
    NCR?: number | null;
    WT?: number | null;
  } | null;
  spatial_relations?: {
    crosses_midline?: boolean | null;
    brainstem_min_dist_mm?: number | null;
    ventricle_compression_ratio?: number | null;
    midline_shift_mm?: number | null;
  } | null;
}

interface BrainArtifactSource {
  report_id?: string;
  status?: string;
  pipeline?: string;
  viewer_kind?: string;
  modality?: string;
  image_path?: string;
  slice_png_path?: string;
  source_upload_filename?: string;
  report_text?: string;
  spatial_info?: BrainArtifactSpatialInfo | null;
  ai_result?: {
    findings?: unknown[];
  };
  doctor_result?: {
    report_text?: string;
    spatial_info?: BrainArtifactSpatialInfo | null;
    slice_png_path?: string;
  };
}

export interface BrainArtifactReport {
  reportId: string;
  status: string;
  pipeline?: string;
  viewerKind?: string;
  modality?: string;
  sourceUploadFilename?: string;
  slicePngPath?: string;
  spatialInfo?: BrainArtifactSpatialInfo;
  reportText?: string;
  findingsBrief?: string;
  findingsCount: number;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function summarizeFindings(findings: unknown[] | undefined): {
  findingsBrief?: string;
  findingsCount: number;
} {
  if (!Array.isArray(findings)) {
    return { findingsCount: 0 };
  }

  const labels = findings
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return toText(record.label ?? record.class ?? record.disease);
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 5);

  return {
    findingsCount: findings.length,
    findingsBrief: labels.length > 0 ? labels.join("；") : undefined,
  };
}

function normalizeStatusLabel(status: string): string {
  switch (status) {
    case "reviewed":
      return "已医生复核";
    case "pending_review":
    case "pending_doctor_review":
      return "待医生复核";
    case "processing":
    case "queued":
    case "running":
      return "处理中";
    case "failed":
    case "error":
      return "处理失败";
    default:
      return "已完成";
  }
}

export function extractBrainArtifactReport(content: string): BrainArtifactReport | null {
  if (!content.trim().startsWith("{")) {
    return null;
  }

  let parsed: BrainArtifactSource;
  try {
    parsed = JSON.parse(content) as BrainArtifactSource;
  } catch {
    return null;
  }

  const pipeline = toText(parsed.pipeline);
  const viewerKind = toText(parsed.viewer_kind);
  const modality = toText(parsed.modality);
  const isBrainArtifact =
    pipeline === "brain_nifti_v1" ||
    viewerKind === "brain_spatial_review" ||
    modality.startsWith("brain_mri");

  if (!isBrainArtifact) {
    return null;
  }

  const doctorResult = parsed.doctor_result ?? {};
  const spatialInfo =
    (parsed.spatial_info as BrainArtifactSpatialInfo | undefined) ??
    (doctorResult.spatial_info as BrainArtifactSpatialInfo | undefined);
  const slicePngPath =
    toText(parsed.slice_png_path) ||
    toText(doctorResult.slice_png_path) ||
    toText(parsed.image_path);
  const reportText = toText(parsed.report_text) || toText(doctorResult.report_text);
  const findingsSummary = summarizeFindings(parsed.ai_result?.findings);

  return {
    reportId: toText(parsed.report_id) || "brain-report",
    status: toText(parsed.status) || "pending_review",
    pipeline: pipeline || undefined,
    viewerKind: viewerKind || undefined,
    modality: modality || undefined,
    sourceUploadFilename: toText(parsed.source_upload_filename) || undefined,
    slicePngPath: slicePngPath || undefined,
    spatialInfo,
    reportText: reportText || undefined,
    findingsBrief: findingsSummary.findingsBrief,
    findingsCount: findingsSummary.findingsCount,
  };
}

function buildArtifactImageUrl(threadId: string, imagePath?: string): string | null {
  if (!imagePath) return null;
  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    return imagePath;
  }
  const normalized = imagePath.startsWith("/") ? imagePath : `/${imagePath}`;
  return resolveArtifactURL(normalized, threadId);
}

function MetricRow({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  if (value === null || value === undefined || value === "") return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-800">{value}</div>
    </div>
  );
}

export function BrainArtifactViewer({
  report,
  threadId,
}: {
  report: BrainArtifactReport;
  threadId: string;
}) {
  const imageUrl = buildArtifactImageUrl(threadId, report.slicePngPath);
  const volumes = report.spatialInfo?.volumes;
  const relations = report.spatialInfo?.spatial_relations;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(241,245,249,0.92))] p-4">
      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
            <FileImageIcon className="h-4 w-4 text-cyan-700" />
            脑 MRI 切片预览
          </div>
          <div className="flex min-h-[320px] items-center justify-center bg-slate-950 p-4">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt="Brain MRI slice preview"
                className="max-h-[520px] w-full rounded-xl object-contain"
              />
            ) : (
              <div className="text-sm text-slate-300">当前报告未附带切片预览</div>
            )}
          </div>
        </section>

        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-semibold text-cyan-800">
                脑 MRI 3D 报告
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {normalizeStatusLabel(report.status)}
              </span>
            </div>
            {report.sourceUploadFilename ? (
              <p className="mt-3 text-sm text-slate-600">源文件：{report.sourceUploadFilename}</p>
            ) : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <MetricRow label="定位区域" value={report.spatialInfo?.location} />
              <MetricRow label="病灶数量" value={report.findingsCount > 0 ? report.findingsCount : null} />
              <MetricRow label="管线" value={report.pipeline} />
              <MetricRow label="查看器" value={report.viewerKind} />
            </div>
            {report.findingsBrief ? (
              <div className="mt-4 rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-3 text-sm text-slate-700">
                关键发现：{report.findingsBrief}
              </div>
            ) : null}
            {report.spatialInfo?.clinical_warning ? (
              <div className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{report.spatialInfo.clinical_warning}</span>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <FileTextIcon className="h-4 w-4 text-cyan-700" />
              空间摘要
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <MetricRow label="ET 体积" value={volumes?.ET} />
              <MetricRow label="ED 体积" value={volumes?.ED} />
              <MetricRow label="NCR 体积" value={volumes?.NCR} />
              <MetricRow label="WT 体积" value={volumes?.WT} />
              <MetricRow label="中线移位 (mm)" value={relations?.midline_shift_mm} />
              <MetricRow label="脑干最小距离 (mm)" value={relations?.brainstem_min_dist_mm} />
              <MetricRow label="脑室压迫比" value={relations?.ventricle_compression_ratio} />
              <MetricRow
                label="跨越中线"
                value={
                  relations?.crosses_midline === undefined || relations?.crosses_midline === null
                    ? null
                    : relations.crosses_midline
                      ? "是"
                      : "否"
                }
              />
            </div>
          </section>

          {report.reportText ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <FileTextIcon className="h-4 w-4 text-cyan-700" />
                报告文本
              </div>
              <p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-700">{report.reportText}</p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}