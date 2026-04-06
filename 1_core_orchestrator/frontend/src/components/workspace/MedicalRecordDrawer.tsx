"use client";

import { CheckCircle2, FileText, RefreshCw, Send } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AppointmentPreviewData } from "@/components/workspace/AppointmentPreview";
import { getBackendBaseURL } from "@/core/config";
import type { PatientInfoSaveEvent } from "@/core/patient/patientInfoUpdates";
import { cn } from "@/lib/utils";

import {
  MedicalRecordCard,
  type MedicalRecordDialogActions,
} from "./MedicalRecordCard";
import { useMedicalRecordResource } from "./use-medical-record-resource";

interface MedicalRecordDialogProps {
  threadId: string;
  open: boolean;
  onClose: () => void;
  onPatientInfoSaved?: (event: PatientInfoSaveEvent) => Promise<void> | void;
  appointmentPreviewData?: AppointmentPreviewData | null;
  onAppointmentConfirmed?: () => void;
}

interface AppointmentConfirmResponse {
  success: boolean;
  case_id: string;
  short_id: string;
  department?: string | null;
  evidence_count: number;
  message: string;
}

export function MedicalRecordDialog({
  threadId,
  open,
  onClose,
  onPatientInfoSaved,
  appointmentPreviewData,
  onAppointmentConfirmed,
}: MedicalRecordDialogProps) {
  const [actionBar, setActionBar] = useState<MedicalRecordDialogActions | null>(null);
  const [isConfirmingAppointment, setIsConfirmingAppointment] = useState(false);
  const [appointmentConfirmError, setAppointmentConfirmError] = useState<string | null>(null);
  const [appointmentConfirmedMessage, setAppointmentConfirmedMessage] = useState<string | null>(null);
  const {
    data,
    error,
    isFetching,
    isLoading,
    refetch,
  } = useMedicalRecordResource(threadId);

  useEffect(() => {
    setActionBar(null);
    setIsConfirmingAppointment(false);
    setAppointmentConfirmError(null);
    setAppointmentConfirmedMessage(null);
  }, [threadId]);

  const handleConfirmAppointment = async () => {
    if (!appointmentPreviewData) {
      return;
    }

    setIsConfirmingAppointment(true);
    setAppointmentConfirmError(null);
    try {
      const response = await fetch(
        `${getBackendBaseURL()}/api/threads/${threadId}/confirm-appointment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patient_info:
              actionBar?.currentPatientInfo ?? data?.patient_info ?? appointmentPreviewData.patient_info,
            selected_evidence_ids: appointmentPreviewData.evidence_items.map((item) => item.id),
            priority: appointmentPreviewData.suggested_priority,
            department: appointmentPreviewData.suggested_department,
            reason: appointmentPreviewData.reason,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = (await response.json()) as AppointmentConfirmResponse;
      setAppointmentConfirmedMessage(result.message);
      onAppointmentConfirmed?.();
    } catch (confirmError) {
      setAppointmentConfirmError(
        confirmError instanceof Error ? confirmError.message : "挂号提交失败",
      );
    } finally {
      setIsConfirmingAppointment(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        className="max-h-[92vh] overflow-hidden border-none bg-transparent p-0 shadow-none sm:max-w-6xl"
        aria-describedby="medical-record-dialog-description"
        showCloseButton={false}
      >
        <div className="overflow-hidden rounded-[32px] border border-cyan-200/70 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_40%),linear-gradient(180deg,rgba(248,250,252,0.96),rgba(255,255,255,0.94))] shadow-[0_32px_96px_rgba(15,23,42,0.22)]">
          <DialogHeader className="border-b border-cyan-100 px-5 py-5 text-left sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-cyan-600 text-white shadow-[0_12px_24px_rgba(8,145,178,0.28)]">
                    <FileText className="size-5" />
                  </div>
                  <div>
                    <DialogTitle className="text-xl tracking-tight text-slate-950">
                      登记与挂号确认
                    </DialogTitle>
                    <DialogDescription
                      id="medical-record-dialog-description"
                      className="mt-1 text-sm leading-6 text-slate-600"
                    >
                      在这里统一补齐登记信息、核对已归档资料，并在需要时直接完成挂号确认。
                    </DialogDescription>
                    {appointmentPreviewData ? (
                      <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50/80 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-blue-800">
                          <span>AI 已生成挂号预览</span>
                          {appointmentPreviewData.suggested_department ? (
                            <span className="rounded-full border border-blue-200 bg-white/80 px-2 py-0.5 text-xs font-medium text-blue-700">
                              建议科室：{appointmentPreviewData.suggested_department}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-blue-700/80">
                          直接在这里核对患者信息后提交挂号；患者聊天区不再单独显示挂号预览卡片。
                        </p>
                        {appointmentConfirmedMessage ? (
                          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 className="size-4" />
                            {appointmentConfirmedMessage}
                          </div>
                        ) : null}
                        {appointmentConfirmError ? (
                          <p className="mt-3 text-xs font-medium text-rose-600">
                            {appointmentConfirmError}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isFetching}
                className="min-h-11 cursor-pointer rounded-full border border-cyan-200 bg-white/90 px-4 py-2 text-sm font-medium text-cyan-800 transition-colors hover:border-cyan-300 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="inline-flex items-center gap-2">
                  <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
                  重新加载
                </span>
              </button>
              {actionBar ? (
                <>
                  <button
                    type="button"
                    onClick={actionBar.onReset}
                    disabled={!actionBar.isDirty || actionBar.isSaving}
                    className="min-h-11 cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    恢复未保存
                  </button>
                  <button
                    type="button"
                    onClick={actionBar.onRefreshUploads}
                    disabled={actionBar.uploadsLoading}
                    className="min-h-11 cursor-pointer rounded-full border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-medium text-cyan-800 transition-colors hover:border-cyan-300 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="inline-flex items-center gap-2">
                      <RefreshCw className={cn("size-4", actionBar.uploadsLoading && "animate-spin")} />
                      刷新资料
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={actionBar.onSave}
                    disabled={!actionBar.isDirty || actionBar.isSaving}
                    className="min-h-11 cursor-pointer rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(5,150,105,0.24)] transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-emerald-300"
                  >
                    保存更改
                  </button>
                  {appointmentPreviewData && !appointmentConfirmedMessage ? (
                    <button
                      type="button"
                      onClick={() => void handleConfirmAppointment()}
                      disabled={isConfirmingAppointment}
                      className="min-h-11 cursor-pointer rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(37,99,235,0.26)] transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                      <span className="inline-flex items-center gap-2">
                        {isConfirmingAppointment ? (
                          <RefreshCw className="size-4 animate-spin" />
                        ) : (
                          <Send className="size-4" />
                        )}
                        {isConfirmingAppointment ? "提交中..." : "确认挂号"}
                      </span>
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </DialogHeader>

          <div className="max-h-[calc(92vh-112px)] overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
            {isLoading && !data ? (
              <div className="flex min-h-60 items-center justify-center rounded-[28px] border border-dashed border-cyan-200 bg-white/70 text-sm text-slate-500">
                <span className="inline-flex items-center gap-2">
                  <RefreshCw className="size-4 animate-spin" />
                  正在加载病例页...
                </span>
              </div>
            ) : null}

            {error ? (
              <div className="flex min-h-60 flex-col items-center justify-center rounded-[28px] border border-rose-200 bg-rose-50 px-6 text-center">
                <p className="text-base font-semibold text-rose-700">病例页加载失败</p>
                <p className="mt-2 text-sm leading-6 text-rose-600">{error.message}</p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="mt-4 min-h-11 cursor-pointer rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700"
                >
                  重试
                </button>
              </div>
            ) : null}

            {!isLoading && !error && data ? (
              <MedicalRecordCard
                data={data}
                mode="dialog"
                onRefresh={() => refetch().then(() => undefined)}
                onPatientInfoSaved={onPatientInfoSaved}
                onActionBarChange={setActionBar}
              />
            ) : null}

            {!isLoading && !error && !data ? (
              <div className="flex min-h-60 items-center justify-center rounded-[28px] border border-dashed border-cyan-200 bg-white/70 px-6 text-center text-sm leading-6 text-slate-500">
                当前还没有登记信息。先告诉 AI 您的症状，或直接上传检查资料，登记页就会自动生成。
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}