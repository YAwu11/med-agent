import type { Message } from "@langchain/langgraph-sdk";
import { ArrowRight, FileIcon, FileText, Loader2Icon } from "lucide-react";
import { useParams } from "next/navigation";
import { memo, useMemo, type ImgHTMLAttributes } from "react";
import rehypeKatex from "rehype-katex";

import { Loader } from "@/components/ai-elements/loader";
import {
  Message as AIElementMessage,
  MessageContent as AIElementMessageContent,
  MessageResponse as AIElementMessageResponse,
  MessageToolbar,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Task, TaskTrigger } from "@/components/ai-elements/task";
import { Badge } from "@/components/ui/badge";
import { type MedicalRecordData } from "@/components/workspace/MedicalRecordCard";
import { getMessageAvatarMeta } from "@/components/workspace/messages/message-presentation";
import { resolveArtifactURL } from "@/core/artifacts/utils";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import {
  extractContentFromMessage,
  extractReasoningContentFromMessage,
  parseUploadedFiles,
  stripUploadedFilesTag,
  type FileInMessage,
} from "@/core/messages/utils";
import { useRehypeSplitWordsIntoSpans } from "@/core/rehype";
import { humanMessagePlugins } from "@/core/streamdown";
import { cn } from "@/lib/utils";

import { CopyButton } from "../copy-button";

import { MarkdownContent } from "./markdown-content";

export function MessageListItem({
  className,
  message,
  isLoading,
  threadId,
}: {
  className?: string;
  message: Message;
  isLoading?: boolean;
  threadId?: string;
}) {
  const isHuman = message.type === "human";
  const avatar = <MessageAvatar messageType={message.type} />;

  return (
    <div
      className={cn(
        "flex w-full items-start gap-3",
        isHuman ? "justify-end" : "justify-start",
      )}
    >
      {!isHuman && avatar}
      <AIElementMessage
        className={cn(
          "group/conversation-message relative min-w-0",
          isHuman ? "ml-auto w-fit max-w-[calc(100%-3.5rem)]" : "flex-1",
          className,
        )}
        from={isHuman ? "user" : "assistant"}
      >
        <MessageContent
          className={isHuman ? "w-fit" : "w-full"}
          message={message}
          isLoading={isLoading}
          threadId={threadId}
        />
        {!isLoading && (
          <MessageToolbar
            className={cn(
              isHuman ? "-bottom-9 justify-end" : "-bottom-8",
              "absolute right-0 left-0 z-20 opacity-0 transition-opacity delay-200 duration-300 group-hover/conversation-message:opacity-100",
            )}
          >
            <div className="flex gap-1">
              <CopyButton
                clipboardData={
                  extractContentFromMessage(message) ??
                  extractReasoningContentFromMessage(message) ??
                  ""
                }
              />
            </div>
          </MessageToolbar>
        )}
      </AIElementMessage>
      {isHuman && avatar}
    </div>
  );
}
function MessageAvatar({ messageType }: { messageType: Message["type"] }) {
  const isHuman = messageType === "human";
  const avatar = getMessageAvatarMeta(messageType);

  return (
    <div
      aria-label={avatar.label}
      className={cn(
        "mt-1 flex size-9 shrink-0 items-center justify-center rounded-2xl border text-xs font-semibold shadow-sm",
        isHuman
          ? "border-slate-300 bg-slate-100 text-slate-700"
          : "border-cyan-200 bg-cyan-50 text-cyan-700",
      )}
    >
      <span aria-hidden>{avatar.fallback}</span>
    </div>
  );
}

