import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listUploadedFiles } from "@/core/uploads/api";

vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "http://backend.test",
}));

vi.mock("@/core/uploads/api", () => ({
  listUploadedFiles: vi.fn().mockResolvedValue({ files: [], count: 0 }),
  uploadFiles: vi.fn(),
}));

import { MedicalRecordCard } from "../MedicalRecordCard";

describe("MedicalRecordCard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(listUploadedFiles).mockResolvedValue({ files: [], count: 0 });
  });

  it("patches only dirty fields and notifies after save succeeds", async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        patient_info: {
          name: "张三",
          age: 46,
          chief_complaint: "胸痛",
        },
      }),
    } as unknown as Response);
    const onPatientInfoSaved = vi.fn().mockResolvedValue(undefined);

    render(
      <MedicalRecordCard
        data={{
          type: "medical_record",
          thread_id: "thread-1",
          patient_info: {
            name: "张三",
            age: 45,
            chief_complaint: "胸痛",
          },
          evidence_items: [],
        }}
        mode="dialog"
        onPatientInfoSaved={onPatientInfoSaved}
      />, 
    );

    const ageInput = screen.getByRole("spinbutton");
    await userEvent.clear(ageInput);
    await userEvent.type(ageInput, "46");
    await userEvent.click(screen.getByRole("button", { name: "保存更改" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestInit).toBeDefined();
    expect(typeof requestInit?.body).toBe("string");
    expect(JSON.parse(requestInit?.body as string)).toEqual({ age: "46" });

    await waitFor(() => {
      expect(onPatientInfoSaved).toHaveBeenCalledWith(
        {
          changes: [{ field: "age", action: "updated" }],
          dirtyFields: { age: "46" },
        },
      );
    });
  });

  it("does not save or notify when there is no diff", async () => {
    const fetchMock = vi.mocked(fetch);
    const onPatientInfoSaved = vi.fn().mockResolvedValue(undefined);

    render(
      <MedicalRecordCard
        data={{
          type: "medical_record",
          thread_id: "thread-1",
          patient_info: {
            name: "张三",
            age: 45,
            chief_complaint: "胸痛",
          },
          evidence_items: [],
        }}
        mode="dialog"
        onPatientInfoSaved={onPatientInfoSaved}
      />, 
    );

    const saveButton = screen.getByRole("button", { name: "保存更改" });
    expect(saveButton).toBeDisabled();

    await userEvent.click(saveButton);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onPatientInfoSaved).not.toHaveBeenCalled();
  });

  it("shows uploaded filenames but hides patient-facing analysis details", async () => {
    vi.mocked(listUploadedFiles).mockResolvedValue({
      files: [
        {
          filename: "cbc.png",
          size: 12,
          path: "/mnt/user-data/uploads/cbc.png",
          virtual_path: "/mnt/user-data/uploads/cbc.png",
          artifact_url: "/api/artifacts/cbc.png",
        },
      ],
      count: 1,
    });

    render(
      <MedicalRecordCard
        data={{
          type: "medical_record",
          thread_id: "thread-1",
          patient_info: {
            name: "张三",
            age: 45,
            chief_complaint: "胸痛",
          },
          evidence_items: [
            {
              id: "ev-1",
              type: "lab_report",
              title: "血常规",
              filename: "cbc.png",
              status: "completed",
              is_abnormal: true,
              findings_brief: "血红蛋白偏低",
              ocr_summary: "白细胞升高",
            },
          ],
        }}
        mode="dialog"
      />, 
    );

    expect(await screen.findByText("cbc.png")).toBeInTheDocument();
    expect(screen.queryByText("血红蛋白偏低")).not.toBeInTheDocument();
    expect(screen.queryByText("白细胞升高")).not.toBeInTheDocument();
    expect(screen.queryByText(/已识别资料/)).not.toBeInTheDocument();
    expect(screen.queryByText(/异常提示/)).not.toBeInTheDocument();
  });
});