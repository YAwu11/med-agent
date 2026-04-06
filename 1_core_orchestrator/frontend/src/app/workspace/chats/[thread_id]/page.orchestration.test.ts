import type { Message } from "@langchain/langgraph-sdk";
import { describe, expect, it } from "vitest";

import { extractLatestAppointmentPreview } from "./page.orchestration";

describe("chat page orchestration", () => {
  it("extracts the latest appointment preview from tool output without requiring AI echo", () => {
    const preview = extractLatestAppointmentPreview([
      {
        type: "human",
        id: "human-1",
        content: "请帮我挂号",
        additional_kwargs: {},
      },
      {
        type: "tool",
        id: "tool-1",
        name: "preview_appointment",
        tool_call_id: "call-1",
        content: JSON.stringify({
          type: "appointment_preview",
          thread_id: "thread-1",
          patient_info: { name: "张三", age: 30, sex: "男" },
          evidence_items: [],
          suggested_priority: "medium",
          suggested_department: "呼吸内科",
          reason: "持续咳嗽 3 天",
        }),
        additional_kwargs: {},
      },
    ] as Message[]);

    expect(preview).toEqual(
      expect.objectContaining({
        sourceMessageId: "tool-1",
        data: expect.objectContaining({
          type: "appointment_preview",
          suggested_department: "呼吸内科",
        }),
      }),
    );
  });

  it("extracts appointment preview from assistant text when it embeds preview json", () => {
    const preview = extractLatestAppointmentPreview([
      {
        type: "ai",
        id: "ai-2",
        content: `挂号预览如下：\n${JSON.stringify({
          type: "appointment_preview",
          thread_id: "thread-2",
          patient_info: { name: "李四", age: 28, sex: "女" },
          evidence_items: [],
          suggested_priority: "low",
          suggested_department: "皮肤科",
          reason: "皮疹 1 周",
        })}`,
        additional_kwargs: {},
      },
    ] as Message[]);

    expect(preview).toEqual(
      expect.objectContaining({
        sourceMessageId: "ai-2",
        data: expect.objectContaining({
          thread_id: "thread-2",
          suggested_department: "皮肤科",
        }),
      }),
    );
  });
});