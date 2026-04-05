import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  setIsNewThread: vi.fn(),
  setSettings: vi.fn(),
  showNotification: vi.fn(),
  subscribeToThreadEvents: vi.fn(() => vi.fn()),
  updateState: vi.fn(),
  thread: {
    error: null,
    isLoading: false,
    messages: [
      {
        id: "assistant-preview-1",
        type: "ai",
        content: JSON.stringify({
          type: "appointment_preview",
          thread_id: "thread-1",
          patient_info: { name: "张三", age: 45 },
          evidence_items: [{ id: "ev-1", type: "lab_report", title: "化验单" }],
          suggested_priority: "medium",
          suggested_department: "呼吸内科",
          reason: "胸痛 2 天",
        }),
      },
    ],
    stop: vi.fn(),
    title: "患者登记",
    values: {
      todos: [],
    },
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/workspace/artifacts", () => ({
  ArtifactTrigger: () => <div>artifact trigger</div>,
}));

vi.mock("@/components/workspace/chats", () => ({
  ChatBox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSpecificChatMode: () => undefined,
  useThreadChat: () => ({
    threadId: "thread-1",
    isNewThread: false,
    setIsNewThread: mocks.setIsNewThread,
    isMock: false,
  }),
}));

vi.mock("@/components/workspace/export-trigger", () => ({
  ExportTrigger: () => <div>export trigger</div>,
}));

vi.mock("@/components/workspace/input-box", () => ({
  InputBox: () => <div>input box</div>,
}));

vi.mock("@/components/workspace/MedicalRecordDrawer", () => ({
  MedicalRecordDialog: ({
    open,
    appointmentPreviewData,
  }: {
    open: boolean;
    appointmentPreviewData?: { suggested_department?: string | null } | null;
  }) => (
    <div data-testid="medical-record-dialog">
      {open ? "open" : "closed"}:{appointmentPreviewData?.suggested_department ?? "none"}
    </div>
  ),
}));

vi.mock("@/components/workspace/messages", () => ({
  MessageList: () => <div>message list</div>,
}));

vi.mock("@/components/workspace/thread-title", () => ({
  ThreadTitle: () => <div>thread title</div>,
}));

vi.mock("@/components/workspace/todo-list", () => ({
  TodoList: () => <div>todo list</div>,
}));

vi.mock("@/components/workspace/token-usage-indicator", () => ({
  TokenUsageIndicator: () => <div>token usage</div>,
}));

vi.mock("@/components/workspace/tool-chain-indicator", () => ({
  ToolChainIndicator: () => <div>tool chain</div>,
}));

vi.mock("@/components/workspace/welcome", () => ({
  Welcome: () => <div>welcome</div>,
}));

vi.mock("@/core/api", () => ({
  getAPIClient: () => ({
    threads: {
      updateState: mocks.updateState,
    },
  }),
}));

vi.mock("@/core/api/thread-events", () => ({
  subscribeToThreadEvents: mocks.subscribeToThreadEvents,
}));

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      common: {
        notAvailableInDemoMode: "demo unavailable",
      },
    },
  }),
}));

vi.mock("@/core/notification/hooks", () => ({
  useNotification: () => ({
    showNotification: mocks.showNotification,
  }),
}));

vi.mock("@/core/settings", () => ({
  useLocalSettings: () => [
    {
      context: {
        mode: "patient",
      },
    },
    mocks.setSettings,
  ],
}));

vi.mock("@/core/threads/hooks", () => ({
  useThreadStream: () => [mocks.thread, mocks.sendMessage, false],
}));

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_STATIC_WEBSITE_ONLY: "false",
  },
}));

import ChatPage from "./page";

describe("Patient intake chat page", () => {
  beforeEach(() => {
    mocks.sendMessage.mockReset();
    mocks.setIsNewThread.mockReset();
    mocks.setSettings.mockReset();
    mocks.showNotification.mockReset();
    mocks.subscribeToThreadEvents.mockClear();
    mocks.updateState.mockReset();
  });

  it("keeps the medical record entry but removes patient status side effects", async () => {
    render(<ChatPage />);

    expect(screen.getByRole("button", { name: "病历单" })).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.subscribeToThreadEvents).not.toHaveBeenCalled();
      expect(mocks.updateState).not.toHaveBeenCalled();
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });
  });

  it("uses appointment preview messages only to drive the medical record dialog", async () => {
    render(<ChatPage />);

    await waitFor(() => {
      expect(screen.getByTestId("medical-record-dialog")).toHaveTextContent("open:呼吸内科");
    });
  });
});