import type { Message } from "@langchain/langgraph-sdk";

import { isAssistantMessageGroupType } from "@/core/messages/utils";

export function findThreadTailNoticeInsertIndex(
  groups: Array<{ type: string }>,
) {
  const lastGroup = groups[groups.length - 1];
  if (!lastGroup || !isAssistantMessageGroupType(lastGroup.type)) {
    return groups.length;
  }
  return groups.length - 1;
}

export function shouldRenderAnchoredNoticesBeforeGroup(groupType: string) {
  return groupType === "assistant:processing" || groupType === "assistant:subagent";
}

export function getMessageAvatarMeta(messageType: Message["type"]) {
  if (messageType === "human") {
    return {
      label: "用户头像",
      fallback: "患",
    };
  }

  return {
    label: "助手头像",
    fallback: "医",
  };
}