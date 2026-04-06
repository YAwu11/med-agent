import { ImagingViewer, type McpAnalysisResult } from "@/components/doctor/ImagingViewer";

const mockImagingResult = {
  image_path: "/mock/chest-xray-demo.svg",
  findings: [
    {
      name: "肺炎",
      confidence: 91,
      note: "AI 检出",
      bbox: { x: 10, y: 12, width: 20, height: 18 },
      source: "ai",
      modified: false,
      color: "red",
    },
  ],
  summary: {
    total_findings: 1,
    disease_breakdown: { 肺炎: 1 },
    bilateral_diseases: ["肺炎"],
  },
  densenet_probs: {
    Pneumonia: 0.91,
    Effusion: 0.34,
  },
  rejected: [
    {
      disease: "结节",
      reason: "Outside lung field",
      confidence: 0.25,
    },
  ],
  disclaimer: "For research use only.",
  pipeline: "Pipeline V3",
} as unknown as McpAnalysisResult;

export default function DoctorImagingReviewMockPage() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Doctor Imaging Review Test Harness</h1>
          <p className="mt-1 text-sm text-slate-500">
            Stable browser-only route for Playwright regression of the doctor imaging review shell.
          </p>
        </header>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <ImagingViewer
            threadId="thread-e2e"
            reportId="report-e2e"
            mcpResult={mockImagingResult}
          />
        </section>
      </div>
    </main>
  );
}