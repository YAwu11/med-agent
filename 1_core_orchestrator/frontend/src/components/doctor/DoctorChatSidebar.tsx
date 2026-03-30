"use client";

import { useCallback } from "react";
import { Stethoscope } from "lucide-react";
import { type PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
  ChatBox,
  useSpecificChatMode,
  useThreadChat,
} from "@/components/workspace/chats";
import { InputBox } from "@/components/workspace/input-box";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import { TodoList } from "@/components/workspace/todo-list";
import { Welcome } from "@/components/workspace/welcome";
import { useI18n } from "@/core/i18n/hooks";
import { useNotification } from "@/core/notification/hooks";
import { useLocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { textOfMessage } from "@/core/threads/utils";
import { env } from "@/env";
import { cn } from "@/lib/utils";

interface DoctorChatSidebarProps {
  threadId: string;
}

export function DoctorChatSidebar({ threadId: initialThreadId }: DoctorChatSidebarProps) {
  const { t } = useI18n();
  const [settings, setSettings] = useLocalSettings();

  const { threadId, isNewThread, setIsNewThread, isMock } = useThreadChat();
  useSpecificChatMode();

  const { showNotification } = useNotification();

  const [thread, sendMessage, isUploading] = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    context: settings.context,
    isMock,
    onStart: () => {
      setIsNewThread(false);
      history.replaceState(null, "", `/doctor/chat/${threadId}`);
    },
    onFinish: (state) => {
      if (document.hidden || !document.hasFocus()) {
        let body = "Conversation finished";
        const lastMessage = state.messages.at(-1);
        if (lastMessage) {
          const textContent = textOfMessage(lastMessage);
          if (textContent) {
            body =
              textContent.length > 200
                ? textContent.substring(0, 200) + "..."
                : textContent;
          }
        }
        showNotification(state.title, { body });
      }
    },
  });

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      void sendMessage(threadId, message);
    },
    [sendMessage, threadId],
  );

  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);

  return (
    <ThreadContext.Provider value={{ thread, isMock }}>
      <ChatBox threadId={threadId}>
        <div className="relative flex h-full w-full min-h-0 flex-col pt-4">
          <main className="flex size-full flex-col min-h-0 relative">
            
            {/* 消息列表区域 */}
            <div className="flex-1 overflow-y-auto px-4 pb-32">
              <MessageList
                className="w-full h-full"
                threadId={threadId}
                thread={thread}
              />
            </div>

            {/* 底部输入框区域 */}
            <div className="absolute right-0 bottom-0 left-0 bg-gradient-to-t from-white via-white to-transparent pt-10 pb-4 px-4">
              <div className="relative w-full mx-auto max-w-lg">
                <div className="absolute -top-4 right-0 left-0 z-0">
                  <div className="absolute right-0 bottom-0 left-0">
                    <TodoList
                      className="bg-slate-50/50 backdrop-blur"
                      todos={thread.values.todos ?? []}
                      hidden={!thread.values.todos || thread.values.todos.length === 0}
                    />
                  </div>
                </div>

                <InputBox
                  className={cn("bg-slate-50 border border-slate-200 shadow-sm w-full")}
                  isNewThread={isNewThread}
                  threadId={threadId}
                  autoFocus={isNewThread}
                  status={
                    thread.error
                      ? "error"
                      : thread.isLoading
                        ? "streaming"
                        : "ready"
                  }
                  context={settings.context}
                  extraHeader={isNewThread && <Welcome mode={settings.context.mode} />}
                  disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" || isUploading}
                  onContextChange={(context) => setSettings("context", context)}
                  onSubmit={handleSubmit}
                  onStop={handleStop}
                  submitLabel={
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <Stethoscope className="h-3.5 w-3.5" />
                      综合诊断
                    </span>
                  }
                />

                {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" && (
                  <div className="text-muted-foreground/67 w-full mt-2 text-center text-xs">
                    {t.common.notAvailableInDemoMode}
                  </div>
                )}
              </div>
            </div>

          </main>
        </div>
      </ChatBox>
    </ThreadContext.Provider>
  );
}
