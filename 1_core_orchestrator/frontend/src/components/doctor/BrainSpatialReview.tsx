import { type SyntheticEvent, useState } from "react";
import { Streamdown } from "streamdown";

import { getBackendBaseURL } from "@/core/config";
import { streamdownPlugins } from "@/core/streamdown";

interface SpatialVolumes {
  ET?: number | null;
  ED?: number | null;
  NCR?: number | null;
  WT?: number | null;
}

interface SpatialRelations {
  crosses_midline?: boolean | null;
  brainstem_min_dist_mm?: number | null;
  ventricle_compression_ratio?: number | null;
  midline_shift_mm?: number | null;
}

export interface SpatialInfo {
  location?: string | null;
  volumes?: SpatialVolumes | null;
  spatial_relations?: SpatialRelations | null;
  clinical_warning?: string | null;
}

interface EditableSpatialInfo {
  location: string;
  vol_et: number | string;
  vol_ed: number | string;
  vol_ncr: number | string;
  vol_wt: number | string;
  crosses_midline: boolean;
  brainstem_dist: number | string;
  ventricle_ratio: number | string;
  midline_shift: number | string;
}

interface BrainReport {
  cross_check_passed?: boolean;
  report_text?: string;
}

// Since we are mocking the dependency for now, we just define type props
export interface BrainSpatialReviewProps {
  spatialInfo: SpatialInfo;
  slicePngPath?: string;
  evidenceId: string;
  caseId: string;
  status: string;
  threadId?: string;
}