function MedicalRecordNotice({ data }: { data: MedicalRecordData }) {
  const readyForSummary = data.guidance?.ready_for_ai_summary ?? false;

  const openMedicalRecord = () => {
    window.dispatchEvent(
      new CustomEvent("medical-record:open", {
        detail: { threadId: data.thread_id },
      }),
    );
  };

  return (
    <div className="overflow-hidden rounded-[28px] border border-cyan-200 bg-[linear-gradient(135deg,rgba(236,254,255,0.96),rgba(248,250,252,0.98))] shadow-[0_16px_40px_rgba(8,145,178,0.12)]">
      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-600 text-white shadow-[0_12px_24px_rgba(8,145,178,0.24)]">
            <FileText className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-950">病例页已同步更新</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {data.message ?? "患者表单和上传资料已归档到病例页，聊天区只保留入口提示。"}
            </p>
            {data.guidance?.status_text ? (
              <p className="mt-2 text-xs leading-5 text-slate-500">
                当前状态：{data.guidance.status_text}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col items-start gap-3 sm:items-end">
          <span
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold",
              readyForSummary
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-700",
            )}
          >
            {readyForSummary ? "资料较完整" : "仍在补充中"}
          </span>
          <button
            type="button"
            onClick={openMedicalRecord}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-cyan-200 bg-white px-4 py-2 text-sm font-semibold text-cyan-800 transition-colors hover:border-cyan-300 hover:bg-cyan-50"
          >
            打开病例页
            <ArrowRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function RegistrationNotice() {
  return (
    <div className="overflow-hidden rounded-[28px] border border-blue-200 bg-[linear-gradient(135deg,rgba(239,246,255,0.96),rgba(248,250,252,0.98))] shadow-[0_16px_40px_rgba(37,99,235,0.12)]">
      <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-950">挂号确认已同步到病历页</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            请直接在病历页核对登记信息和挂号建议，不再单独展示聊天卡片。
          </p>
        </div>
        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
          病历页处理中
        </span>
      </div>
    </div>
  );
}

/**
 * Custom image component that handles artifact URLs
 */
function MessageImage({
  src,
  alt,
  threadId,
  maxWidth = "90%",
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  threadId: string;
  maxWidth?: string;
}) {
  if (!src) return null;

  const imgClassName = cn("overflow-hidden rounded-lg", `max-w-[${maxWidth}]`);

  if (typeof src !== "string") {
    return <img className={imgClassName} src={src} alt={alt} {...props} />;
  }

  const url = src.startsWith("/mnt/") ? resolveArtifactURL(src, threadId) : src;

  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <img className={imgClassName} src={url} alt={alt} {...props} />
    </a>
  );
}

function MessageContent_({
  className,
  message,
  isLoading = false,
  threadId,
}: {
  className?: string;
  message: Message;
  isLoading?: boolean;
  threadId?: string;
}) {
  const rehypePlugins = useRehypeSplitWordsIntoSpans(isLoading);
  const isHuman = message.type === "human";
  const { thread_id: paramsThreadId } = useParams<{ thread_id: string }>();
  const messageThreadId = (message as Message & { thread_id?: string }).thread_id;
  const effectiveThreadId = threadId ?? messageThreadId ?? paramsThreadId;
  const components = useMemo(
    () => ({
      img: (props: ImgHTMLAttributes<HTMLImageElement>) => (
        <MessageImage {...props} threadId={effectiveThreadId} maxWidth="90%" />
      ),
    }),
    [effectiveThreadId],
  );

  const rawContent = extractContentFromMessage(message);
  const reasoningContent = extractReasoningContentFromMessage(message);

  const files = useMemo(() => {
    const files = message.additional_kwargs?.files;
    if (!Array.isArray(files) || files.length === 0) {
      if (rawContent.includes("<uploaded_files>")) {
        // If the content contains the <uploaded_files> tag, we return the parsed files from the content for backward compatibility.
        return parseUploadedFiles(rawContent);
      }
      return null;
    }
    return files as FileInMessage[];
  }, [message.additional_kwargs?.files, rawContent]);

  const contentToDisplay = useMemo(() => {
    if (isHuman) {
      return rawContent ? stripUploadedFilesTag(rawContent) : "";
    }
    return rawContent ?? "";
  }, [rawContent, isHuman]);

  // [ADR-021] Detect appointment_preview JSON in AI messages and render interactive card
  const appointmentPreviewData = useMemo(() => {
    if (isHuman || !contentToDisplay) return null;
    const trimmed = contentToDisplay.trim();
    if (trimmed.startsWith("{") && trimmed.includes('"appointment_preview"')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.type === "appointment_preview") return parsed;
      } catch {
        // Not JSON, fall through to normal rendering
      }
    }
    const re1 = /\{[\s\S]*"type"\s*:\s*"appointment_preview"[\s\S]*\}/;
    const jsonMatch = re1.exec(trimmed);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.type === "appointment_preview") return parsed;
      } catch {
        // Not valid JSON
      }
    }
    return null;
  }, [contentToDisplay, isHuman]);

  // Detect medical_record JSON in AI messages and render interactive MedicalRecordCard
  const medicalRecordData: MedicalRecordData | null = useMemo(() => {
    if (isHuman || !contentToDisplay) return null;
    const trimmed = contentToDisplay.trim();
    if (trimmed.startsWith("{") && trimmed.includes('"medical_record"')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.type === "medical_record") return parsed as MedicalRecordData;
      } catch {
        // Not JSON
      }
    }
    const re2 = /\{[\s\S]*"type"\s*:\s*"medical_record"[\s\S]*\}/;
    const jsonMatch = re2.exec(trimmed);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.type === "medical_record") return parsed as MedicalRecordData;
      } catch {
        // Not valid JSON
      }
    }
    return null;
  }, [contentToDisplay, isHuman]);

  const filesList =
    files && files.length > 0 && effectiveThreadId ? (
      <RichFilesList files={files} threadId={effectiveThreadId} />
    ) : null;

  // Uploading state: mock AI message shown while files upload
  if (message.additional_kwargs?.element === "task") {
    return (
      <AIElementMessageContent className={className}>
        <Task defaultOpen={false}>
          <TaskTrigger title="">
            <div className="text-muted-foreground flex w-full cursor-default items-center gap-2 text-sm select-none">
              <Loader className="size-4" />
              <span>{contentToDisplay}</span>
            </div>
          </TaskTrigger>
        </Task>
      </AIElementMessageContent>
    );
  }

  // Reasoning-only AI message (no main response content yet)
  if (!isHuman && reasoningContent && !rawContent) {
    return (
      <AIElementMessageContent className={className}>
        <Reasoning isStreaming={isLoading}>
          <ReasoningTrigger />
          <ReasoningContent>{reasoningContent}</ReasoningContent>
        </Reasoning>
      </AIElementMessageContent>
    );
  }

  if (isHuman) {
    const messageResponse = contentToDisplay ? (
      <AIElementMessageResponse
        remarkPlugins={humanMessagePlugins.remarkPlugins}
        rehypePlugins={humanMessagePlugins.rehypePlugins}
        components={components}
      >
        {contentToDisplay}
      </AIElementMessageResponse>
    ) : null;
    return (
      <div className={cn("ml-auto flex flex-col gap-2", className)}>
        {filesList}
        {messageResponse && (
          <AIElementMessageContent className="w-fit">
            {messageResponse}
          </AIElementMessageContent>
        )}
      </div>
    );
  }

  if (appointmentPreviewData) {
    return (
      <AIElementMessageContent className={className}>
        <RegistrationNotice />
      </AIElementMessageContent>
    );
  }

  if (medicalRecordData) {
    return (
      <AIElementMessageContent className={className}>
        <MedicalRecordNotice data={medicalRecordData} />
      </AIElementMessageContent>
    );
  }

  return (
    <AIElementMessageContent className={className}>
      {filesList}
      <MarkdownContent
        content={contentToDisplay}
        isLoading={isLoading}
        rehypePlugins={[...rehypePlugins, [rehypeKatex, { output: "html" }]]}
        className="my-3"
        components={components}
      />
    </AIElementMessageContent>
  );
}

