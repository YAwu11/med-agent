import { describe, expect, it } from "vitest";

import {
  buildAgentFieldSuccessNotice,
  buildPatientFieldNotice,
  buildUploadAnalyzedNotice,
  buildUploadReceivedNotice,
  getSystemNoticesForAnchor,
  getThreadTailSystemNotices,
  mergeSystemNoticeLists,
  type SystemNotice,
} from "./systemNotices";

describe("systemNotices", () => {
  it("builds a patient-visible field edit notice without values", () => {
    const notice = buildPatientFieldNotice(
      [
        { field: "chief_complaint", action: "updated" },
        { field: "present_illness", action: "added" },
        { field: "allergies", action: "deleted" },
      ],
      {
        chief_complaint: "胸痛 2 天",
        present_illness: "近 2 天加重",
        allergies: null,
      },
      {
        id: "notice-1",
        createdAt: "2026-04-05T10:00:00.000Z",
        anchorMessageId: "ai-1",
      },
    );

    expect(notice.text).toContain("患者修改了：主诉");
    expect(notice.text).toContain("患者补充了：现病史");
    expect(notice.text).toContain("患者删除了：过敏与用药");
    expect(notice.text).not.toContain("胸痛 2 天");
    expect(notice.ai_delivery).toBe("pending");
    expect(notice.delivery_payload?.text).toContain("修改：主诉=胸痛 2 天");
    expect(notice.delivery_payload?.text).toContain("新增：现病史=近 2 天加重");
    expect(notice.delivery_payload?.text).toContain("删除：过敏与用药");
    expect(notice.delivery_payload?.additional_kwargs.context_event.hidden).toBe(true);
  });

  it("builds a success notice for agent-side field writes", () => {
    const notice = buildAgentFieldSuccessNotice(
      [
        { field: "chief_complaint", action: "updated" },
        { field: "medical_history", action: "added" },
      ],
      { id: "notice-2", createdAt: "2026-04-05T10:00:01.000Z" },
    );

    expect(notice.text).toContain("系统已修改成功：主诉");
    expect(notice.text).toContain("系统已新增成功：既往史");
    expect(notice.ai_delivery).toBe("none");
  });

  it("builds upload notices with the expected AI delivery policy", () => {
    const received = buildUploadReceivedNotice("cbc.png", {
      id: "notice-3",
      createdAt: "2026-04-05T10:00:02.000Z",
    });
    const completed = buildUploadAnalyzedNotice(
      {
        filename: "cbc.png",
        status: "completed",
        uploadId: "upload-1",
        analysisKind: "ocr",
        category: "lab_report",
        summary: "血红蛋白偏低",
      },
      {
        id: "notice-4",
        createdAt: "2026-04-05T10:00:03.000Z",
      },
    );
    const failed = buildUploadAnalyzedNotice(
      {
        filename: "cbc.png",
        status: "failed",
        uploadId: "upload-1",
        analysisKind: "ocr",
      },
      {
        id: "notice-5",
        createdAt: "2026-04-05T10:00:04.000Z",
      },
    );

    expect(received.text).toBe("患者上传了 cbc.png，正在识别中");
    expect(received.ai_delivery).toBe("none");
    expect(completed.text).toBe("cbc.png 识别完成");
    expect(completed.ai_delivery).toBe("pending");
    expect(completed.delivery_payload?.text).toContain("血红蛋白偏低");
    expect(failed.text).toBe("cbc.png 识别失败");
    expect(failed.ai_delivery).toBe("none");
    expect(failed.delivery_payload).toBeUndefined();
  });

  it("returns notices anchored to the requested message ids in chronological order", () => {
    const notices: SystemNotice[] = [
      {
        id: "notice-2",
        kind: "upload_received",
        text: "患者上传了 cbc.png，正在识别中",
        created_at: "2026-04-05T10:00:02.000Z",
        anchor_message_id: "ai-1",
        ai_delivery: "none",
      },
      {
        id: "notice-1",
        kind: "patient_info_updated",
        text: "患者修改了：主诉",
        created_at: "2026-04-05T10:00:01.000Z",
        anchor_message_id: "ai-1",
        ai_delivery: "pending",
      },
      {
        id: "notice-3",
        kind: "upload_analyzed",
        text: "cbc.png 识别完成",
        created_at: "2026-04-05T10:00:03.000Z",
        anchor_message_id: "ai-2",
        ai_delivery: "pending",
      },
    ];

    expect(getSystemNoticesForAnchor(notices, ["ai-1"]).map((notice) => notice.id)).toEqual([
      "notice-1",
      "notice-2",
    ]);
  });

  it("returns thread-tail notices in chronological order", () => {
    const notices: SystemNotice[] = [
      {
        id: "notice-2",
        kind: "patient_info_updated",
        text: "患者修改了：年龄",
        created_at: "2026-04-05T10:00:02.000Z",
        anchor_message_id: "__thread_tail__",
        ai_delivery: "pending",
      },
      {
        id: "notice-1",
        kind: "patient_info_updated",
        text: "患者修改了：主诉",
        created_at: "2026-04-05T10:00:01.000Z",
        anchor_message_id: "__thread_tail__",
        ai_delivery: "pending",
      },
      {
        id: "notice-3",
        kind: "upload_received",
        text: "患者上传了 cbc.png，正在识别中",
        created_at: "2026-04-05T10:00:03.000Z",
        anchor_message_id: "ai-1",
        ai_delivery: "none",
      },
    ];

    expect(getThreadTailSystemNotices(notices).map((notice) => notice.id)).toEqual([
      "notice-1",
      "notice-2",
    ]);
  });

  it("merges local and persisted notices by id in chronological order", () => {
    expect(
      mergeSystemNoticeLists(
        [
          {
            id: "notice-2",
            kind: "upload_received",
            text: "患者上传了 cbc.png，正在识别中",
            created_at: "2026-04-05T10:00:02.000Z",
            ai_delivery: "none",
          },
        ],
        [
          {
            id: "notice-1",
            kind: "patient_info_updated",
            text: "患者修改了：主诉",
            created_at: "2026-04-05T10:00:01.000Z",
            ai_delivery: "pending",
          },
          {
            id: "notice-2",
            kind: "upload_received",
            text: "患者上传了 cbc.png，正在识别中",
            created_at: "2026-04-05T10:00:02.000Z",
            ai_delivery: "none",
          },
        ],
      ).map((notice) => notice.id),
    ).toEqual(["notice-1", "notice-2"]);
  });
});