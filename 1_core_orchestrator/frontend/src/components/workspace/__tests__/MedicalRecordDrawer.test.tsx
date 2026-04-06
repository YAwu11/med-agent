import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MedicalRecordDialog } from "../MedicalRecordDrawer";

vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "http://backend.test",
}));

vi.mock("../MedicalRecordCard", async () => {
  const React = await import("react");

  return {
    MedicalRecordCard: ({ onActionBarChange }: { onActionBarChange?: (actions: unknown) => void }) => {
      React.useEffect(() => {
        onActionBarChange?.({
          isDirty: true,
          isSaving: false,
          uploadsLoading: false,
          currentPatientInfo: {
            name: "张三",
            age: 45,
            chief_complaint: "胸痛 2 天",
          },
          onReset: vi.fn(),
          onRefreshUploads: vi.fn(),
          onSave: vi.fn(),
        });
      }, [onActionBarChange]);

      return <div>mock medical record card</div>;
    },
  };
});

describe("MedicalRecordDialog", () => {
  it("uses intake and registration copy instead of upload-analysis copy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        type: "medical_record",
        thread_id: "thread-1",
        patient_info: {},
        evidence_items: [],
        guidance: {
          stage: "ready",
          ready_for_ai_summary: true,
          missing_required_fields: [],
          pending_files: [],
          next_action: "可以确认挂号",
          status_text: "资料已准备完成",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MedicalRecordDialog threadId="thread-1" open={true} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    await screen.findByText("mock medical record card");

    expect(screen.getByText("登记与挂号确认")).toBeInTheDocument();
    expect(screen.queryByText(/识别完成后核对摘要/)).not.toBeInTheDocument();
    expect(screen.queryByText("资料较完整")).not.toBeInTheDocument();
  });

  it("prefetches record data before open, reuses the cache on reopen, and renders dialog actions in the header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        type: "medical_record",
        thread_id: "thread-1",
        patient_info: {},
        evidence_items: [],
        guidance: {
          stage: "collecting_info",
          ready_for_ai_summary: false,
          missing_required_fields: [],
          pending_files: [],
          next_action: "继续补充",
          status_text: "仍在补充中",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <MedicalRecordDialog threadId="thread-1" open={false} onClose={vi.fn()} />,
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    rerender(
      <QueryClientProvider client={queryClient}>
        <MedicalRecordDialog threadId="thread-1" open={true} onClose={vi.fn()} />,
      </QueryClientProvider>,
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <MedicalRecordDialog threadId="thread-1" open={false} onClose={vi.fn()} />,
      </QueryClientProvider>,
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <MedicalRecordDialog threadId="thread-1" open={true} onClose={vi.fn()} />,
      </QueryClientProvider>,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(screen.queryByText("正在加载病例页...")).not.toBeInTheDocument();
    expect(await screen.findByText("mock medical record card")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复未保存" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新资料" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存更改" })).toBeInTheDocument();
  });

  it("reuses the medical record drawer as the appointment confirmation surface", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/confirm-appointment")) {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            success: true,
            case_id: "case-1",
            short_id: "case-1",
            department: "呼吸内科",
            evidence_count: 1,
            message: "挂号成功",
          }),
        } as unknown as Response);
      }

      return Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue({
          type: "medical_record",
          thread_id: "thread-1",
          patient_info: {},
          evidence_items: [],
          guidance: {
            stage: "ready",
            ready_for_ai_summary: true,
            missing_required_fields: [],
            pending_files: [],
            next_action: "可以确认挂号",
            status_text: "资料已准备完成",
          },
        }),
      } as unknown as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MedicalRecordDialog
          threadId="thread-1"
          open={true}
          onClose={vi.fn()}
          appointmentPreviewData={{
            type: "appointment_preview",
            thread_id: "thread-1",
            patient_info: { name: "张三", age: 45 },
            evidence_items: [{ id: "ev-1", type: "lab_report", title: "化验单" }],
            suggested_priority: "medium",
            suggested_department: "呼吸内科",
            reason: "胸痛 2 天",
          }}
        />
      </QueryClientProvider>,
    );

    const confirmButton = await screen.findByRole("button", { name: "确认挂号" });
    await userEvent.click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/threads/thread-1/confirm-appointment"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            patient_info: {
              name: "张三",
              age: 45,
              chief_complaint: "胸痛 2 天",
            },
            selected_evidence_ids: ["ev-1"],
            priority: "medium",
            department: "呼吸内科",
            reason: "胸痛 2 天",
          }),
        }),
      );
    });
  });
});