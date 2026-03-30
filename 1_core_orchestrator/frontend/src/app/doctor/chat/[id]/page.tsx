"use client";

import React, { useState } from "react";
import { DoctorChatSidebar } from "@/components/doctor/DoctorChatSidebar";
import { EvidenceDesk } from "@/components/doctor/EvidenceDesk";

export default function DoctorChatPage({ params }: { params: Promise<{ id: string }> }) {
  // Next.js 15 / React 19 强制规范：动态路由 params 是一个 Promise，必须用 React.use() 拆包
  const resolvedParams = React.use(params);
  
  // 简化的状态树 (将来可以用 Context 优化，初期用 props drilling 保证简单可靠)
  const [activeTab, setActiveTab] = useState<string>("vitals");
  const [isReviewPassed, setIsReviewPassed] = useState(false);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-slate-50">
      {/* 70% 左主视图 - Medical Evidence Desk */}
      <div className="flex-1 min-w-0 bg-slate-50 relative flex flex-col shadow-inner overflow-hidden">
        <EvidenceDesk 
          activeTab={activeTab} 
          onTabChange={setActiveTab} 
          isReviewPassed={isReviewPassed}
          onReviewPass={() => setIsReviewPassed(true)}
          caseId={resolvedParams.id}
        />
      </div>

      {/* 30% 右侧 - AI Chat Assistant (Copilot) */}
      <div className="w-[30%] xl:w-[400px] shrink-0 border-l border-slate-200 bg-white/50 relative flex flex-col shadow-[-4px_0_12px_rgba(0,0,0,0.02)] z-20">
        <DoctorChatSidebar threadId={resolvedParams.id} />
      </div>
    </div>
  );
}
