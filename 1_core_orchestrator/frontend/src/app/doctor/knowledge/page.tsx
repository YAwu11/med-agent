"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { getBackendBaseURL } from "@/core/config";
import {
  BookOpen,
  Search,
  Plus,
  Upload,
  Trash2,
  FileText,
  FolderOpen,
  FolderPlus,
  Database,
  Layers,
  Eye,
  MoreHorizontal,
  ChevronRight,
  ChevronDown,
  X,
  Check,
  RefreshCw,
  Sparkles,
  AlertCircle,
  Inbox,
  Zap,
  Clock,
  ArrowRight,
  Send,
  Loader2,
  Copy,
  ExternalLink,
  Hash,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────
interface KnowledgeBase {
  kb_id: string;
  display_name: string;
  folder: string;
  doc_count: number;
  chunk_count?: number;
  created_at?: string;
  description?: string;
  tags?: string[];
}

interface Document {
  doc_name: string;
  chunk_count: number;
  doc_type?: string;
  uploaded_at?: string;
}

interface RetrievalChunk {
  chunk_id: string;
  content: string;
  doc_name: string;
  similarity: number;
  doc_type?: string;
  highlight?: string;
}

interface DocChunk {
  chunk_id: string;
  content_preview: string;
  content_full: string;
  docnm_kwd: string;
  doc_type_kwd: string;
  char_count: number;
}

interface FolderNode {
  path: string;
  name: string;
  children: FolderNode[];
  kbs: KnowledgeBase[];
}

// ── Search mode labels ─────────────────────────────────────
const SEARCH_MODES = [
  { key: "fast" as const, label: "快速", desc: "ES+Reranker ~200ms", color: "bg-green-50 text-green-700 border-green-200" },
  { key: "hybrid" as const, label: "图谱推理", desc: "含 GraphRAG ~500ms", color: "bg-blue-50 text-blue-700 border-blue-200" },
  { key: "deep" as const, label: "深度纠错", desc: "含 CRAG ~1-3s", color: "bg-purple-50 text-purple-700 border-purple-200" },
] as const;
type SearchMode = typeof SEARCH_MODES[number]["key"];

// ── Helpers ────────────────────────────────────────────────
function formatNumber(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

// ── Components ─────────────────────────────────────────────

/** Folder tree sidebar item */
function FolderItem({
  folder,
  isActive,
  onClick,
  kbCount,
}: {
  folder: string;
  isActive: boolean;
  onClick: () => void;
  kbCount: number;
}) {
  const name = folder === "/" ? "全部知识库" : folder.split("/").pop() || folder;
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all cursor-pointer",
        isActive
          ? "bg-blue-50 text-blue-700 font-semibold"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
      )}
    >
      {folder === "/" ? (
        <Database className="h-4 w-4 shrink-0" />
      ) : (
        <FolderOpen className="h-4 w-4 shrink-0" />
      )}
      <span className="flex-1 text-left truncate">{name}</span>
      <span className={cn(
        "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
        isActive ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
      )}>
        {kbCount}
      </span>
    </button>
  );
}

