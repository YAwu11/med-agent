import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "http://backend.test",
}));

import { ImagingViewer } from "../ImagingViewer";

describe("ImagingViewer", () => {
  it("renders summary, probability, and rejected candidate details from structured data", () => {
    render(
      <ImagingViewer
        initialStructuredData={{
          image_path: "/artifacts/chest.png",
          findings: [
            {
              id: "finding-1",
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
        }}
      />,
    );

    expect(screen.getByText("DenseNet 疾病概率")).toBeInTheDocument();
    expect(screen.getByText("Pneumonia")).toBeInTheDocument();
    expect(screen.getAllByText("91.0%")).not.toHaveLength(0);
    expect(screen.getByText("结构化摘要")).toBeInTheDocument();
    expect(screen.getByText("病灶总数")).toBeInTheDocument();
    expect(screen.getByText("For research use only.")).toBeInTheDocument();
    expect(screen.getByText("过滤候选")).toBeInTheDocument();
    expect(screen.getByText("结节")).toBeInTheDocument();
    expect(screen.getByText("Outside lung field")).toBeInTheDocument();
  });

  it("wraps saved payload in doctor_result and normalizes missing finding ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn() });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ImagingViewer
        threadId="thread-1"
        reportId="report-1"
        mcpResult={{
          image_path: "/artifacts/chest.png",
          findings: [
            {
              name: "肺炎",
              confidence: 91,
              note: "AI 检出",
              bbox: { x: 10, y: 12, width: 20, height: 18 },
              source: "ai",
              modified: false,
              color: "red",
            } as never,
          ],
          summary: {
            total_findings: 1,
          },
          densenet_probs: {
            Pneumonia: 0.91,
          },
          rejected: [],
        }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "已保存" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.test/api/threads/thread-1/imaging-reports/report-1",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestInit).toBeDefined();
    const body = JSON.parse(String(requestInit?.body));
    expect(body).toMatchObject({
      doctor_result: {
        image_path: "/artifacts/chest.png",
        summary: { total_findings: 1 },
        densenet_probs: { Pneumonia: 0.91 },
        rejected: [],
      },
    });
    expect(body.doctor_result.findings[0].id).toBe("finding-1");
    expect(body.doctor_result.findings[0].name).toBe("肺炎");
  });
});