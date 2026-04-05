"use client";

import {
  Bot,
  Brain,
  Bell,
  BellOff,
  Shield,
  Stethoscope,
  Palette,
  MessageSquare,
  Save,
  RotateCcw,
  Check,
  Info,
  Sparkles,
  Gauge,
  Clock,
  FileText,
  Plus,
  X,
  ChevronRight,
  AlertTriangle,
  Eye,
  Volume2,
  VolumeX,
} from "lucide-react";
import React, { useState, useCallback, useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { getBackendBaseURL } from "@/core/config";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────
interface AIModelOption {
  id: string;
  name: string;
  provider: string;
  description: string;
  speed: "fast" | "medium" | "slow";
  quality: "high" | "medium" | "standard";
  tag?: string;
}

interface QuickPhrase {
  id: string;
  label: string;
  text: string;
}

// ── Config Data ────────────────────────────────────────────
const AI_MODELS: AIModelOption[] = [
  {
    id: "qwen-3.5",
    name: "Qwen 3.5",
    provider: "Alibaba Cloud",
    description: "高速推理，适合日常诊断辅助",
    speed: "fast",
    quality: "high",
    tag: "推荐",
  },
  {
    id: "deepseek-v3",
    name: "DeepSeek V3",
    provider: "DeepSeek",
    description: "强大的医学推理能力，复杂病例首选",
    speed: "medium",
    quality: "high",
    tag: "医学增强",
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    description: "多模态能力出色，影像分析表现稳定",
    speed: "medium",
    quality: "high",
  },
  {
    id: "claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    description: "长文本理解精准，适合病历综合分析",
    speed: "slow",
    quality: "high",
  },
  {
    id: "qwen-2.5-72b",
    name: "Qwen 2.5 72B",
    provider: "Alibaba Cloud",
    description: "大参量开源模型，适合私有化部署",
    speed: "slow",
    quality: "medium",
  },
];

const DEFAULT_QUICK_PHRASES: QuickPhrase[] = [
  { id: "q1", label: "建议复查", text: "建议 2 周后复查，密切观察病情变化。" },
  { id: "q2", label: "药物提醒", text: "请遵医嘱按时服药，如有不适及时就诊。" },
  { id: "q3", label: "正常范围", text: "当前检查结果均在正常参考范围内。" },
  { id: "q4", label: "转专科", text: "建议转至相关专科进一步评估与治疗。" },
];

const ANNOTATION_TEMPLATES = [
  {
    id: "t1",
    name: "标准诊断模板",
    content: "【主诉】\n【现病史】\n【查体】\n【辅助检查】\n【诊断】\n【治疗方案】\n【随访计划】",
  },
  {
    id: "t2",
    name: "影像阅片模板",
    content: "【检查方式】\n【影像所见】\n【异常发现】\n【结论与建议】",
  },
  {
    id: "t3",
    name: "会诊意见模板",
    content: "【会诊原因】\n【既往病史摘要】\n【专科评估】\n【建议】",
  },
];

// ── Reusable section wrapper ───────────────────────────────
function SettingSection({
  title,
  description,
  icon: Icon,
  children,
  badge,
}: {
  title: string;
  description?: string;
  icon: React.ElementType;
  children: React.ReactNode;
  badge?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
        <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-800">{title}</h3>
            {badge && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
                {badge}
              </Badge>
            )}
          </div>
          {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

// ── Reusable setting row ───────────────────────────────────
function SettingRow({
  label,
  description,
  children,
  danger,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-4 first:pt-0 last:pb-0 border-b border-slate-100 last:border-0">
      <div className="flex-1 min-w-0 mr-6">
        <div className={cn("text-sm font-semibold", danger ? "text-red-700" : "text-slate-700")}>{label}</div>
        {description && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <div className="shrink-0 flex items-center">{children}</div>
    </div>
  );
}

// ── Confidence Slider (pure CSS, no slider dependency) ─────
function ConfidenceSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 w-56">
      <input
        type="range"
        min={10}
        max={95}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-2 rounded-full appearance-none bg-slate-200 cursor-pointer accent-blue-600 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-md"
      />
      <span className="text-sm font-bold text-blue-700 tabular-nums w-10 text-right">{value}%</span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────
export default function DoctorSettingsPage() {
  // AI Model
  const [selectedModel, setSelectedModel] = useState("qwen-3.5");
  const [temperature, setTemperature] = useState(0.3);

  // Imaging thresholds
  const [confidenceThreshold, setConfidenceThreshold] = useState(60);
  const [autoReviewAbove, setAutoReviewAbove] = useState(85);

  // Notifications
  const [newCaseNotify, setNewCaseNotify] = useState(true);
  const [criticalAlert, setCriticalAlert] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [digestFreq, setDigestFreq] = useState("realtime");

  // Supervisory mode
  const [supervisoryDefault, setSupervisoryDefault] = useState(true);
  const [requireReviewAll, setRequireReviewAll] = useState(false);

  // Quick phrases
  const [quickPhrases, setQuickPhrases] = useState<QuickPhrase[]>(DEFAULT_QUICK_PHRASES);
  const [newPhraseLabel, setNewPhraseLabel] = useState("");
  const [newPhraseText, setNewPhraseText] = useState("");

  // Templates
  const [selectedTemplate, setSelectedTemplate] = useState("t1");
  const [customTemplate, setCustomTemplate] = useState(
    ANNOTATION_TEMPLATES[0]!.content
  );

  // Display
  const [compactView, setCompactView] = useState(false);
  const [showConfidence, setShowConfidence] = useState(true);
  const [highlightAbnormal, setHighlightAbnormal] = useState(true);
  const [defaultTab, setDefaultTab] = useState("vitals");

  // Save state
  const [isSaved, setIsSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const markChanged = useCallback(() => {
    setHasChanges(true);
    setIsSaved(false);
  }, []);

  const handleSave = async () => {
    try {
      const body = {
        settings: {
          ai_model: selectedModel,
          temperature,
          confidence_threshold: confidenceThreshold,
          auto_approve_threshold: autoReviewAbove,
          supervisory_mode_default: supervisoryDefault,
          require_review_all: requireReviewAll,
          notification_new_case: newCaseNotify,
          notification_urgent_popup: criticalAlert,
          notification_sound: soundEnabled,
          push_frequency: digestFreq,
          display_compact: compactView,
          display_confidence: showConfidence,
          display_highlight_abnormal: highlightAbnormal,
          display_default_tab: defaultTab,
          annotation_template: selectedTemplate,
          annotation_template_text: customTemplate,
          quick_phrases: quickPhrases.map((p) => p.text),
        },
      };
      await fetch(`${getBackendBaseURL()}/api/doctor/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      /* best-effort */
    }
    setIsSaved(true);
    setHasChanges(false);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleReset = async () => {
    try {
      await fetch(`${getBackendBaseURL()}/api/doctor/settings`, { method: "DELETE" });
    } catch { /* best-effort */ }
    setSelectedModel("qwen-3.5");
    setTemperature(0.3);
    setConfidenceThreshold(60);
    setAutoReviewAbove(85);
    setNewCaseNotify(true);
    setCriticalAlert(true);
    setSoundEnabled(false);
    setDigestFreq("realtime");
    setSupervisoryDefault(true);
    setRequireReviewAll(false);
    setQuickPhrases(DEFAULT_QUICK_PHRASES);
    setCompactView(false);
    setShowConfidence(true);
    setHighlightAbnormal(true);
    setDefaultTab("vitals");
    setSelectedTemplate("t1");
    setCustomTemplate(ANNOTATION_TEMPLATES[0]!.content);
    setHasChanges(false);
    setIsSaved(false);
  };

  // Load saved settings from API on mount
  useEffect(() => {
    fetch(`${getBackendBaseURL()}/api/doctor/settings`)
      .then((r) => r.json())
      .then((data) => {
        const s = data?.settings;
        if (!s) return;
        if (s.ai_model) setSelectedModel(s.ai_model);
        if (s.temperature !== undefined) setTemperature(s.temperature);
        if (s.confidence_threshold !== undefined) setConfidenceThreshold(s.confidence_threshold);
        if (s.auto_approve_threshold !== undefined) setAutoReviewAbove(s.auto_approve_threshold);
        if (s.supervisory_mode_default !== undefined) setSupervisoryDefault(s.supervisory_mode_default);
        if (s.require_review_all !== undefined) setRequireReviewAll(s.require_review_all);
        if (s.notification_new_case !== undefined) setNewCaseNotify(s.notification_new_case);
        if (s.notification_urgent_popup !== undefined) setCriticalAlert(s.notification_urgent_popup);
        if (s.notification_sound !== undefined) setSoundEnabled(s.notification_sound);
        if (s.push_frequency) setDigestFreq(s.push_frequency);
        if (s.display_compact !== undefined) setCompactView(s.display_compact);
        if (s.display_confidence !== undefined) setShowConfidence(s.display_confidence);
        if (s.display_highlight_abnormal !== undefined) setHighlightAbnormal(s.display_highlight_abnormal);
        if (s.display_default_tab) setDefaultTab(s.display_default_tab);
        if (s.annotation_template) setSelectedTemplate(s.annotation_template);
        if (s.annotation_template_text) setCustomTemplate(s.annotation_template_text);
      })
      .catch(() => undefined);
  }, []);

  const addQuickPhrase = () => {
    if (!newPhraseLabel.trim() || !newPhraseText.trim()) return;
    setQuickPhrases((prev) => [
      ...prev,
      { id: `q_${Date.now()}`, label: newPhraseLabel.trim(), text: newPhraseText.trim() },
    ]);
    setNewPhraseLabel("");
    setNewPhraseText("");
    markChanged();
  };

  const removeQuickPhrase = (id: string) => {
    setQuickPhrases((prev) => prev.filter((p) => p.id !== id));
    markChanged();
  };

  const currentModel = AI_MODELS.find((m) => m.id === selectedModel);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-4xl mx-auto px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">偏好设置</h1>
            <p className="text-sm text-slate-500 mt-1">自定义 AI 模型、诊断阈值、通知与工作流偏好</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="rounded-full text-slate-600 border-slate-200 hover:bg-slate-100"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              重置默认
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges && !isSaved}
              className={cn(
                "rounded-full px-6 shadow-sm transition-all",
                isSaved
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              )}
            >
              {isSaved ? (
                <>
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  已保存
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  保存设置
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Tabs Navigation */}
        <Tabs defaultValue="ai" className="space-y-6">
          <TabsList className="w-full bg-white border border-slate-200 rounded-2xl p-1 h-auto shadow-sm">
            <TabsTrigger value="ai" className="flex-1 rounded-xl py-2.5 text-sm data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 data-[state=active]:shadow-none">
              <Bot className="h-4 w-4 mr-1.5" />
              AI 模型
            </TabsTrigger>
            <TabsTrigger value="imaging" className="flex-1 rounded-xl py-2.5 text-sm data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 data-[state=active]:shadow-none">
              <Eye className="h-4 w-4 mr-1.5" />
              影像分析
            </TabsTrigger>
            <TabsTrigger value="templates" className="flex-1 rounded-xl py-2.5 text-sm data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 data-[state=active]:shadow-none">
              <FileText className="h-4 w-4 mr-1.5" />
              模板与短语
            </TabsTrigger>
            <TabsTrigger value="notifications" className="flex-1 rounded-xl py-2.5 text-sm data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 data-[state=active]:shadow-none">
              <Bell className="h-4 w-4 mr-1.5" />
              通知
            </TabsTrigger>
            <TabsTrigger value="display" className="flex-1 rounded-xl py-2.5 text-sm data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 data-[state=active]:shadow-none">
              <Palette className="h-4 w-4 mr-1.5" />
              显示
            </TabsTrigger>
          </TabsList>

          {/* ═══════════════ AI Model Tab ═══════════════ */}
          <TabsContent value="ai" className="space-y-6">
            <SettingSection
              title="诊断辅助模型"
              description="选择 AI Copilot 在诊断工作台中使用的大语言模型"
              icon={Brain}
            >
              <div className="space-y-3">
                {AI_MODELS.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => {
                      setSelectedModel(model.id);
                      markChanged();
                    }}
                    className={cn(
                      "w-full text-left p-4 rounded-xl border-2 transition-all duration-200 cursor-pointer group",
                      selectedModel === model.id
                        ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-200"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-800">{model.name}</span>
                        <span className="text-[11px] text-slate-400">{model.provider}</span>
                        {model.tag && (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] px-1.5",
                              model.tag === "推荐"
                                ? "bg-green-50 text-green-700 border-green-200"
                                : "bg-purple-50 text-purple-700 border-purple-200"
                            )}
                          >
                            {model.tag}
                          </Badge>
                        )}
                      </div>
                      <div
                        className={cn(
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                          selectedModel === model.id
                            ? "border-blue-500 bg-blue-500"
                            : "border-slate-300 group-hover:border-slate-400"
                        )}
                      >
                        {selectedModel === model.id && <Check className="h-3 w-3 text-white" />}
                      </div>
                    </div>
                    <p className="text-xs text-slate-500">{model.description}</p>
                    <div className="flex items-center gap-4 mt-2">
                      <div className="flex items-center gap-1">
                        <Gauge className="h-3 w-3 text-slate-400" />
                        <span className="text-[10px] text-slate-500">
                          速度: {model.speed === "fast" ? "⚡ 快" : model.speed === "medium" ? "🔄 中" : "🐢 慢"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Sparkles className="h-3 w-3 text-slate-400" />
                        <span className="text-[10px] text-slate-500">
                          质量: {model.quality === "high" ? "★★★" : model.quality === "medium" ? "★★☆" : "★☆☆"}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </SettingSection>

            <SettingSection
              title="模型参数"
              description="微调 AI 生成行为"
              icon={Sparkles}
            >
              <SettingRow
                label="Temperature (创造性)"
                description="较低值输出更稳定可预测，较高值输出更多样化。医学场景建议 0.2-0.4"
              >
                <div className="flex items-center gap-3 w-56">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={temperature * 100}
                    onChange={(e) => {
                      setTemperature(Number(e.target.value) / 100);
                      markChanged();
                    }}
                    className="flex-1 h-2 rounded-full appearance-none bg-slate-200 cursor-pointer accent-blue-600 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-md"
                  />
                  <span className="text-sm font-bold text-blue-700 tabular-nums w-10 text-right">
                    {temperature.toFixed(2)}
                  </span>
                </div>
              </SettingRow>
            </SettingSection>
          </TabsContent>

          {/* ═══════════════ Imaging Tab ═══════════════ */}
          <TabsContent value="imaging" className="space-y-6">
            <SettingSection
              title="影像分析阈值"
              description="当 AI 置信度低于阈值时，系统将强制要求人工复核"
              icon={Stethoscope}
            >
              <SettingRow
                label="强制复核阈值"
                description={`AI 置信度低于 ${confidenceThreshold}% 的病灶标注将强制标记为"待人工确认"`}
              >
                <ConfidenceSlider
                  value={confidenceThreshold}
                  onChange={(v) => {
                    setConfidenceThreshold(v);
                    markChanged();
                  }}
                />
              </SettingRow>
              <SettingRow
                label="自动通过阈值"
                description={`AI 置信度高于 ${autoReviewAbove}% 的病灶标注将自动标记为"已审核"（仅在监管模式关闭时生效）`}
              >
                <ConfidenceSlider
                  value={autoReviewAbove}
                  onChange={(v) => {
                    setAutoReviewAbove(v);
                    markChanged();
                  }}
                />
              </SettingRow>
            </SettingSection>

            <SettingSection
              title="监管模式 (Supervisory Mode)"
              description="控制 AI 辅助诊断的审核严格程度"
              icon={Shield}
              badge="安全相关"
            >
              <SettingRow
                label="默认开启监管模式"
                description="每次进入诊断工作台时自动启用监管模式，所有 AI 建议均需人工确认"
              >
                <Switch
                  checked={supervisoryDefault}
                  onCheckedChange={(v) => {
                    setSupervisoryDefault(v);
                    markChanged();
                  }}
                />
              </SettingRow>
              <SettingRow
                label="强制审阅所有证据"
                description="提交综合诊断前，要求医生逐项确认所有 Evidence 项目（影像 + 化验 + 体征）"
                danger={!requireReviewAll}
              >
                <Switch
                  checked={requireReviewAll}
                  onCheckedChange={(v) => {
                    setRequireReviewAll(v);
                    markChanged();
                  }}
                />
              </SettingRow>
              {!requireReviewAll && (
                <div className="flex items-start gap-2 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-700 leading-relaxed">
                    <strong>注意：</strong>关闭此选项后，医生可直接提交诊断而无需逐项确认所有证据。
                    在高风险临床场景中建议保持开启。
                  </p>
                </div>
              )}
            </SettingSection>
          </TabsContent>

          {/* ═══════════════ Templates Tab ═══════════════ */}
          <TabsContent value="templates" className="space-y-6">
            <SettingSection
              title="批注模板"
              description="预设诊断批注结构，在 Doctor's Notepad 中快速套用"
              icon={FileText}
            >
              <div className="space-y-4">
                <div className="flex gap-2">
                  {ANNOTATION_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setSelectedTemplate(t.id);
                        setCustomTemplate(t.content);
                        markChanged();
                      }}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer",
                        selectedTemplate === t.id
                          ? "bg-blue-600 text-white shadow-sm"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      )}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                <Textarea
                  value={customTemplate}
                  onChange={(e) => {
                    setCustomTemplate(e.target.value);
                    markChanged();
                  }}
                  className="min-h-[160px] text-sm font-mono leading-relaxed bg-slate-50 border-slate-200"
                  placeholder="在此编辑模板内容..."
                />
              </div>
            </SettingSection>

            <SettingSection
              title="快捷短语库"
              description="在诊断批注和 AI 对话中一键插入常用短语"
              icon={MessageSquare}
            >
              <div className="space-y-3">
                {quickPhrases.map((phrase) => (
                  <div
                    key={phrase.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 group transition-all hover:border-slate-300"
                  >
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] shrink-0">
                      {phrase.label}
                    </Badge>
                    <span className="text-sm text-slate-600 flex-1 min-w-0 truncate">{phrase.text}</span>
                    <button
                      onClick={() => removeQuickPhrase(phrase.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                {/* Add new phrase */}
                <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex gap-3">
                    <Input
                      placeholder="短语标签 (如: 建议复查)"
                      value={newPhraseLabel}
                      onChange={(e) => setNewPhraseLabel(e.target.value)}
                      className="w-40 h-9 text-sm border-slate-200"
                    />
                    <Input
                      placeholder="短语内容..."
                      value={newPhraseText}
                      onChange={(e) => setNewPhraseText(e.target.value)}
                      className="flex-1 h-9 text-sm border-slate-200"
                      onKeyDown={(e) => e.key === "Enter" && addQuickPhrase()}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={addQuickPhrase}
                      disabled={!newPhraseLabel.trim() || !newPhraseText.trim()}
                      className="rounded-lg border-blue-200 text-blue-600 hover:bg-blue-50 disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      添加
                    </Button>
                  </div>
                </div>
              </div>
            </SettingSection>
          </TabsContent>

          {/* ═══════════════ Notifications Tab ═══════════════ */}
          <TabsContent value="notifications" className="space-y-6">
            <SettingSection
              title="推送通知"
              description="控制新病例和紧急事件的提醒方式"
              icon={Bell}
            >
              <SettingRow
                label="新病例通知"
                description="当有新患者提交问诊时，在页面内弹出通知"
              >
                <div className="flex items-center gap-2">
                  {newCaseNotify ? (
                    <Bell className="h-4 w-4 text-blue-500" />
                  ) : (
                    <BellOff className="h-4 w-4 text-slate-400" />
                  )}
                  <Switch
                    checked={newCaseNotify}
                    onCheckedChange={(v) => {
                      setNewCaseNotify(v);
                      markChanged();
                    }}
                  />
                </div>
              </SettingRow>
              <SettingRow
                label="紧急病例弹窗"
                description="当收到 Critical 优先级的病例时，显示全屏模态弹窗提醒"
              >
                <Switch
                  checked={criticalAlert}
                  onCheckedChange={(v) => {
                    setCriticalAlert(v);
                    markChanged();
                  }}
                />
              </SettingRow>
              <SettingRow
                label="提示音效"
                description="有新通知时播放提示音"
              >
                <div className="flex items-center gap-2">
                  {soundEnabled ? (
                    <Volume2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <VolumeX className="h-4 w-4 text-slate-400" />
                  )}
                  <Switch
                    checked={soundEnabled}
                    onCheckedChange={(v) => {
                      setSoundEnabled(v);
                      markChanged();
                    }}
                  />
                </div>
              </SettingRow>
              <SettingRow
                label="消息推送频率"
                description="选择候诊队列的刷新与推送方式"
              >
                <Select
                  value={digestFreq}
                  onValueChange={(v) => {
                    setDigestFreq(v);
                    markChanged();
                  }}
                >
                  <SelectTrigger className="w-40 h-9 text-sm border-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="realtime">实时推送 (SSE)</SelectItem>
                    <SelectItem value="30s">每 30 秒轮询</SelectItem>
                    <SelectItem value="60s">每 60 秒轮询</SelectItem>
                    <SelectItem value="manual">手动刷新</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>
            </SettingSection>
          </TabsContent>

          {/* ═══════════════ Display Tab ═══════════════ */}
          <TabsContent value="display" className="space-y-6">
            <SettingSection
              title="工作台显示"
              description="自定义诊断工作台的默认视图与布局"
              icon={Palette}
            >
              <SettingRow
                label="紧凑视图"
                description="减少间距和字号，在屏幕上显示更多信息"
              >
                <Switch
                  checked={compactView}
                  onCheckedChange={(v) => {
                    setCompactView(v);
                    markChanged();
                  }}
                />
              </SettingRow>
              <SettingRow
                label="显示 AI 置信度"
                description="在病灶标注和化验结果卡片上显示 AI 置信度数值"
              >
                <Switch
                  checked={showConfidence}
                  onCheckedChange={(v) => {
                    setShowConfidence(v);
                    markChanged();
                  }}
                />
              </SettingRow>
              <SettingRow
                label="高亮异常指标"
                description="自动用红色高亮超出正常参考范围的检验值"
              >
                <Switch
                  checked={highlightAbnormal}
                  onCheckedChange={(v) => {
                    setHighlightAbnormal(v);
                    markChanged();
                  }}
                />
              </SettingRow>
              <SettingRow
                label="工作台默认 Tab"
                description="进入诊断工作台后自动展示的初始证据类型"
              >
                <Select
                  value={defaultTab}
                  onValueChange={(v) => {
                    setDefaultTab(v);
                    markChanged();
                  }}
                >
                  <SelectTrigger className="w-40 h-9 text-sm border-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vitals">基础体征</SelectItem>
                    <SelectItem value="imaging">医学影像</SelectItem>
                    <SelectItem value="lab">化验报告</SelectItem>
                    <SelectItem value="ecg">心电图</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>
            </SettingSection>

            {/* Current model info */}
            {currentModel && (
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-2xl border border-blue-100 p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-xl bg-blue-100 text-blue-600">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">当前活跃模型</h3>
                    <p className="text-xs text-slate-500">下次打开诊断工作台时生效</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 bg-white/60 backdrop-blur-sm rounded-xl p-4 border border-white/80">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-slate-800">{currentModel.name}</span>
                      <span className="text-xs text-slate-400">{currentModel.provider}</span>
                      {currentModel.tag && (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-[10px]">
                          {currentModel.tag}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{currentModel.description}</p>
                  </div>
                  <div className="text-right text-xs text-slate-500 space-y-1">
                    <div>Temperature: <span className="font-bold text-blue-700">{temperature.toFixed(2)}</span></div>
                    <div>复核阈值: <span className="font-bold text-amber-700">&lt;{confidenceThreshold}%</span></div>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