/**
 * Get file extension and check helpers
 */
const getFileExt = (filename: string) =>
  filename.split(".").pop()?.toLowerCase() ?? "";

const FILE_TYPE_MAP: Record<string, string> = {
  json: "JSON",
  csv: "CSV",
  txt: "TXT",
  md: "Markdown",
  py: "Python",
  js: "JavaScript",
  ts: "TypeScript",
  tsx: "TSX",
  jsx: "JSX",
  html: "HTML",
  css: "CSS",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  pdf: "PDF",
  png: "PNG",
  jpg: "JPG",
  jpeg: "JPEG",
  gif: "GIF",
  svg: "SVG",
  zip: "ZIP",
  tar: "TAR",
  gz: "GZ",
};

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

function getFileTypeLabel(filename: string): string {
  const ext = getFileExt(filename);
  return FILE_TYPE_MAP[ext] ?? (ext.toUpperCase() || "FILE");
}

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.includes(getFileExt(filename));
}

/**
 * Format bytes to human-readable size string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "—";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * List of files from additional_kwargs.files (with optional upload status).
 * Files with ai_analysis_text are shown in a dedicated OCR result card.
 */
function RichFilesList({
  files,
  threadId,
}: {
  files: FileInMessage[];
  threadId: string;
}) {
  if (files.length === 0) return null;

  // Split files: images with OCR results vs regular files
  const ocrFiles = files.filter(
    (f) => f.ai_analysis_text && isImageFile(f.filename),
  );
  const regularFiles = files.filter(
    (f) => !f.ai_analysis_text || !isImageFile(f.filename),
  );

  return (
    <div className="mb-2 flex flex-col gap-3">
      {/* Regular file thumbnails (right-aligned) */}
      {regularFiles.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {regularFiles.map((file, index) => (
            <RichFileCard
              key={`${file.filename}-${index}`}
              file={file}
              threadId={threadId}
            />
          ))}
        </div>
      )}
      {/* OCR result cards (full-width) */}
      {ocrFiles.map((file, index) => (
        <OcrResultCard
          key={`ocr-${file.filename}-${index}`}
          file={file}
          threadId={threadId}
        />
      ))}
    </div>
  );
}