export function BrainSpatialReview({ 
  spatialInfo, 
  slicePngPath, 
  evidenceId, 
  caseId,
  status: initialStatus,
  threadId
}: BrainSpatialReviewProps) {
  const normalizedInitialStatus = initialStatus === "report_generated" ? "reviewed" : initialStatus;
  const [editableInfo, setEditableInfo] = useState<EditableSpatialInfo>({
    location: spatialInfo?.location ?? "",
    vol_et: spatialInfo?.volumes?.ET ?? 0,
    vol_ed: spatialInfo?.volumes?.ED ?? 0,
    vol_ncr: spatialInfo?.volumes?.NCR ?? 0,
    vol_wt: spatialInfo?.volumes?.WT ?? 0,
    crosses_midline: spatialInfo?.spatial_relations?.crosses_midline ?? false,
    brainstem_dist: spatialInfo?.spatial_relations?.brainstem_min_dist_mm ?? 0,
    ventricle_ratio: spatialInfo?.spatial_relations?.ventricle_compression_ratio ?? 1.0,
    midline_shift: spatialInfo?.spatial_relations?.midline_shift_mm ?? 0.0
  });

  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<BrainReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(normalizedInitialStatus);
  const [isOtherLocation, setIsOtherLocation] = useState(false);
  const [showRevision, setShowRevision] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const isPendingReview = status === "pending_review" || status === "pending_doctor_review";
  const isReviewed = status === "reviewed" || status === "report_generated";

  const AAL_ZONES = [
    "额叶", "顶叶", "枕叶", "颞叶", 
    "岛叶", "边缘系统", "基底节区", "丘脑", 
    "小脑", "脑干", "侧脑室", "其他"
  ];

  const handleGenerateReport = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Map local state back to the expected API format
      const payloadInfo = {
        ...spatialInfo,
        location: editableInfo.location,
        volumes: {
          ...spatialInfo?.volumes,
          ET: Number(editableInfo.vol_et),
          ED: Number(editableInfo.vol_ed),
          NCR: Number(editableInfo.vol_ncr),
          WT: Number(editableInfo.vol_wt),
        },
        spatial_relations: {
          ...spatialInfo?.spatial_relations,
          crosses_midline: editableInfo.crosses_midline,
          brainstem_min_dist_mm: Number(editableInfo.brainstem_dist),
          ventricle_compression_ratio: Number(editableInfo.ventricle_ratio),
          midline_shift_mm: Number(editableInfo.midline_shift)
        }
      };

      const res = await fetch(`${getBackendBaseURL()}/api/cases/${caseId}/brain-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evidence_id: evidenceId,
          spatial_info: payloadInfo,
          slice_png_path: slicePngPath ?? ""
        })
      });

      if (!res.ok) {
        throw new Error(`请求失败: ${res.statusText}`);
      }
      
      const data = (await res.json()) as { report?: BrainReport | null };
      setReport(data.report ?? null);
      setStatus("reviewed");
      
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "报告生成失败");
    } finally {
      setLoading(false);
    }
  };

  const getImageUrl = () => {
    if (!slicePngPath) return null;
    const filename = slicePngPath.split(/[\/\\]/).pop();
    const tid = threadId ?? "local";
    return `${getBackendBaseURL()}/api/threads/${tid}/artifacts/${filename}`;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <div className="border-b px-4 py-3 bg-white flex items-center justify-between sticky top-0 z-10">
        <h3 className="text-lg font-medium flex items-center gap-2 text-slate-800">
          🧠脑肿瘤分析结果
          {isPendingReview && (
            <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full animate-pulse border border-amber-200">
              待医生审核
            </span>
          )}
          {isReviewed && (
            <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-1 rounded-full border border-emerald-200">
              报告已生成
            </span>
          )}
        </h3>
      </div>

      <div className="flex-1 overflow-auto p-4 flex flex-col lg:flex-row gap-6">
        {/* Left Column: Image Viewer */}
        <div className="flex-1 bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col min-h-[400px]">
          <div className="bg-slate-100 px-4 py-2 border-b text-sm font-medium text-slate-600">
            2D 渲染切片图 (T1ce + FLAIR)
          </div>
          <div className="flex-1 relative flex items-center justify-center bg-black">
            {slicePngPath ? (
              <img 
                src={getImageUrl() ?? ""} 
                alt="Brain Slice Analysis" 
                className="max-w-full max-h-full object-contain"
                onError={(e: SyntheticEvent<HTMLImageElement>) => {
                  const imageElement = e.currentTarget;
                  imageElement.style.display = "none";
                  const parentElement = imageElement.parentElement;
                  if (parentElement) {
                    parentElement.innerHTML = '<div class="text-slate-400">图片加载失败</div>';
                  }
                }}
              />
            ) : (
              <div className="text-slate-500">暂无包含肿瘤的切片图片</div>
            )}
          </div>
        </div>

        {/* Right Column: Editable Spatial Info */}
        <div className="flex-1 flex flex-col gap-4 min-w-[300px] max-w-xl">
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h4 className="font-semibold text-slate-800 mb-4 border-b pb-2 flex items-center justify-between">
              几何特征校验面板
              <span className="text-xs font-normal text-slate-500">可手动修正异常值</span>
            </h4>
            
            {spatialInfo?.clinical_warning && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800 flex gap-2 items-start">
                <span className="text-xl">⚠️</span>
                <div>
                  <strong className="block mb-1">系统临床预警</strong>
                  {spatialInfo.clinical_warning}
                </div>
              </div>
            )}
            
            <div className="space-y-4">
              {/* Location */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  解剖位置 <span className="text-slate-400 text-xs font-normal">(MNI+AAL3 图谱定位)</span>
                </label>
                {!isOtherLocation ? (
                  <select
                    value={AAL_ZONES.find(z => editableInfo.location.includes(z)) ? AAL_ZONES.find(z => editableInfo.location.includes(z)) : "其他"}
                    onChange={(e) => {
                      if (e.target.value === "其他") {
                        setIsOtherLocation(true);
                        setEditableInfo({...editableInfo, location: ""});
                      } else {
                        setEditableInfo({...editableInfo, location: "右侧" + e.target.value});
                      }
                    }}
                    className="w-full text-sm p-2 border rounded focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
                    disabled={isReviewed}
                  >
                    {AAL_ZONES.map(z => <option key={z} value={z}>{z}</option>)}
                  </select>
                ) : (
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="请输入具体解剖位置..."
                      value={editableInfo.location}
                      onChange={(e) => setEditableInfo({...editableInfo, location: e.target.value})}
                      className="w-full text-sm p-2 border rounded focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
                      disabled={isReviewed}
                    />
                    <button 
                      onClick={() => setIsOtherLocation(false)}
                      className="whitespace-nowrap px-3 text-sm text-blue-600 border border-blue-600 rounded hover:bg-blue-50"
                      disabled={isReviewed}
                    >返回选择</button>
                  </div>
                )}
              </div>

              {/* Volumes grid */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-slate-50 p-3 rounded border">
                  <label className="block text-xs text-slate-500 mb-1">增强核心 (ET) 体积</label>
                  <div className="flex items-center">
                    <input 
                      type="number" step="0.1" 
                      value={editableInfo.vol_et}
                      onChange={(e) => setEditableInfo({...editableInfo, vol_et: e.target.value})}
                      className="w-full bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-400 outline-none"
                      disabled={isReviewed}
                    />
                    <span className="text-slate-500 text-xs ml-1">cm³</span>
                  </div>
                </div>
                <div className="bg-slate-50 p-3 rounded border">
                  <label className="block text-xs text-slate-500 mb-1">水肿区 (ED) 体积</label>
                  <div className="flex items-center">
                    <input 
                      type="number" step="0.1"
                      value={editableInfo.vol_ed}
                      onChange={(e) => setEditableInfo({...editableInfo, vol_ed: e.target.value})}
                      className="w-full bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-400 outline-none"
                      disabled={isReviewed}
                    />
                    <span className="text-slate-500 text-xs ml-1">cm³</span>
                  </div>
                </div>
                <div className="bg-slate-50 p-3 rounded border">
                  <label className="block text-xs text-slate-500 mb-1">坏死核心 (NCR) 体积</label>
                  <div className="flex items-center">
                    <input 
                      type="number" step="0.1"
                      value={editableInfo.vol_ncr}
                      onChange={(e) => setEditableInfo({...editableInfo, vol_ncr: e.target.value})}
                      className="w-full bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-400 outline-none"
                      disabled={isReviewed}
                    />
                    <span className="text-slate-500 text-xs ml-1">cm³</span>
                  </div>
                </div>
                <div className="bg-slate-50 p-3 rounded border">
                  <label className="block text-xs text-slate-500 mb-1">全肿瘤 (WT) 体积</label>
                  <div className="flex items-center">
                    <input 
                      type="number" step="0.1"
                      value={editableInfo.vol_wt}
                      onChange={(e) => setEditableInfo({...editableInfo, vol_wt: e.target.value})}
                      className="w-full bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-400 outline-none font-medium"
                      disabled={isReviewed}
                    />
                    <span className="text-slate-500 text-xs ml-1">cm³</span>
                  </div>
                </div>
              </div>

              {/* Spatial Relations */}
              <div className="space-y-3 pt-2">
                <h5 className="text-sm font-medium text-slate-700">关键空间特征 (手术决策相关)</h5>
                
                <div className="flex items-center justify-between p-2 bg-slate-50 border rounded text-sm">
                  <span className="text-slate-600">肿瘤跨跨越正中矢状面</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={editableInfo.crosses_midline}
                      onChange={(e) => setEditableInfo({...editableInfo, crosses_midline: e.target.checked})}
                      disabled={isReviewed}
                    />
                    <div className={"w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500 " + (isReviewed ? "opacity-50" : "")}></div>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-2 bg-slate-50 border rounded text-sm">
                    <span className="text-slate-500 text-xs block mb-1">距脑干最短距离</span>
                    <div className="flex items-center">
                      <input 
                        type="number" step="0.1" 
                        value={editableInfo.brainstem_dist}
                        onChange={(e) => setEditableInfo({...editableInfo, brainstem_dist: e.target.value})}
                        className="w-full bg-transparent outline-none font-medium"
                        disabled={isReviewed}
                      />
                      <span className="text-slate-400 text-xs ml-1">mm</span>
                    </div>
                  </div>
                  <div className="p-2 bg-slate-50 border rounded text-sm">
                    <span className="text-slate-500 text-xs block mb-1">中线受压偏移距离</span>
                    <div className="flex items-center">
                      <input 
                        type="number" step="0.1" 
                        value={editableInfo.midline_shift}
                        onChange={(e) => setEditableInfo({...editableInfo, midline_shift: e.target.value})}
                        className="w-full bg-transparent outline-none font-medium"
                        disabled={isReviewed}
                      />
                      <span className="text-slate-400 text-xs ml-1">mm</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Button */}
                {isPendingReview && (
                 <div className="pt-4 mt-2 border-t space-y-3">
                    <div className="flex gap-3">
                      <button 
                        onClick={handleGenerateReport}
                        disabled={loading}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded shadow-sm flex items-center justify-center transition-colors disabled:opacity-75"
                      >
                        {loading ? (
                          <span className="flex items-center gap-2">
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            正在生成报告...
                          </span>
                        ) : "✓ 确认数据并生成报告"}
                      </button>
                      
                      <button 
                        onClick={() => setShowRevision(!showRevision)}
                        className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 rounded border transition-colors whitespace-nowrap"
                      >
                        标记需修正
                      </button>
                    </div>

                    {showRevision && (
                      <div className="p-3 bg-amber-50 rounded border border-amber-200 mt-2">
                        <label className="block text-sm font-medium text-amber-800 mb-1">
                          修正意见 (用于优化算法)
                        </label>
                        <textarea 
                          rows={3}
                          value={revisionNote}
                          onChange={(e) => setRevisionNote(e.target.value)}
                          placeholder="请填写需算法组二次优化的修正细节（如：肿瘤漏切了水肿区 / 误判了钙化灶）..."
                          className="w-full text-sm p-2 border border-amber-300 rounded focus:ring-2 focus:ring-amber-200 focus:border-amber-400 outline-none transition-all"
                        />
                        <button className="mt-2 text-xs bg-amber-600 text-white px-3 py-1.5 rounded hover:bg-amber-700">提交修正反馈</button>
                      </div>
                    )}
                    
                    {error && (
                      <p className="text-red-500 text-xs mt-2 text-center">{error}</p>
                    )}
                 </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Result Area */}
      {report && (
         <div className="border-t bg-white p-5 max-h-[40vh] overflow-y-auto">
            <h4 className="font-medium text-slate-800 mb-3 flex items-center justify-between">
              📄 AI 影像学报告生成结果
              {report.cross_check_passed ? (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full border border-green-200">数据对账通过</span>
              ) : (
                <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full border border-red-200" title="模型生成内容可能存在幻觉，与底层计算数据不一">⚠️ 强行篡改警告</span>
              )}
            </h4>
            <div className="prose prose-slate prose-sm max-w-none bg-slate-50 p-4 rounded border">
              <Streamdown {...streamdownPlugins}>
                {report.report_text ?? "无文本内容"}
              </Streamdown>
            </div>
         </div>
      )}
    </div>
  );
}
