import { describe, expect, it } from "vitest";

import { getMessageAvatarMeta } from "@/components/workspace/messages/message-presentation";

describe("MessageListItem", () => {
  it("returns assistant avatar metadata", () => {
    expect(getMessageAvatarMeta("ai")).toEqual({
      label: "助手头像",
      fallback: "医",
    });
  });

  it("returns user avatar metadata", () => {
    expect(getMessageAvatarMeta("human")).toEqual({
      label: "用户头像",
      fallback: "患",
    });
  });
});