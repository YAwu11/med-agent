import { getBackendBaseURL } from "@/core/config";

export type ConnectedThreadEvent = {
  type: "connected";
  thread_id: string;
  timestamp: string;
};

export type UploadReceivedThreadEvent = {
  type: "upload_received";
  thread_id: string;
  event_id: string;
  upload_id: string;
  filename: string;
  status: "processing";
};

export type UploadAnalyzedThreadEvent = {
  type: "upload_analyzed";
  thread_id: string;
  event_id: string;
  upload_id: string;
  filename: string;
  analysis_kind: string;
  status: "completed" | "failed";
  category?: string;
  summary?: string;
};

export type ThreadEvent =
  | ConnectedThreadEvent
  | UploadReceivedThreadEvent
  | UploadAnalyzedThreadEvent;

export function parseThreadEventData(raw: string): ThreadEvent | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;

    if (
      data.type === "connected" &&
      typeof data.thread_id === "string" &&
      typeof data.timestamp === "string"
    ) {
      return {
        type: "connected",
        thread_id: data.thread_id,
        timestamp: data.timestamp,
      };
    }

    if (
      data.type === "upload_received" &&
      typeof data.thread_id === "string" &&
      typeof data.event_id === "string" &&
      typeof data.upload_id === "string" &&
      typeof data.filename === "string" &&
      data.status === "processing"
    ) {
      return {
        type: "upload_received",
        thread_id: data.thread_id,
        event_id: data.event_id,
        upload_id: data.upload_id,
        filename: data.filename,
        status: "processing",
      };
    }

    if (
      data.type === "upload_analyzed" &&
      typeof data.thread_id === "string" &&
      typeof data.event_id === "string" &&
      typeof data.upload_id === "string" &&
      typeof data.filename === "string" &&
      typeof data.analysis_kind === "string" &&
      (data.status === "completed" || data.status === "failed")
    ) {
      return {
        type: "upload_analyzed",
        thread_id: data.thread_id,
        event_id: data.event_id,
        upload_id: data.upload_id,
        filename: data.filename,
        analysis_kind: data.analysis_kind,
        status: data.status,
        category: typeof data.category === "string" ? data.category : undefined,
        summary: typeof data.summary === "string" ? data.summary : undefined,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function subscribeToThreadEvents(
  threadId: string,
  onEvent: (event: ThreadEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const eventSource = new EventSource(
    `${getBackendBaseURL()}/api/threads/${threadId}/events`,
  );

  eventSource.onmessage = (message) => {
    const event = parseThreadEventData(message.data);
    if (event) {
      onEvent(event);
    }
  };

  eventSource.onerror = (error) => {
    onError?.(error);
  };

  return () => eventSource.close();
}