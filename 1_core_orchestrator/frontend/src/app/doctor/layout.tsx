import { ShieldAlert, Inbox, BarChart3, History, Settings, BookOpen } from "lucide-react";
import Link from "next/link";
import React from "react";
import { Toaster } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

const navItems = [
  { href: "/doctor/queue", label: "候诊队列", icon: Inbox },
  { href: "/doctor/stats", label: "统计看板", icon: BarChart3 },
  { href: "/doctor/history", label: "历史病例", icon: History },
  { href: "/doctor/knowledge", label: "知识库", icon: BookOpen },
  { href: "/doctor/settings", label: "偏好设置", icon: Settings },
];

export default function DoctorWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // 强制使用 Light Mode 和米白偏灰底色 (bg-slate-50)，移除暗色依赖
    <div className="light flex w-full flex-col bg-slate-50 text-slate-900 font-sans h-screen overflow-hidden">
      {/* 顶部天际线导航栏 */}
      <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-slate-200 bg-white/80 px-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link href="/doctor/queue" className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 font-bold text-white shadow-sm">
              M
            </div>
            <span className="text-lg font-semibold tracking-tight text-slate-800">
              MedAgent<span className="font-light text-slate-400"> / Doctor</span>
            </span>
          </Link>

          {/* Page Navigation */}
          <nav className="flex items-center gap-1 ml-6 border-l border-slate-200 pl-6">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* 监管模式 Toggle */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm transition-all hover:bg-slate-50">
            <ShieldAlert className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-600 mr-2">监管模式 (Supervisory)</span>
            <Switch id="supervisory-mode" />
          </div>
          
          <div className="h-8 w-8 rounded-full border border-slate-200 bg-slate-100 overflow-hidden shadow-sm">
             <img src="https://api.dicebear.com/7.x/notionists/svg?seed=doctor" alt="Doctor" className="h-full w-full object-cover" />
          </div>
        </div>
      </header>

      {/* 核心子路由渲染区 */}
      <main className="flex-1 flex w-full">
        {children}
      </main>
      <Toaster position="top-center" />
    </div>
  );
}