/**
 * OCR result card: shows the original uploaded image alongside the structured
 * Markdown recognition result (Plan E: PPStructureV3 + Qwen3.5-35B-A3B).
 */
function OcrResultCard({
  file,
  threadId,
}: {
  file: FileInMessage;
  threadId: string;
}) {
  const fileUrl = file.path
    ? file.path.startsWith("/api/")
      ? `${getBackendBaseURL()}${file.path}`
      : resolveArtifactURL(file.path, threadId)
    : "";

  return (
    <div className="bg-background border-border/40 w-full overflow-hidden rounded-lg border shadow-sm">
      {/* Header: filename */}
      <div className="border-border/40 flex items-center gap-2 border-b px-4 py-2">
        <FileIcon className="text-muted-foreground size-4 shrink-0" />
        <span className="text-foreground text-sm font-medium">
          {file.filename}
        </span>
        <Badge
          variant="secondary"
          className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-normal"
        >
          化验单识别
        </Badge>
      </div>
      {/* Body: original image + OCR markdown */}
      <div className="flex flex-col gap-3 p-4 md:flex-row">
        {/* Original image thumbnail */}
        {fileUrl && (
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group shrink-0"
          >
            <img
              src={fileUrl}
              alt={file.filename}
              className="h-auto max-h-60 w-auto max-w-48 rounded border object-contain transition-transform group-hover:scale-[1.02]"
            />
            <span className="text-muted-foreground mt-1 block text-center text-[10px]">
              点击查看原图
            </span>
          </a>
        )}
        {/* OCR Markdown result */}
        {file.ai_analysis_text && (
          <div className="min-w-0 flex-1 overflow-x-auto">
            <MarkdownContent
              content={file.ai_analysis_text}
              isLoading={false}
              rehypePlugins={[[rehypeKatex, { output: "html" }]]}
              className="text-sm"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Single file card that handles FileInMessage (supports uploading state)
 */
function RichFileCard({
  file,
  threadId,
}: {
  file: FileInMessage;
  threadId: string;
}) {
  const { t } = useI18n();
  const isUploading = file.status === "uploading";
  const isImage = isImageFile(file.filename);

  if (isUploading) {
    return (
      <div className="bg-background border-border/40 flex max-w-50 min-w-30 flex-col gap-1 rounded-lg border p-3 opacity-60 shadow-sm">
        <div className="flex items-start gap-2">
          <Loader2Icon className="text-muted-foreground mt-0.5 size-4 shrink-0 animate-spin" />
          <span
            className="text-foreground truncate text-sm font-medium"
            title={file.filename}
          >
            {file.filename}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Badge
            variant="secondary"
            className="rounded px-1.5 py-0.5 text-[10px] font-normal"
          >
            {getFileTypeLabel(file.filename)}
          </Badge>
          <span className="text-muted-foreground text-[10px]">
            {t.uploads.uploading}
          </span>
        </div>
      </div>
    );
  }

  if (!file.path) return null;

  // artifact_url starts with /api/ and already contains the real thread ID;
  // virtual_path starts with /mnt/ and needs resolveArtifactURL to build the full URL.
  const fileUrl = file.path.startsWith("/api/")
    ? `${getBackendBaseURL()}${file.path}`
    : resolveArtifactURL(file.path, threadId);

  if (isImage) {
    return (
      <a
        href={fileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="group border-border/40 relative block overflow-hidden rounded-lg border"
      >
        <img
          src={fileUrl}
          alt={file.filename}
          className="h-32 w-auto max-w-60 object-cover transition-transform group-hover:scale-105"
        />
      </a>
    );
  }

  return (
    <div className="bg-background border-border/40 flex max-w-50 min-w-30 flex-col gap-1 rounded-lg border p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <FileIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <span
          className="text-foreground truncate text-sm font-medium"
          title={file.filename}
        >
          {file.filename}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Badge
          variant="secondary"
          className="rounded px-1.5 py-0.5 text-[10px] font-normal"
        >
          {getFileTypeLabel(file.filename)}
        </Badge>
        <span className="text-muted-foreground text-[10px]">
          {formatBytes(file.size)}
        </span>
      </div>
    </div>
  );
}

const MessageContent = memo(MessageContent_);
