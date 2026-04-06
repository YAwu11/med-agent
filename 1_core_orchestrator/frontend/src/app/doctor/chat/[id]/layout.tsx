"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";

import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ArtifactsProvider } from "@/components/workspace/artifacts";
import { SubtasksProvider } from "@/core/tasks/context";

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
