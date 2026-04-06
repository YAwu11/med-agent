"use client";

import { ClipboardList, FileImage, MessagesSquare } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { AuroraText } from "../ui/aurora-text";

let waved = false;

export function Welcome({
  className,
  mode,
}: {
  className?: string;
  mode?: "ultra" | "pro" | "thinking" | "flash";
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const isUltra = useMemo(() => mode === "ultra", [mode]);
  const colors = useMemo(() => {
    if (isUltra) {
      return ["#efefbb", "#e9c665", "#e3a812"];
    }
    return ["var(--color-foreground)"];
  }, [isUltra]);
  useEffect(() => {
    waved = true;
  }, []);
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col items-center justify-center gap-2 px-8 py-4 text-center",
        className,
      )}
    >
      <div className="text-2xl font-bold">
        {searchParams.get("mode") === "skill" ? (
          `✨ ${t.welcome.createYourOwnSkill} ✨`
        ) : (
          <div className="flex items-center gap-2">
            <div className={cn("inline-block", !waved ? "animate-wave" : "")}>
              {isUltra ? "🚀" : "👋"}
            </div>
            <AuroraText colors={colors}>{t.welcome.greeting}</AuroraText>
          </div>
        )}
      </div>
      {searchParams.get("mode") === "skill" ? (
        <div className="text-muted-foreground text-sm">
          {t.welcome.createYourOwnSkillDescription.includes("\n") ? (
            <pre className="font-sans whitespace-pre">
              {t.welcome.createYourOwnSkillDescription}
            </pre>
          ) : (
            <p>{t.welcome.createYourOwnSkillDescription}</p>
          )}
        </div>
      ) : (
        <div className="text-muted-foreground text-sm">
          {t.welcome.description.includes("\n") ? (
            <pre className="whitespace-pre">{t.welcome.description}</pre>
          ) : (
            <p>{t.welcome.description}</p>
          )}
        </div>
      )}

      {searchParams.get("mode") !== "skill" ? (
        <div className="mt-2 grid w-full gap-3 text-left sm:grid-cols-3">
          {[
            {
              icon: ClipboardList,
              title: "先补病历页",
              description: "先填写姓名、年龄、性别和主诉，AI 会在每轮对话里自动读取这些信息。",
            },
            {
              icon: FileImage,
              title: "再传检查资料",
              description: "化验单、检查单和影像图都可以上传，病例页会集中展示原图与解析状态。",
            },
            {
              icon: MessagesSquare,
              title: "最后继续问诊",
              description: "资料还在处理中时，系统会提醒等待；资料齐全后再进行综合判断会更稳妥。",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-3xl border border-cyan-100 bg-[linear-gradient(180deg,rgba(236,254,255,0.78),rgba(255,255,255,0.96))] px-4 py-4 shadow-[0_12px_32px_rgba(8,145,178,0.08)]"
            >
              <div className="flex size-10 items-center justify-center rounded-2xl bg-cyan-600 text-white shadow-[0_10px_22px_rgba(8,145,178,0.2)]">
                <item.icon className="size-[18px]" />
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-900">{item.title}</p>
              <p className="mt-1 text-xs leading-6 text-slate-500">{item.description}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
