import { describe, expect, it } from "vitest";

import { extractContentFromMessage, groupMessages } from "./utils";

describe("groupMessages", () => {
  it("skips hidden context-event messages from the visible transcript", () => {
    const groups = groupMessages(
      [
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
          content: "我先继续问两个问题。",
          additional_kwargs: {},
        },
      ],
      (group) => group.type,
    );

    expect(groups).toEqual(["assistant"]);
  });

  it("strips leaked patient record delta blocks from visible human messages", () => {
    expect(
      extractContentFromMessage({
        type: "human",
        id: "human-1",
        content:
          '<patient_record_delta revision="12">\n- 患者更新了字段：age。\n</patient_record_delta>\n\n你帮我分析一下病情',
        additional_kwargs: {},
      }),
    ).toBe("你帮我分析一下病情");
  });
});