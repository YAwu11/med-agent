"use client";

import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { ArtifactsProvider } from "@/components/workspace/artifacts";
import { SubtasksProvider } from "@/core/tasks/context";
import { SidebarProvider } from "@/components/ui/sidebar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useState } from "react";

export default function DoctorChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <SidebarProvider defaultOpen={false}>
        <SubtasksProvider>
          <ArtifactsProvider>
            <PromptInputProvider>{children}</PromptInputProvider>
          </ArtifactsProvider>
        </SubtasksProvider>
      </SidebarProvider>
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
