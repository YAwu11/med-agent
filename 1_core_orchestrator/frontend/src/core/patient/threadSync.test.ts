import { describe, expect, it } from "vitest";

import type { SystemNotice } from "./systemNotices";
import {
  extractUpdatePatientInfoChanges,
  getLatestAssistantAnchorMessageId,
  getNextPendingSystemNotice,
} from "./threadSync";

describe("threadSync", () => {
  it("finds the latest visible assistant message for notice anchoring", () => {
    expect(
      getLatestAssistantAnchorMessageId([
        {
          type: "human",
          id: "hidden-1",
          content: "患者病历信息发生更新：主诉=胸痛 2 天",
          additional_kwargs: {
            context_event: {
              hidden: true,
              kind: "patient_record_delta",
            },
          },
        },
        {
          type: "ai",
          id: "ai-1",
          content: "请继续补充现病史。",
          additional_kwargs: {},
        },
      ]),
    ).toBe("ai-1");
  });

  it("extracts structured field changes from update_patient_info tool output", () => {
    expect(
      extractUpdatePatientInfoChanges({
        output: JSON.stringify({
          status: "success",
          changes: [
            { field: "chief_complaint", action: "updated" },
            { field: "medical_history", action: "added" },
          ],
        }),
      }),
    ).toEqual([
      { field: "chief_complaint", action: "updated" },
      { field: "medical_history", action: "added" },
    ]);
  });

  it("returns the oldest pending notice that still has a delivery payload", () => {
    const notices: SystemNotice[] = [
      {
        id: "notice-2",
        kind: "upload_received",
        text: "患者上传了 cbc.png，正在识别中",
        created_at: "2026-04-05T10:00:02.000Z",
        ai_delivery: "none",
      },
      {
        id: "notice-1",
        kind: "patient_info_updated",
        text: "患者修改了：主诉",
        created_at: "2026-04-05T10:00:01.000Z",
        ai_delivery: "pending",
        delivery_payload: {
          text: "患者病历信息发生更新：修改：主诉=胸痛 2 天。请据此继续问诊。",
          additional_kwargs: {
            context_event: {
              hidden: true,
              kind: "patient_record_delta",
              source: "patient_form",
              payload: {},
            },
          },
        },
      },
    ];

    expect(getNextPendingSystemNotice(notices)?.id).toBe("notice-1");
  });
});