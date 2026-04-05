"use client";

import { FileText } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { type PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { type AppointmentPreviewData } from "@/components/workspace/AppointmentPreview";
import {
  ChatBox,
  useSpecificChatMode,
  useThreadChat,
} from "@/components/workspace/chats";
import { InputBox } from "@/components/workspace/input-box";
import { MedicalRecordDialog } from "@/components/workspace/MedicalRecordDrawer";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { TodoList } from "@/components/workspace/todo-list";
import { Welcome } from "@/components/workspace/welcome";
import { useI18n } from "@/core/i18n/hooks";
import { useNotification } from "@/core/notification/hooks";
import { useLocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { textOfMessage } from "@/core/threads/utils";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import { extractLatestAppointmentPreview } from "./page.orchestration";

export default function ChatPage() {
  const { t } = useI18n();
  const [settings, setSettings] = useLocalSettings();

  const { threadId, isNewThread, setIsNewThread, isMock } = useThreadChat();
  useSpecificChatMode();

  const { showNotification } = useNotification();

  const [medicalRecordOpen, setMedicalRecordOpen] = useState(false);
  const [appointmentPreviewData, setAppointmentPreviewData] =
    useState<AppointmentPreviewData | null>(null);
  const latestAppointmentPreviewSourceIdRef = useRef<string | null>(null);
  const initializedThreadIdRef = useRef(false);

  const [thread, sendMessage, isUploading] = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    context: settings.context,
    isMock,
    onStart: () => {
      setIsNewThread(false);
      history.replaceState(null, "", `/workspace/chats/${threadId}`);
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

  useEffect(() => {
    const latestPreview = extractLatestAppointmentPreview(thread.messages);
    const nextPreview = latestPreview?.data.thread_id === threadId ? latestPreview : null;

    if (
      nextPreview &&
      nextPreview.sourceMessageId !== latestAppointmentPreviewSourceIdRef.current
    ) {
      latestAppointmentPreviewSourceIdRef.current = nextPreview.sourceMessageId;
      setAppointmentPreviewData(nextPreview.data);
      setMedicalRecordOpen(true);
    }
  }, [thread.messages, threadId]);

  useEffect(() => {
    if (!initializedThreadIdRef.current) {
      initializedThreadIdRef.current = true;
      return;
    }

    latestAppointmentPreviewSourceIdRef.current = null;
    setAppointmentPreviewData(null);
  }, [threadId]);

  useEffect(() => {
    const handleOpenMedicalRecord = (event: Event) => {
      const customEvent = event as CustomEvent<{ threadId?: string }>;
      if (customEvent.detail?.threadId && customEvent.detail.threadId !== threadId) {
        return;
      }
      setMedicalRecordOpen(true);
    };

    window.addEventListener(
      "medical-record:open",
      handleOpenMedicalRecord as EventListener,
    );
    return () => {
      window.removeEventListener(
        "medical-record:open",
        handleOpenMedicalRecord as EventListener,
      );
    };
  }, [threadId]);

  return (
    <ThreadContext.Provider value={{ thread, isMock }}>
      <ChatBox threadId={threadId}>
        <div className="relative flex size-full min-h-0 justify-between">
          <header
            className={cn(
              "absolute top-0 right-0 left-0 z-30 flex h-12 shrink-0 items-center px-4",
              isNewThread
                ? "bg-background/0 backdrop-blur-none"
                : "bg-background/80 shadow-xs backdrop-blur",
            )}
          >
            <div className="flex w-full items-center text-sm font-medium">
              <ThreadTitle threadId={threadId} thread={thread} />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMedicalRecordOpen(true)}
                className="flex min-h-9 min-w-[84px] items-center gap-1.5 whitespace-nowrap rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800 transition-colors hover:border-cyan-300 hover:bg-cyan-100"
                title="打开病例页面"
              >
                <FileText className="h-3.5 w-3.5" />
                病历单
              </button>
            </div>
          </header>
          <main className="flex min-h-0 max-w-full grow flex-col">
            <div className={cn("flex size-full justify-center px-4", !isNewThread && "pt-14")}>
              <MessageList
                className={cn("size-full", !isNewThread && "pt-2")}
                threadId={threadId}
                thread={thread}
              />
            </div>
            <div className="absolute right-0 bottom-0 left-0 z-30 flex justify-center px-4">
              <div
                className={cn(
                  "relative w-full",
                  isNewThread && "-translate-y-[calc(50vh-96px)]",
                  isNewThread
                    ? "max-w-(--container-width-sm)"
                    : "max-w-(--container-width-md)",
                )}
              >
                <div className="absolute -top-4 right-0 left-0 z-0">
                  <div className="absolute right-0 bottom-0 left-0">
                    <TodoList
                      className="bg-background/5"
                      todos={thread.values.todos ?? []}
                      hidden={!thread.values.todos || thread.values.todos.length === 0}
                    />
                  </div>
                </div>
                <InputBox
                  className={cn("bg-background/5 w-full -translate-y-4")}
                  isNewThread={isNewThread}
                  threadId={threadId}
                  autoFocus={isNewThread}
                  status={thread.error ? "error" : thread.isLoading ? "streaming" : "ready"}
                  context={settings.context}
                  extraHeader={isNewThread && <Welcome mode={settings.context.mode} />}
                  disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" || isUploading}
                  onContextChange={(context) => setSettings("context", context)}
                  onSubmit={handleSubmit}
                  onStop={handleStop}
                />
                {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" && (
                  <div className="text-muted-foreground/67 w-full translate-y-12 text-center text-xs">
                    {t.common.notAvailableInDemoMode}
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
        <MedicalRecordDialog
          threadId={threadId}
          open={medicalRecordOpen}
          onClose={() => setMedicalRecordOpen(false)}
          appointmentPreviewData={appointmentPreviewData}
          onAppointmentConfirmed={() => setAppointmentPreviewData(null)}
        />
      </ChatBox>
    </ThreadContext.Provider>
  );
}
