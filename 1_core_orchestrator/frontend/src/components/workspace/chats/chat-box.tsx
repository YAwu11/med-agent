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
  ImagingReviewPanel,
  ImagingViewerPanel,
  DiagnosticDashboard,
} from "../artifacts";
import { usePendingImagingReports, useReviewedImagingReports, type ImagingReport } from "@/core/imaging/api";
import { useThread } from "../messages/context";

export const ChatBoxContext = React.createContext<{
  hasImaging: boolean;
  openImagingReview: () => void;
  openImagingViewer: () => void;
} | null>(null);

const CLOSE_MODE = { chat: 100, artifacts: 0 };
const OPEN_MODE = { chat: 60, artifacts: 40 };

const ChatBox: React.FC<{
  children: React.ReactNode;
  threadId: string;
  onReJudge?: (summary: string) => void;
}> = ({
  children,
  threadId,
  onReJudge,
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

  const { data: pendingReport } = usePendingImagingReports(threadId);
  const { data: reviewedReports } = useReviewedImagingReports(threadId);

  const [lastOpenedReportId, setLastOpenedReportId] = useState<string | null>(null);

  // Track sidebar mode: "dashboard" | "review" | "viewer" | "artifact" | null
  const [sidebarMode, setSidebarMode] = useState<"dashboard" | "review" | "viewer" | "artifact" | null>(null);
  const [viewerReport, setViewerReport] = useState<ImagingReport | null>(null);
  const [reEditReport, setReEditReport] = useState<ImagingReport | null>(null);

  // Automatically open the side panel if there's a new pending report
  useEffect(() => {
    if (pendingReport && pendingReport.report_id !== lastOpenedReportId) {
      setArtifactsOpen(true);
      setSidebarMode("dashboard");
      setReEditReport(null);
      setLastOpenedReportId(pendingReport.report_id);
    }
  }, [pendingReport, lastOpenedReportId, setArtifactsOpen]);

  // Handle review completion → switch to dashboard
  const handleReviewComplete = useCallback((completedReport: ImagingReport) => {
    setViewerReport(completedReport);
    setSidebarMode("dashboard");
    setReEditReport(null);
  }, []);

  // Handle re-edit → switch back to review mode
  const handleReEdit = useCallback((report: ImagingReport) => {
    setReEditReport(report);
    setSidebarMode("review");
  }, []);

  // Handle toggle — collapse/expand without destroying state
  const handleToggleSidebar = useCallback(() => {
    if (artifactsOpen) {
      setArtifactsOpen(false);
    } else {
      setArtifactsOpen(true);
    }
  }, [artifactsOpen, setArtifactsOpen]);

  // Handle close (from X button) — collapse only, preserve state
  const handleClose = useCallback(() => {
    setArtifactsOpen(false);
  }, [setArtifactsOpen]);

  const [autoSelectFirstArtifact, setAutoSelectFirstArtifact] = useState(true);
  useEffect(() => {
    if (threadIdRef.current !== threadId) {
      threadIdRef.current = threadId;
      deselect();
      setSidebarMode(null);
      setViewerReport(null);
      setReEditReport(null);
      setLastOpenedReportId(null);
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

  // Determine which report to show in review mode
  const activeReviewReport = reEditReport || pendingReport;

  // Determine which report to show in viewer mode
  const activeViewerReport = viewerReport || (reviewedReports && reviewedReports.length > 0 ? reviewedReports[reviewedReports.length - 1] : null);

  // Render sidebar content based on mode
  const renderSidebarContent = () => {
    if (sidebarMode === "dashboard") {
      return (
        <DiagnosticDashboard
          className="size-full"
          threadId={threadId}
          pendingImaging={pendingReport || null}
          reviewedImaging={reviewedReports || []}
          onClose={handleClose}
          onOpenImagingReview={() => setSidebarMode("review")}
          onOpenImagingViewer={() => setSidebarMode("viewer")}
          onGenerateGlobalDiagnosis={(summary) => {
            onReJudge?.(summary);
            handleClose();
          }}
        />
      );
    }

    // Priority 1: Review mode (pending or re-edit)
    if (sidebarMode === "review" && activeReviewReport) {
      return (
        <ImagingReviewPanel
          className="size-full"
          threadId={threadId}
          report={activeReviewReport}
          onClose={() => setSidebarMode("dashboard")} // Go back to dashboard
          onReviewComplete={handleReviewComplete}
        />
      );
    }

    // Priority 2: Viewer mode (reviewed report)
    if (sidebarMode === "viewer" && activeViewerReport) {
      return (
        <ImagingViewerPanel
          className="size-full"
          threadId={threadId}
          report={activeViewerReport}
          onClose={() => setSidebarMode("dashboard")} // Go back to dashboard
          onReEdit={handleReEdit}
          // onReJudge intentionally omitted as it moved to Dashboard
        />
      );
    }

    // Priority 3: Pending report fallback
    if (pendingReport) {
      return (
        <DiagnosticDashboard
          className="size-full"
          threadId={threadId}
          pendingImaging={pendingReport || null}
          reviewedImaging={reviewedReports || []}
          onClose={handleClose}
          onOpenImagingReview={() => setSidebarMode("review")}
          onOpenImagingViewer={() => setSidebarMode("viewer")}
          onGenerateGlobalDiagnosis={(summary) => {
            onReJudge?.(summary);
            handleClose();
          }}
        />
      );
    }

    // Priority 4: Selected artifact
    if (selectedArtifact) {
      return (
        <ArtifactFileDetail
          className="size-full"
          filepath={selectedArtifact}
          threadId={threadId}
        />
      );
    }

    // Priority 5: Empty state or artifact list
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
        {/* Show reviewed report thumbnail if available */}
        {activeViewerReport ? (
          <div className="flex size-full flex-col items-center justify-center p-4">
            <Button
              variant="outline"
              onClick={() => {
                setSidebarMode("viewer");
                setArtifactsOpen(true);
              }}
              className="gap-2"
            >
              查看已审核的影像报告
            </Button>
          </div>
        ) : !thread.values.artifacts || thread.values.artifacts.length === 0 ? (
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

  const contextValue = useMemo(() => ({
    hasImaging: !!pendingReport || (!!reviewedReports && reviewedReports.length > 0),
    openImagingReview: () => {
      setSidebarMode("dashboard");
      setArtifactsOpen(true);
    },
    openImagingViewer: () => {
      setSidebarMode("dashboard");
      setArtifactsOpen(true);
    }
  }), [pendingReport, reviewedReports, setArtifactsOpen]);

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
          !artifactsOpen && !sidebarMode && "opacity-0",
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