/** Knowledge base card */
function KBCard({
  kb,
  isSelected,
  onSelect,
}: {
  kb: KnowledgeBase;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left p-5 rounded-xl border-2 transition-all duration-200 cursor-pointer group",
        isSelected
          ? "border-blue-500 bg-blue-50/50 shadow-sm ring-1 ring-blue-200"
          : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={cn(
            "p-1.5 rounded-lg",
            isSelected ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500"
          )}>
            <BookOpen className="h-4 w-4" />
          </div>
          <h4 className="text-sm font-bold text-slate-800">{kb.display_name}</h4>
        </div>
        <MoreHorizontal className="h-4 w-4 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {kb.description && (
        <p className="text-xs text-slate-500 mb-3 line-clamp-2 leading-relaxed">{kb.description}</p>
      )}

      <div className="flex items-center gap-3 text-[11px] text-slate-500 mb-2">
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3" /> {kb.doc_count} 文档
        </span>
        <span className="flex items-center gap-1">
          <Layers className="h-3 w-3" /> {formatNumber(kb.chunk_count || 0)} 分块
        </span>
        {kb.created_at && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {kb.created_at}
          </span>
        )}
      </div>

      {kb.tags && kb.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {kb.tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

/** Retrieval result chunk card */
function ChunkCard({ chunk, rank }: { chunk: RetrievalChunk; rank: number }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(chunk.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const similarityPct = Math.round(chunk.similarity * 100);
  const simColor =
    similarityPct >= 80 ? "text-green-700 bg-green-50 border-green-200" :
    similarityPct >= 60 ? "text-blue-700 bg-blue-50 border-blue-200" :
    "text-amber-700 bg-amber-50 border-amber-200";

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-sm transition-all group">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">
            {rank}
          </span>
          <span className="text-xs font-semibold text-slate-700 truncate max-w-[200px]">
            {chunk.doc_name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", simColor)}>
            {similarityPct}%
          </Badge>
          <button
            onClick={handleCopy}
            className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-all"
            title="复制内容"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed line-clamp-4">{chunk.content}</p>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────
export default function DoctorKnowledgePage() {
  const BASE = getBackendBaseURL();

  // Core data
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [isLoadingKBs, setIsLoadingKBs] = useState(true);
  const [activeFolder, setActiveFolder] = useState("/");
  const [selectedKB, setSelectedKB] = useState<KnowledgeBase | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [docs, setDocs] = useState<Document[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [activeTab, setActiveTab] = useState<"docs" | "search" | "create">("docs");

  // Retrieval test
  const [retrievalQuery, setRetrievalQuery] = useState("");
  const [retrievalResults, setRetrievalResults] = useState<RetrievalChunk[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTime, setSearchTime] = useState<number | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>("hybrid");
  const [selectedRetrievalKBs, setSelectedRetrievalKBs] = useState<string[]>([]); // empty = all
  const [searchAllKBs, setSearchAllKBs] = useState(true);
  const [cragInfo, setCragInfo] = useState<{ score: string; reason: string } | null>(null);

  // Create KB
  const [newKBName, setNewKBName] = useState("");
  const [newKBDesc, setNewKBDesc] = useState("");
  const [newKBFolder, setNewKBFolder] = useState("/");

  // Upload
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // RAGFlow health
  const [ragflowOnline, setRagflowOnline] = useState<boolean | null>(null);
  const [ragflowFeatures, setRagflowFeatures] = useState<{ graph: boolean; crag: boolean; reranker: boolean } | null>(null);

  // Chunk preview
  const [previewDoc, setPreviewDoc] = useState<string | null>(null); // doc_name being previewed
  const [previewChunks, setPreviewChunks] = useState<DocChunk[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewTotalPages, setPreviewTotalPages] = useState(1);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null);

  // ── Load knowledge bases from RAGFlow Lite ──
  const loadKBs = useCallback(async () => {
    setIsLoadingKBs(true);
    try {
      const res = await fetch(`${BASE}/api/knowledge/knowledgebase`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const kbs: KnowledgeBase[] = (data?.data?.knowledgebases || []).map((kb: any) => ({
        kb_id: kb.kb_id,
        display_name: kb.display_name || kb.kb_id,
        folder: kb.folder || "/",
        doc_count: kb.doc_count || 0,
        chunk_count: kb.chunk_count,
        description: kb.description,
        tags: kb.tags,
        created_at: kb.created_at,
      }));
      setKnowledgeBases(kbs);
      if (kbs.length > 0 && !selectedKB) {
        setSelectedKB(kbs[0]!);
      }
    } catch (e) {
      console.error("Failed to load KBs:", e);
      toast.error("无法加载知识库列表，请确认 RAGFlow Lite 是否启动");
    } finally {
      setIsLoadingKBs(false);
    }
  }, [BASE, selectedKB]);

  useEffect(() => { loadKBs(); }, []);

  // ── Load documents when KB selected ──
  useEffect(() => {
    if (!selectedKB) { setDocs([]); return; }
    setIsLoadingDocs(true);
    fetch(`${BASE}/api/knowledge/documents/${selectedKB.kb_id}`)
      .then(r => r.json())
      .then(d => {
        setDocs((d?.data?.documents || []).map((doc: any) => ({
          doc_name: doc.doc_name,
          chunk_count: doc.chunk_count || 0,
          doc_type: doc.doc_name?.split(".").pop(),
          uploaded_at: doc.uploaded_at,
        })));
      })
      .catch(e => { console.error("Failed to load docs:", e); setDocs([]); })
      .finally(() => setIsLoadingDocs(false));
  }, [BASE, selectedKB]);

  // ── RAGFlow health check ──
  useEffect(() => {
    fetch(`${BASE}/api/knowledge/health`)
      .then(r => r.json())
      .then(d => {
        setRagflowOnline(true);
        setRagflowFeatures({
          graph: d?.data?.graph_enabled || false,
          crag: d?.data?.crag_enabled || false,
          reranker: d?.data?.reranker_enabled || false,
        });
      })
      .catch(() => setRagflowOnline(false));
  }, [BASE]);

  // ── Load chunks for a doc preview ──
  const loadChunks = useCallback(async (docName: string, page: number = 1) => {
    if (!selectedKB) return;
    setPreviewLoading(true);
    setPreviewDoc(docName);
    setPreviewPage(page);
    setExpandedChunk(null);
    try {
      const res = await fetch(
        `${BASE}/api/knowledge/chunks/${selectedKB.kb_id}?doc_names=${encodeURIComponent(docName)}&page=${page}&page_size=20`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPreviewChunks(data?.data?.chunks || []);
      setPreviewTotalPages(data?.data?.total_pages || 1);
      setPreviewTotal(data?.data?.total || 0);
    } catch (e) {
      console.error("Load chunks failed:", e);
      toast.error("加载分块失败");
      setPreviewChunks([]);
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedKB, BASE]);

  // Folder tree from KB data
  const uniqueFolders = Array.from(
    new Set(["/", ...knowledgeBases.map((kb) => kb.folder)])
  ).sort();

  // Filter KBs
  const filteredKBs = knowledgeBases.filter((kb) => {
    const matchFolder = activeFolder === "/" || kb.folder === activeFolder;
    const matchSearch =
      !searchQuery ||
      kb.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      kb.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      kb.tags?.some((t) => t.includes(searchQuery));
    return matchFolder && matchSearch;
  });

  const kbCountByFolder = (folder: string) =>
    folder === "/"
      ? knowledgeBases.length
      : knowledgeBases.filter((kb) => kb.folder === folder).length;

  // ── Real retrieval via RAGFlow Lite API ──
  const handleRetrieval = useCallback(async () => {
    if (!retrievalQuery.trim()) return;
    setIsSearching(true);
    setRetrievalResults([]);
    setCragInfo(null);

    try {
      const kbIds = searchAllKBs ? [] : selectedRetrievalKBs;
      const res = await fetch(`${BASE}/api/knowledge/tool/retrieve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: retrievalQuery.trim(),
          kb_ids: kbIds,
          mode: searchMode,
          top_k: 5,
          enable_web_search: false,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Map sources to chunks for display
      const sources = data.sources || [];
      const results: RetrievalChunk[] = sources
        .filter((s: any) => s.source_type !== "graph")
        .map((s: any, i: number) => ({
          chunk_id: s.id || `chunk_${i}`,
          content: s.content || "",
          doc_name: s.doc_name || "",
          similarity: s.relevance_score || 0,
        }));

      setRetrievalResults(results);
      setSearchTime(data.metadata?.latency_ms || null);
      if (data.metadata?.crag_score) {
        setCragInfo({ score: data.metadata.crag_score, reason: data.metadata.crag_reason || "" });
      }
    } catch (e) {
      console.error("Retrieval failed:", e);
      toast.error("检索失败，请确认 RAGFlow Lite 是否启动");
    } finally {
      setIsSearching(false);
    }
  }, [retrievalQuery, searchMode, searchAllKBs, selectedRetrievalKBs, BASE]);

  // ── Create knowledge base ──
  const [isCreatingKB, setIsCreatingKB] = useState(false);
  const handleCreateKB = useCallback(async () => {
    if (!newKBName.trim()) {
      toast.error("请输入知识库名称");
      return;
    }
    setIsCreatingKB(true);
    try {
      const res = await fetch(`${BASE}/api/knowledge/knowledgebase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kb_id: newKBName.trim(),
          description: newKBDesc.trim(),
          folder: newKBFolder || "/",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.message === "exists") {
        toast.info(`知识库 "${newKBName}" 已存在`);
      } else {
        toast.success(`知识库 "${newKBName}" 创建成功`);
      }
      setNewKBName("");
      setNewKBDesc("");
      setNewKBFolder("/");
      loadKBs();
    } catch (e) {
      console.error("Create KB failed:", e);
      toast.error("创建知识库失败");
    } finally {
      setIsCreatingKB(false);
    }
  }, [newKBName, newKBDesc, newKBFolder, BASE, loadKBs]);

  // ── Delete knowledge base ──
  const [isDeletingKB, setIsDeletingKB] = useState(false);
  const handleDeleteKB = useCallback(async (kbId: string, displayName: string) => {
    if (!confirm(`确定要删除知识库 "${displayName}" 吗？此操作不可恢复。`)) return;
    setIsDeletingKB(true);
    try {
      const res = await fetch(`${BASE}/api/knowledge/knowledgebase/batch_delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kb_ids: [kbId] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`知识库 "${displayName}" 已删除`);
      if (selectedKB?.kb_id === kbId) setSelectedKB(null);
      loadKBs();
    } catch (e) {
      console.error("Delete KB failed:", e);
      toast.error("删除知识库失败");
    } finally {
      setIsDeletingKB(false);
    }
  }, [BASE, loadKBs, selectedKB]);

  // ── Upload document ──
  const handleUpload = useCallback(async () => {
    if (!selectedKB) {
      toast.error("请先选择一个知识库");
      return;
    }
    fileInputRef.current?.click();
  }, [selectedKB]);

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedKB) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kb_id", selectedKB.kb_id);
      const res = await fetch(`${BASE}/api/knowledge/document/upload`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      toast.success(`文档 "${file.name}" 上传成功，解析了 ${data?.data?.chunks_indexed || 0} 个分块`);
      // Refresh docs and KB list
      loadKBs();
      if (selectedKB) {
        const docsRes = await fetch(`${BASE}/api/knowledge/documents/${selectedKB.kb_id}`);
        if (docsRes.ok) {
          const docsData = await docsRes.json();
          setDocs(docsData?.data?.documents || []);
        }
      }
    } catch (e) {
      console.error("Upload failed:", e);
      toast.error(`文档上传失败: ${(e as Error).message}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [selectedKB, BASE, loadKBs]);

  // ── Sync: refresh docs + KB info ──
  const [isSyncing, setIsSyncing] = useState(false);
  const handleSyncKB = useCallback(async () => {
    if (!selectedKB) return;
    setIsSyncing(true);
    try {
      await loadKBs();
      const docsRes = await fetch(`${BASE}/api/knowledge/documents/${selectedKB.kb_id}`);
      if (docsRes.ok) {
        const d = await docsRes.json();
        setDocs((d?.data?.documents || []).map((doc: any) => ({
          doc_name: doc.doc_name,
          chunk_count: doc.chunk_count || 0,
          doc_type: doc.doc_name?.split(".").pop(),
          uploaded_at: doc.uploaded_at,
        })));
      }
      toast.success("同步完成");
    } catch (e) {
      toast.error("同步失败");
    } finally {
      setIsSyncing(false);
    }
  }, [selectedKB, BASE, loadKBs]);

  // ── Delete document ──
  const handleDeleteDoc = useCallback(async (docName: string) => {
    if (!selectedKB) return;
    if (!confirm(`确定要删除文档 "${docName}" 及其所有分块吗？`)) return;
    try {
      const res = await fetch(
        `${BASE}/api/knowledge/document/${selectedKB.kb_id}/${encodeURIComponent(docName)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      toast.success(`文档 "${docName}" 已删除 (${data?.data?.deleted_chunks || 0} 个分块)`);
      setDocs(prev => prev.filter(d => d.doc_name !== docName));
      loadKBs();
    } catch (e) {
      console.error("Delete doc failed:", e);
      toast.error("删除文档失败");
    }
  }, [selectedKB, BASE, loadKBs]);

  // ── Create folder ──
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) return;
    const path = activeFolder === "/" ? `/${newFolderName.trim()}` : `${activeFolder}/${newFolderName.trim()}`;
    try {
      const res = await fetch(`${BASE}/api/knowledge/knowledgebase/folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`文件夹 "${newFolderName}" 创建成功`);
      setNewFolderName("");
      setIsCreatingFolder(false);
      loadKBs();
    } catch (e) {
      console.error("Create folder failed:", e);
      toast.error("创建文件夹失败");
    }
  }, [newFolderName, activeFolder, BASE, loadKBs]);

  const totalChunks = knowledgeBases.reduce((sum, kb) => sum + (kb.chunk_count || 0), 0);
  const totalDocs = knowledgeBases.reduce((sum, kb) => sum + kb.doc_count, 0);

  // Toggle a KB in the retrieval multi-select
  const toggleRetrievalKB = (kbId: string) => {
    setSelectedRetrievalKBs(prev =>
      prev.includes(kbId) ? prev.filter(id => id !== kbId) : [...prev, kbId]
    );
  };

  return (
    <>
    <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-slate-50">
      {/* ═══ Left Sidebar: Folder Tree + Stats ═══ */}
      <div className="w-[260px] shrink-0 border-r border-slate-200 bg-white flex flex-col">
        {/* Header */}
        <div className="px-4 pt-5 pb-3 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800 mb-3">知识库管理</h2>

          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label: "知识库", value: knowledgeBases.length, color: "text-blue-700" },
              { label: "文档", value: totalDocs, color: "text-green-700" },
              { label: "分块", value: formatNumber(totalChunks), color: "text-purple-700" },
            ].map((s) => (
              <div key={s.label} className="text-center p-2 bg-slate-50 rounded-lg">
                <div className={cn("text-lg font-extrabold tabular-nums", s.color)}>{s.value}</div>
                <div className="text-[10px] text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Folder Tree */}
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-2">
              文件夹
            </div>
            {uniqueFolders.map((folder) => (
              <FolderItem
                key={folder}
                folder={folder}
                isActive={activeFolder === folder}
                onClick={() => setActiveFolder(folder)}
                kbCount={kbCountByFolder(folder)}
              />
            ))}

            {/* Add folder button / input */}
            {isCreatingFolder ? (
              <div className="flex items-center gap-1 mt-2 px-1">
                <Input
                  placeholder="文件夹名称"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="h-7 text-xs rounded-md flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateFolder();
                    if (e.key === "Escape") { setIsCreatingFolder(false); setNewFolderName(""); }
                  }}
                />
                <button
                  onClick={handleCreateFolder}
                  className="p-1 rounded-md hover:bg-green-50 text-green-600"
                  title="确认"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => { setIsCreatingFolder(false); setNewFolderName(""); }}
                  className="p-1 rounded-md hover:bg-slate-100 text-slate-400"
                  title="取消"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsCreatingFolder(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all cursor-pointer mt-2"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                新建文件夹
              </button>
            )}
          </div>
        </ScrollArea>

        {/* RAGFlow Lite Status */}
        <div className="p-3 border-t border-slate-100">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg">
            <div className={cn(
              "w-2 h-2 rounded-full",
              ragflowOnline === null ? "bg-slate-300 animate-pulse" :
              ragflowOnline ? "bg-green-500" : "bg-red-400"
            )} />
            <span className="text-[11px] text-slate-500">RAGFlow Lite</span>
            <Badge variant="outline" className={cn(
              "ml-auto text-[9px]",
              ragflowOnline === null ? "bg-slate-50 text-slate-500 border-slate-200" :
              ragflowOnline ? "bg-green-50 text-green-700 border-green-200" :
              "bg-red-50 text-red-600 border-red-200"
            )}>
              {ragflowOnline === null ? "检测中..." : ragflowOnline ? "Online" : "Offline"}
            </Badge>
          </div>
          {ragflowOnline && ragflowFeatures && (
            <div className="flex gap-1.5 mt-1.5 px-3">
              {ragflowFeatures.reranker && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-50 text-green-600">Reranker</span>}
              {ragflowFeatures.graph && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">GraphRAG</span>}
              {ragflowFeatures.crag && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">CRAG</span>}
            </div>
          )}
        </div>
      </div>

      {/* ═══ Middle: KB List ═══ */}
      <div className="w-[340px] xl:w-[380px] shrink-0 border-r border-slate-200 bg-slate-50 flex flex-col">
        {/* Search */}
        <div className="px-4 pt-4 pb-3 bg-white border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="搜索知识库..."
              className="pl-9 h-9 text-sm bg-slate-50 border-slate-200"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* KB Cards */}
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {filteredKBs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Inbox className="h-10 w-10 mb-3 opacity-40" />
                <p className="text-sm font-medium">暂无知识库</p>
                <p className="text-xs mt-1">点击右下角新建一个</p>
              </div>
            ) : (
              filteredKBs.map((kb) => (
                <KBCard
                  key={kb.kb_id}
                  kb={kb}
                  isSelected={selectedKB?.kb_id === kb.kb_id}
                  onSelect={() => {
                    setSelectedKB(kb);
                    setActiveTab("docs");
                  }}
                />
              ))
            )}
          </div>
        </ScrollArea>

        {/* Create KB Form */}
        <div className="p-3 border-t border-slate-200 bg-white space-y-2">
          <Input
            placeholder="知识库名称"
            value={newKBName}
            onChange={(e) => setNewKBName(e.target.value)}
            className="h-8 text-sm rounded-lg"
            onKeyDown={(e) => e.key === "Enter" && handleCreateKB()}
          />
          <Button
            onClick={handleCreateKB}
            disabled={isCreatingKB || !newKBName.trim()}
            className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm h-10"
          >
            {isCreatingKB ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            新建知识库
          </Button>
        </div>
      </div>

      {/* ═══ Right: Detail Panel ═══ */}
      <div className="flex-1 min-w-0 flex flex-col bg-white">
        {selectedKB ? (
          <>
            {/* Detail Header */}
            <div className="px-6 py-5 border-b border-slate-200 bg-gradient-to-r from-white to-slate-50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-blue-100 text-blue-600">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">{selectedKB.display_name}</h2>
                    <p className="text-xs text-slate-500">
                      {selectedKB.folder === "/" ? "根目录" : selectedKB.folder} ·{" "}
                      <span className="font-mono">{selectedKB.kb_id}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg border-slate-200 text-slate-600 cursor-pointer"
                    disabled={isSyncing}
                    onClick={handleSyncKB}
                  >
                    {isSyncing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                    同步
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg border-red-200 text-red-600 hover:bg-red-50 cursor-pointer"
                    disabled={isDeletingKB}
                    onClick={() => handleDeleteKB(selectedKB.kb_id, selectedKB.display_name)}
                  >
                    {isDeletingKB ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
                    删除
                  </Button>
                </div>
              </div>

              {/* KB Stats Bar */}
              <div className="flex items-center gap-6 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" /> {selectedKB.doc_count} 文档
                </span>
                <span className="flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5" /> {formatNumber(selectedKB.chunk_count || 0)} 分块
                </span>
                {selectedKB.created_at && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> 创建于 {selectedKB.created_at}
                  </span>
                )}
                {selectedKB.tags && selectedKB.tags.length > 0 && (
                  <div className="flex items-center gap-1">
                    <Hash className="h-3.5 w-3.5" />
                    {selectedKB.tags.map((t) => (
                      <Badge key={t} variant="outline" className="text-[9px] px-1 py-0 bg-slate-50 text-slate-500 border-slate-200">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Tabs */}
              <div className="flex gap-1 mt-4">
                {[
                  { key: "docs" as const, label: "文档列表", icon: FileText },
                  { key: "search" as const, label: "检索测试", icon: Sparkles },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer",
                      activeTab === tab.key
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    )}
                  >
                    <tab.icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto">
              {/* ──── Documents Tab ──── */}
              {activeTab === "docs" && (
                <div className="p-6">
                  {/* Upload area */}
                  <div className="mb-6">
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-blue-300 hover:bg-blue-50/30 transition-all cursor-pointer group"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        accept=".pdf,.docx,.doc,.txt,.md,.csv"
                        onChange={handleFileSelected}
                      />
                      {isUploading ? (
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
                          <span className="text-sm text-blue-600 font-medium">正在上传并解析...</span>
                        </div>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 text-slate-400 group-hover:text-blue-500 mx-auto mb-2 transition-colors" />
                          <p className="text-sm text-slate-600 font-medium">
                            点击上传文档
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            支持 PDF / DOCX / TXT / MD / CSV
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Document list */}
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                    文档列表 ({docs.length})
                  </h3>
                  <div className="space-y-2">
                    {docs.map((doc, idx) => (
                      <div
                        key={doc.doc_name}
                        className="flex items-center gap-4 p-4 rounded-xl border border-slate-200 bg-white hover:shadow-sm transition-all group"
                      >
                        <div className="p-2 rounded-lg bg-slate-100 text-slate-500 shrink-0">
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{doc.doc_name}</p>
                          <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-0.5">
                            <span>{doc.chunk_count} 分块</span>
                            {doc.doc_type && <span className="uppercase">{doc.doc_type}</span>}
                            {doc.uploaded_at && <span>{doc.uploaded_at}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            className="p-1.5 rounded-md hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"
                            title="预览分块"
                            onClick={() => loadChunks(doc.doc_name)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="p-1.5 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                            title="删除文档"
                            onClick={() => handleDeleteDoc(doc.doc_name)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ──── Search / Retrieval Test Tab ──── */}
              {activeTab === "search" && (
                <div className="p-6">
                  {/* Search input */}
                  <div className="mb-6">
                    <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-purple-500" />
                      语义检索测试
                    </h3>
                    <p className="text-xs text-slate-500 mb-3">
                      输入自然语言问题，测试知识库的检索效果（基于 RAGFlow Lite 混合检索 + Reranker 精排）
                    </p>

                    {/* Search mode selector */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-semibold text-slate-600">检索模式:</span>
                      <div className="flex gap-1.5">
                        {SEARCH_MODES.map((m) => (
                          <button
                            key={m.key}
                            onClick={() => setSearchMode(m.key)}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all cursor-pointer",
                              searchMode === m.key
                                ? m.color + " ring-1 ring-current/20 shadow-sm"
                                : "bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100"
                            )}
                            title={m.desc}
                          >
                            {m.label}
                            <span className="ml-1 font-normal opacity-70">{m.desc.split(" ")[0]}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Multi-KB selector */}
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span className="text-xs font-semibold text-slate-600">搜索范围:</span>
                      <button
                        onClick={() => { setSearchAllKBs(true); setSelectedRetrievalKBs([]); }}
                        className={cn(
                          "px-2.5 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer",
                          searchAllKBs
                            ? "bg-blue-600 text-white shadow-sm"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        )}
                      >
                        全部知识库
                      </button>
                      {knowledgeBases.map((kb) => (
                        <button
                          key={kb.kb_id}
                          onClick={() => {
                            setSearchAllKBs(false);
                            toggleRetrievalKB(kb.kb_id);
                          }}
                          className={cn(
                            "px-2.5 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer",
                            !searchAllKBs && selectedRetrievalKBs.includes(kb.kb_id)
                              ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300"
                              : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                          )}
                        >
                          {kb.display_name}
                        </button>
                      ))}
                    </div>

                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                          placeholder="输入检索问题，如：社区获得性肺炎的诊断标准是什么？"
                          className="pl-9 h-11 text-sm border-slate-200"
                          value={retrievalQuery}
                          onChange={(e) => setRetrievalQuery(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleRetrieval()}
                        />
                      </div>
                      <Button
                        onClick={handleRetrieval}
                        disabled={isSearching || !retrievalQuery.trim()}
                        className="h-11 px-6 rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-sm disabled:opacity-40"
                      >
                        {isSearching ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Send className="h-4 w-4 mr-1.5" />
                            检索
                          </>
                        )}
                      </Button>
                    </div>

                    {/* Quick test queries */}
                    <div className="flex flex-wrap gap-2 mt-3">
                      {[
                        "肺炎的诊断标准",
                        "心肌梗死急诊处理",
                        "抗菌药物使用原则",
                        "CURB-65评分",
                      ].map((q) => (
                        <button
                          key={q}
                          onClick={() => {
                            setRetrievalQuery(q);
                          }}
                          className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors cursor-pointer"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Results */}
                  {isSearching && (
                    <div className="flex flex-col items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 text-purple-500 animate-spin mb-3" />
                      <p className="text-sm text-slate-500 font-medium">正在检索知识库...</p>
                      <p className="text-xs text-slate-400 mt-1">混合召回 + Reranker 精排</p>
                    </div>
                  )}

                  {!isSearching && retrievalResults.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                          检索结果 ({retrievalResults.length})
                        </h4>
                        <div className="flex items-center gap-2">
                          {cragInfo && (
                            <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 text-[10px]">
                              CRAG: {cragInfo.score}
                            </Badge>
                          )}
                          {searchTime && (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-[10px]">
                              <Zap className="h-3 w-3 mr-1" />
                              {searchTime}ms
                            </Badge>
                          )}
                        </div>
                      </div>
                      {cragInfo?.reason && (
                        <p className="text-xs text-purple-600 bg-purple-50 rounded-lg px-3 py-2 mb-3">
                          <span className="font-bold">CRAG 评估:</span> {cragInfo.reason}
                        </p>
                      )}
                      <div className="space-y-3">
                        {retrievalResults.map((chunk, idx) => (
                          <ChunkCard key={chunk.chunk_id} chunk={chunk} rank={idx + 1} />
                        ))}
                      </div>
                    </div>
                  )}

                  {!isSearching && retrievalResults.length === 0 && retrievalQuery && (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                      <Search className="h-10 w-10 mb-3 opacity-40" />
                      <p className="text-sm font-medium">点击 "检索" 按钮开始搜索</p>
                    </div>
                  )}

                  {!isSearching && retrievalResults.length === 0 && !retrievalQuery && (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                      <Sparkles className="h-10 w-10 mb-3 opacity-40" />
                      <p className="text-sm font-medium">输入问题测试检索效果</p>
                      <p className="text-xs mt-1">或点击上方推荐问题快速体验</p>
                    </div>
                  )}
                </div>
              )}

              {/* ──── Create KB Tab ──── */}
              {activeTab === "create" && (
                <div className="p-6 max-w-lg">
                  <h3 className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
                    <Plus className="h-4 w-4 text-blue-500" />
                    新建知识库
                  </h3>
                  <p className="text-xs text-slate-500 mb-6">
                    创建一个新的知识库索引，后续可上传文档进行分块和语义索引
                  </p>

                  <div className="space-y-5">
                    <div>
                      <label className="text-sm font-semibold text-slate-700 block mb-1.5">
                        知识库名称 <span className="text-red-500">*</span>
                      </label>
                      <Input
                        placeholder="如：内科诊疗指南合集"
                        className="h-10 text-sm border-slate-200"
                        value={newKBName}
                        onChange={(e) => setNewKBName(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="text-sm font-semibold text-slate-700 block mb-1.5">
                        描述 (可选)
                      </label>
                      <Textarea
                        placeholder="简要描述该知识库的内容范围和用途..."
                        className="text-sm border-slate-200 min-h-[80px]"
                        value={newKBDesc}
                        onChange={(e) => setNewKBDesc(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="text-sm font-semibold text-slate-700 block mb-1.5">
                        归属文件夹
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {uniqueFolders.map((f) => (
                          <button
                            key={f}
                            onClick={() => setNewKBFolder(f)}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer",
                              newKBFolder === f
                                ? "bg-blue-600 text-white shadow-sm"
                                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            )}
                          >
                            {f === "/" ? "根目录" : f}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-100 flex gap-3">
                      <Button
                        onClick={() => setActiveTab("docs")}
                        variant="outline"
                        className="rounded-xl border-slate-200 text-slate-600"
                      >
                        取消
                      </Button>
                      <Button
                        disabled={!newKBName.trim()}
                        className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm px-8 disabled:opacity-40"
                      >
                        <Check className="h-4 w-4 mr-1.5" />
                        创建
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <BookOpen className="h-16 w-16 mb-4 opacity-25" />
            <p className="text-lg font-medium text-slate-500">选择一个知识库</p>
            <p className="text-sm mt-1">查看文档列表或测试检索效果</p>
          </div>
        )}
      </div>
    </div>

      {/* ═══ Chunk Preview Overlay ═══ */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setPreviewDoc(null)}
          />
          {/* Panel */}
          <div className="relative ml-auto w-full max-w-3xl h-full bg-white shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-blue-50 to-white">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-100 text-blue-600">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800">分块预览</h2>
                  <p className="text-xs text-slate-500">
                    {previewDoc} · 共 {previewTotal} 个分块
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPreviewDoc(null)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Chunk list */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="p-6 space-y-3">
                {previewLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
                    <span className="ml-2 text-sm text-slate-500">加载中...</span>
                  </div>
                ) : previewChunks.length === 0 ? (
                  <div className="text-center py-20 text-slate-400">
                    <Inbox className="h-10 w-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">暂无分块数据</p>
                  </div>
                ) : (
                  previewChunks.map((chunk, idx) => {
                    const globalIdx = (previewPage - 1) * 20 + idx + 1;
                    const isExpanded = expandedChunk === chunk.chunk_id;
                    return (
                      <div
                        key={chunk.chunk_id}
                        className="rounded-xl border border-slate-200 bg-white hover:shadow-sm transition-all overflow-hidden"
                      >
                        {/* Chunk header */}
                        <div
                          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                          onClick={() => setExpandedChunk(isExpanded ? null : chunk.chunk_id)}
                        >
                          <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-100 text-blue-700 text-xs font-bold shrink-0">
                            {globalIdx}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={cn(
                              "text-sm text-slate-700 leading-relaxed",
                              isExpanded ? "" : "line-clamp-2"
                            )}>
                              {isExpanded ? chunk.content_full : chunk.content_preview}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-slate-50 text-slate-500 border-slate-200">
                              {chunk.char_count} 字
                            </Badge>
                            <ChevronRight className={cn(
                              "h-4 w-4 text-slate-400 transition-transform",
                              isExpanded && "rotate-90"
                            )} />
                          </div>
                        </div>

                        {/* Expanded content */}
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-1 border-t border-slate-100">
                            <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-mono text-xs">
                              {chunk.content_full}
                            </div>
                            <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-400">
                              <span className="flex items-center gap-1">
                                <Hash className="h-3 w-3" />
                                ID: {chunk.chunk_id.slice(0, 12)}...
                              </span>
                              <span>{chunk.char_count} 字符</span>
                              <span className="uppercase">{chunk.doc_type_kwd}</span>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(chunk.content_full);
                                  toast.success("已复制分块内容");
                                }}
                                className="ml-auto flex items-center gap-1 text-blue-500 hover:text-blue-700 transition-colors"
                              >
                                <Copy className="h-3 w-3" />
                                复制
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Pagination footer */}
            {previewTotalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-slate-50">
                <span className="text-xs text-slate-500">
                  第 {previewPage} / {previewTotalPages} 页 · 共 {previewTotal} 个分块
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={previewPage <= 1 || previewLoading}
                    onClick={() => loadChunks(previewDoc!, previewPage - 1)}
                    className="rounded-lg h-8 text-xs"
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={previewPage >= previewTotalPages || previewLoading}
                    onClick={() => loadChunks(previewDoc!, previewPage + 1)}
                    className="rounded-lg h-8 text-xs"
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
