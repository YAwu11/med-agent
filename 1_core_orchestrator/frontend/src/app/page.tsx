import { Stethoscope, UserIcon, ArrowRight, HeartPulse } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";

export default function AppEntryPortal() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
      
      {/* 头部品牌 */}
      <div className="text-center mb-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="mx-auto h-20 w-20 bg-blue-600 outline outline-4 outline-blue-50/50 rounded-2xl flex items-center justify-center shadow-lg mb-6 shadow-blue-600/20">
           <HeartPulse className="h-10 w-10 text-white" />
        </div>
        <h1 className="text-4xl tracking-tight font-extrabold text-slate-900 sm:text-5xl md:text-6xl">
          MedAgent <span className="text-blue-600">Copilot</span>
        </h1>
        <p className="mt-3 max-w-md mx-auto text-base text-slate-500 sm:text-lg md:mt-5 md:text-xl md:max-w-3xl">
          新一代医疗多智能体系统。请选择您的登录身份以进入专属工作台。
        </p>
      </div>

      {/* 分流卡片区 */}
      <div className="max-w-4xl w-full grid grid-cols-1 gap-8 sm:grid-cols-2">
        
        {/* 患者端入口 (Patient Portal) */}
        <Link 
          href="/workspace" 
          className="group relative rounded-3xl border border-slate-200 bg-white p-8 shadow-sm hover:shadow-xl hover:border-blue-300 transition-all duration-300 overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-2 h-full bg-blue-500 rounded-l-3xl"></div>
          <div className="flex items-center justify-between mb-8">
            <div className="p-4 bg-blue-50 rounded-2xl text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors duration-300">
              <UserIcon className="h-8 w-8" />
            </div>
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Patient</Badge>
          </div>
          <h3 className="text-2xl font-bold text-slate-900 mb-2 group-hover:text-blue-700 transition-colors">
            个人接诊端
          </h3>
          <p className="text-slate-500 mb-8 min-h-[3rem]">
            上传您的病历、医疗影像或化验单，获取 AI 医生的初步问诊和整理服务。
          </p>
          <div className="flex items-center text-blue-600 font-semibold group-hover:translate-x-2 transition-transform">
            进入患者系统 <ArrowRight className="ml-2 h-5 w-5" />
          </div>
        </Link>

        {/* 医生端入口 (Doctor Portal) */}
        <Link 
          href="/doctor/queue" 
          className="group relative rounded-3xl border border-slate-200 bg-white p-8 shadow-sm hover:shadow-xl hover:border-teal-300 transition-all duration-300 overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-2 h-full bg-teal-500 rounded-l-3xl"></div>
          <div className="flex items-center justify-between mb-8">
            <div className="p-4 bg-teal-50 rounded-2xl text-teal-600 group-hover:bg-teal-600 group-hover:text-white transition-colors duration-300">
              <Stethoscope className="h-8 w-8" />
            </div>
            <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-200">Physician</Badge>
          </div>
          <h3 className="text-2xl font-bold text-slate-900 mb-2 group-hover:text-teal-700 transition-colors">
            医生工作台
          </h3>
          <p className="text-slate-500 mb-8 min-h-[3rem]">
            访问专业的审核画板，查阅 AI 给出的分诊证据链，并在监管模式下进行最终把关。
          </p>
          <div className="flex items-center text-teal-600 font-semibold group-hover:translate-x-2 transition-transform">
            进入诊断中心 <ArrowRight className="ml-2 h-5 w-5" />
          </div>
        </Link>

      </div>

      {/* 诊断进度入口 (小卡片) */}
      <div className="max-w-4xl w-full mt-6">
        <Link
          href="/workspace/status"
          className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-8 py-5 shadow-sm hover:shadow-md hover:border-purple-300 transition-all duration-300"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-50 rounded-xl text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition-colors duration-300">
              <HeartPulse className="h-6 w-6" />
            </div>
            <div>
              <h4 className="text-lg font-bold text-slate-800 group-hover:text-purple-700 transition-colors">诊断进度查询</h4>
              <p className="text-sm text-slate-500">查看您已提交的问诊材料的处理进度与医生诊断结论</p>
            </div>
          </div>
          <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-purple-600 group-hover:translate-x-1 transition-all" />
        </Link>
      </div>

      <div className="mt-16 text-center text-sm text-slate-400">
         &copy; 2026 DeerFlow Medical Architecture. All rights reserved.
      </div>
    </div>
  );
}
