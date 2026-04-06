import { describe, expect, it } from "vitest";

import {
  findThreadTailNoticeInsertIndex,
  shouldRenderAnchoredNoticesBeforeGroup,
} from "@/components/workspace/messages/message-presentation";

describe("MessageList", () => {
  it("inserts thread-tail notices before the latest assistant group", () => {
    expect(
      findThreadTailNoticeInsertIndex([
        { type: "human" },
        { type: "assistant" },
        { type: "assistant" },
      ]),
    ).toBe(2);
  });

  it("keeps thread-tail notices at the end when the list does not end with assistant output", () => {
    expect(
      findThreadTailNoticeInsertIndex([
        { type: "human" },
        { type: "assistant" },
        { type: "human" },
      ]),
    ).toBe(3);
  });

  it("renders anchored notices before assistant processing groups", () => {
    expect(shouldRenderAnchoredNoticesBeforeGroup("assistant:processing")).toBe(
      true,
    );
    expect(shouldRenderAnchoredNoticesBeforeGroup("assistant:subagent")).toBe(
      true,
    );
  });

  it("keeps anchored notices after regular human and assistant bubbles", () => {
    expect(shouldRenderAnchoredNoticesBeforeGroup("human")).toBe(false);
    expect(shouldRenderAnchoredNoticesBeforeGroup("assistant")).toBe(false);
  });
});