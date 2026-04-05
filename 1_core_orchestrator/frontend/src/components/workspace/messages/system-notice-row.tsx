import { cn } from "@/lib/utils";

export function SystemNoticeRow({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex w-full items-center gap-3 py-1.5 text-[12px] text-slate-500", className)}
    >
      <div className="h-px flex-1 bg-slate-200" />
      <div className="max-w-[75%] text-center font-medium tracking-[0.08em] text-slate-500">
        {text}
      </div>
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}