"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  AppointmentPreview,
  type AppointmentPreviewData,
} from "./AppointmentPreview";

interface AppointmentPreviewDialogProps {
  data: AppointmentPreviewData | null;
  open: boolean;
  onClose: () => void;
}

export function AppointmentPreviewDialog({
  data,
  open,
  onClose,
}: AppointmentPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-blue-100 bg-white/98 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>挂号信息确认</DialogTitle>
          <DialogDescription>
            AI 已生成挂号预览，请先在前端确认或修改信息，再正式提交挂号。
          </DialogDescription>
        </DialogHeader>
        {data ? <AppointmentPreview data={data} onCancel={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}
