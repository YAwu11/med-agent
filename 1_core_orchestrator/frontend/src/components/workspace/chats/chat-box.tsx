import { FilesIcon, XIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";

import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import {
  ArtifactFileDetail,
  ArtifactFileList,
  useArtifacts,
} from "../artifacts";
import { useThread } from "../messages/context";

// [Phase7] 影像审核组件已迁移至医生端 (components/doctor/)
// 患者端 ChatBox 回归纯聊天 + 文件展示功能

export const ChatBoxContext = React.createContext<{
  // [Phase7] 影像审核相关上下文已移除
} | null>(null);

const CLOSE_MODE = { chat: 100, artifacts: 0 };
const OPEN_MODE = { chat: 60, artifacts: 40 };

const ChatBox: React.FC<{
  children: React.ReactNode;
  threadId: string;
  // [Phase7] onReJudge prop 已移除，诊断功能移至医生端
}> = ({
  children,
  threadId,
}) => {
  const { thread } = useThread();
  const pathname = usePathname();
  const threadIdRef = useRef(threadId);
  const layoutRef = useRef<GroupImperativeHandle>(null);

  const {
    artifacts,
    open: artifactsOpen,
    setOpen: setArtifactsOpen,
    setArtifacts,
    select: selectArtifact,
    deselect,
    selectedArtifact,
  } = useArtifacts();

  const [autoSelectFirstArtifact, setAutoSelectFirstArtifact] = useState(true);
  useEffect(() => {
    if (threadIdRef.current !== threadId) {
      threadIdRef.current = threadId;
      deselect();
    }

    // Update artifacts from the current thread
    setArtifacts(thread.values.artifacts);

    if (
      env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" &&
      autoSelectFirstArtifact
    ) {
      if (thread?.values?.artifacts?.length > 0) {
        setAutoSelectFirstArtifact(false);
        selectArtifact(thread.values.artifacts[0]!);
      }
    }
  }, [
    threadId,
    autoSelectFirstArtifact,
    deselect,
    selectArtifact,
    selectedArtifact,
    setArtifacts,
    thread.values.artifacts,
  ]);

  const artifactPanelOpen = useMemo(() => {
    if (env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true") {
      return artifactsOpen && artifacts?.length > 0;
    }
    return artifactsOpen;
  }, [artifactsOpen, artifacts]);

  const resizableIdBase = useMemo(() => {
    return pathname.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  }, [pathname]);

  useEffect(() => {
    if (layoutRef.current) {
      if (artifactPanelOpen) {
        layoutRef.current.setLayout({
          [`${resizableIdBase}-sidebar`]: OPEN_MODE.chat,
          "artifacts": OPEN_MODE.artifacts
        });
      } else {
        layoutRef.current.setLayout({
          [`${resizableIdBase}-sidebar`]: CLOSE_MODE.chat,
          "artifacts": CLOSE_MODE.artifacts
        });
      }
    }
  }, [artifactPanelOpen, resizableIdBase]);

  // Handle close (from X button) — collapse only
  const handleClose = useCallback(() => {
    setArtifactsOpen(false);
  }, [setArtifactsOpen]);

  // [Phase7] 简化后的侧边栏：只展示 Artifact 文件
  const renderSidebarContent = () => {
    // Selected artifact detail view
    if (selectedArtifact) {
      return (
        <ArtifactFileDetail
          className="size-full"
          filepath={selectedArtifact}
          threadId={threadId}
        />
      );
    }

    // Empty state or artifact list
    return (
      <div className="relative flex size-full justify-center">
        <div className="absolute top-1 right-1 z-30">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={handleClose}
          >
            <XIcon />
          </Button>
        </div>
        {!thread.values.artifacts || thread.values.artifacts.length === 0 ? (
          <ConversationEmptyState
            icon={<FilesIcon />}
            title="No artifact selected"
            description="Select an artifact to view its details"
          />
        ) : (
          <div className="flex size-full max-w-(--container-width-sm) flex-col justify-center p-4 pt-8">
            <header className="shrink-0">
              <h2 className="text-lg font-medium">Artifacts</h2>
            </header>
            <main className="min-h-0 grow">
              <ArtifactFileList
                className="max-w-(--container-width-sm) p-4 pt-12"
                files={thread.values.artifacts ?? []}
                threadId={threadId}
              />
            </main>
          </div>
        )}
      </div>
    );
  };

  const contextValue = useMemo(() => ({}), []);

  return (
    <ResizablePanelGroup
      id={`${resizableIdBase}-panels`}
      orientation="horizontal"
      defaultLayout={{ chat: 100, artifacts: 0 }}
      groupRef={layoutRef}
      className="size-full"
    >
      <ResizablePanel
        id={`${resizableIdBase}-sidebar`}
        defaultSize={OPEN_MODE.chat}
        minSize={OPEN_MODE.chat}
      >
        <ChatBoxContext.Provider value={contextValue}>
          {children}
        </ChatBoxContext.Provider>
      </ResizablePanel>
      <ResizableHandle
        id={`${resizableIdBase}-separator`}
        className={cn(
          "opacity-33 hover:opacity-100",
          !artifactPanelOpen && "pointer-events-none opacity-0",
        )}
      />
      <ResizablePanel
        className={cn(
          "transition-all duration-300 ease-in-out",
          !artifactsOpen && "opacity-0",
        )}
        id="artifacts"
      >
        <div
          className={cn(
            "h-full p-4 transition-transform duration-300 ease-in-out",
            artifactPanelOpen ? "translate-x-0" : "translate-x-full",
          )}
        >
          {renderSidebarContent()}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};

export { ChatBox };

export function useChatBox() {
  const context = React.useContext(ChatBoxContext);
  if (!context) {
    throw new Error("useChatBox must be used within ChatBox");
  }
  return context;
}
