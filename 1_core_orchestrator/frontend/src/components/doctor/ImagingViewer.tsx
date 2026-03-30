"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  ZoomIn,
  ZoomOut,
  Move,
  Pen,
  Eraser,
  RotateCcw,
  Eye,
  EyeOff,
  Plus,
  Sun,
  Contrast,
  Pencil,
  Trash2,
  Bot,
  UserCheck,
  Save,
  Download,
  Check,
  X,
  Undo2,
  Redo2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// ── MCP-compatible Finding JSON Schema ─────────────────────
// This matches the JSON structure returned by the MCP analyze_xray tool.
// The viewer loads, displays, allows editing, and re-exports this format.

export interface FindingBBox {
  /** Percentage coordinates relative to image dimensions (0-100) */
  x: number;      // left %
  y: number;      // top %
  width: number;   // width %
  height: number;  // height %
}

export interface Finding {
  id: string;
  name: string;
  confidence: number;  // 0-100, current (possibly doctor-adjusted)
  originalConfidence?: number;  // AI's original confidence, set when doctor adjusts
  note: string;
  bbox: FindingBBox;
  source: "ai" | "human";       // Origin: AI-generated or doctor-created
  modified: boolean;             // true if doctor has touched this finding
  color: string;                 // visual color stem
}

export interface McpAnalysisResult {
  image_path: string;
  findings: Finding[];
  model_version?: string;
  analyzed_at?: string;
}

// ── Color System ───────────────────────────────────────────

const AI_COLORS = ["red", "teal", "amber", "purple"];
const HUMAN_COLORS = ["blue", "indigo", "cyan", "emerald"];

const colorMap: Record<string, {
  border: string; bg: string; label: string; dot: string;
  barBg: string; barFill: string; text: string; cardBorder: string; cardBg: string;
}> = {
  red:     { border: "border-red-500",    bg: "bg-red-500/20",    label: "bg-red-600",    dot: "bg-red-500",    barBg: "bg-red-100",    barFill: "bg-red-500",    text: "text-red-800",    cardBorder: "border-red-200",    cardBg: "bg-red-50/50" },
  teal:    { border: "border-teal-400",   bg: "bg-teal-400/20",   label: "bg-teal-600",   dot: "bg-teal-500",   barBg: "bg-teal-100",   barFill: "bg-teal-500",   text: "text-teal-800",   cardBorder: "border-teal-200",   cardBg: "bg-teal-50/50" },
  amber:   { border: "border-amber-500",  bg: "bg-amber-500/20",  label: "bg-amber-600",  dot: "bg-amber-500",  barBg: "bg-amber-100",  barFill: "bg-amber-500",  text: "text-amber-800",  cardBorder: "border-amber-200",  cardBg: "bg-amber-50/50" },
  purple:  { border: "border-purple-500", bg: "bg-purple-500/20", label: "bg-purple-600", dot: "bg-purple-500", barBg: "bg-purple-100", barFill: "bg-purple-500", text: "text-purple-800", cardBorder: "border-purple-200", cardBg: "bg-purple-50/50" },
  blue:    { border: "border-blue-500",   bg: "bg-blue-500/20",   label: "bg-blue-600",   dot: "bg-blue-500",   barBg: "bg-blue-100",   barFill: "bg-blue-500",   text: "text-blue-800",   cardBorder: "border-blue-200",   cardBg: "bg-blue-50/50" },
  indigo:  { border: "border-indigo-500", bg: "bg-indigo-500/20", label: "bg-indigo-600", dot: "bg-indigo-500", barBg: "bg-indigo-100", barFill: "bg-indigo-500", text: "text-indigo-800", cardBorder: "border-indigo-200", cardBg: "bg-indigo-50/50" },
  cyan:    { border: "border-cyan-500",   bg: "bg-cyan-500/20",   label: "bg-cyan-600",   dot: "bg-cyan-500",   barBg: "bg-cyan-100",   barFill: "bg-cyan-500",   text: "text-cyan-800",   cardBorder: "border-cyan-200",   cardBg: "bg-cyan-50/50" },
  emerald: { border: "border-emerald-500",bg: "bg-emerald-500/20",label: "bg-emerald-600",dot: "bg-emerald-500",barBg: "bg-emerald-100",barFill: "bg-emerald-500",text: "text-emerald-800",cardBorder: "border-emerald-200",cardBg: "bg-emerald-50/50" },
};


// ── Helper: pick next unused color ─────────────────────────
function pickColor(existing: Finding[], source: "ai" | "human"): string {
  const pool = source === "ai" ? AI_COLORS : HUMAN_COLORS;
  const used = new Set(existing.map(f => f.color));
  return pool.find(c => !used.has(c)) || pool[existing.length % pool.length]!;
}

// ── Source Badge Component ─────────────────────────────────
function SourceBadge({ source, modified, small = false }: { source: "ai" | "human"; modified: boolean; small?: boolean }) {
  if (source === "ai" && !modified) {
    return (
      <span className={cn(
        "inline-flex items-center gap-0.5 font-bold rounded-full border",
        small ? "text-[9px] px-1.5 py-0" : "text-[10px] px-2 py-0.5",
        "bg-violet-50 text-violet-700 border-violet-200"
      )}>
        <Bot className={cn(small ? "h-2.5 w-2.5" : "h-3 w-3")} />
        AI
      </span>
    );
  }
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 font-bold rounded-full border",
      small ? "text-[9px] px-1.5 py-0" : "text-[10px] px-2 py-0.5",
      "bg-sky-50 text-sky-700 border-sky-200"
    )}>
      <UserCheck className={cn(small ? "h-2.5 w-2.5" : "h-3 w-3")} />
      {source === "ai" ? "已修正" : "医生"}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────

type ToolMode = "zoom" | "pan" | "draw" | "erase" | "sketch";

/** A freehand sketch stroke (percentage coords, same as bbox) */
interface SketchStroke {
  id: string;
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

export function ImagingViewer({ threadId, mcpResult }: { threadId?: string, mcpResult?: McpAnalysisResult }) {
  const [data, setData] = useState<McpAnalysisResult | null>(mcpResult || null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!mcpResult && !!threadId);

  // State
  const [findings, setFindings] = useState<Finding[]>(data?.findings || []);

  useEffect(() => {
    if (!threadId || mcpResult) return;
    setIsLoading(true);
    import("@/core/config").then(({ getBackendBaseURL }) => {
      fetch(`${getBackendBaseURL()}/api/threads/${threadId}/imaging-reports`)
        .then(r => r.json())
        .then(d => {
          if (d.reports && d.reports.length > 0) {
            // Sort to get newest first if there are multiple, or just take the first one
            const report = d.reports[0];
            setReportId(report.report_id);
            const analyzedResult = report.doctor_result || report.ai_result || {};
            const parsedData = {
              image_path: report.image_path || analyzedResult.image_path,
              findings: analyzedResult.findings || [],
              model_version: analyzedResult.model_version,
              analyzed_at: analyzedResult.analyzed_at,
            };
            setData(parsedData);
            setFindings(parsedData.findings || []);
          }
        })
        .finally(() => setIsLoading(false));
    });
  }, [threadId, mcpResult]);

  const [activeTool, setActiveTool] = useState<ToolMode>("pan");
  const [zoom, setZoom] = useState(100);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const [pendingFinding, setPendingFinding] = useState<Finding | null>(null);
  const [pendingName, setPendingName] = useState("");

  // Resize state
  type ResizeHandle = "nw" | "ne" | "sw" | "se";
  const [resizing, setResizing] = useState<{ findingId: string; handle: ResizeHandle; startBbox: FindingBBox; startPt: { x: number; y: number } } | null>(null);

  // Move/drag state for bbox
  const [dragging, setDragging] = useState<{ findingId: string; offsetX: number; offsetY: number } | null>(null);

  // Erasing state (swipe-to-erase)
  const isErasing = useRef(false);
  const eraseHitsRef = useRef<Set<string>>(new Set());

  // Sketch (freehand drawing) state
  const [sketches, setSketches] = useState<SketchStroke[]>([]);
  const [currentSketch, setCurrentSketch] = useState<{ x: number; y: number }[] | null>(null);
  const [sketchColor] = useState("#facc15"); // yellow for visibility on dark bg
  const [sketchWidth] = useState(2);

  // Undo/Redo history (stores previous state snapshots)
  type HistorySnapshot = { findings: Finding[]; sketches: SketchStroke[] };
  const undoStackRef = useRef<HistorySnapshot[]>([]);
  const redoStackRef = useRef<HistorySnapshot[]>([]);
  const MAX_HISTORY = 50;
  // Force re-render when stacks change (refs don't trigger re-render)
  const [historyVersion, setHistoryVersion] = useState(0);

  // Keep latest state in refs so undo/redo always see fresh values
  const findingsRef = useRef(findings);
  findingsRef.current = findings;
  const sketchesRef = useRef(sketches);
  sketchesRef.current = sketches;

  /** Push current state to undo stack before a mutation (clears redo) */
  const pushHistory = useCallback(() => {
    const snap: HistorySnapshot = {
      findings: findingsRef.current.map(f => ({ ...f, bbox: { ...f.bbox } })),
      sketches: sketchesRef.current.map(s => ({ ...s, points: [...s.points] })),
    };
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_HISTORY - 1)),
      snap,
    ];
    redoStackRef.current = []; // clear redo on new mutation
    setHistoryVersion(v => v + 1);
  }, []);

  /** Undo: pop from undo, push current to redo */
  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    // Push current state to redo before restoring
    const currentSnap: HistorySnapshot = {
      findings: findingsRef.current.map(f => ({ ...f, bbox: { ...f.bbox } })),
      sketches: sketchesRef.current.map(s => ({ ...s, points: [...s.points] })),
    };
    redoStackRef.current.push(currentSnap);
    const prev = undoStackRef.current.pop()!;
    setFindings(prev.findings);
    setSketches(prev.sketches);
    setHasUnsavedChanges(true);
    setHistoryVersion(v => v + 1);
  }, []);

  /** Redo: pop from redo, push current to undo */
  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    // Push current state to undo before restoring
    const currentSnap: HistorySnapshot = {
      findings: findingsRef.current.map(f => ({ ...f, bbox: { ...f.bbox } })),
      sketches: sketchesRef.current.map(s => ({ ...s, points: [...s.points] })),
    };
    undoStackRef.current.push(currentSnap);
    const next = redoStackRef.current.pop()!;
    setFindings(next.findings);
    setSketches(next.sketches);
    setHasUnsavedChanges(true);
    setHistoryVersion(v => v + 1);
  }, []);

  // Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);

  // Refs
  const viewerRef = useRef<HTMLDivElement>(null);
  const imageLayerRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  // ── Coordinate helpers ───────────────────────────────────
  /** Convert mouse event to percentage coordinates relative to the image layer,
   *  accounting for current zoom and pan so annotations align with the image. */
  const toImagePercent = useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
    const el = imageLayerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
  }, []);

  // ── Pan limits ───────────────────────────────────────────
  /** Clamp pan offset so the image can't be dragged completely outside the viewer */
  const clampPan = useCallback((rawX: number, rawY: number): { x: number; y: number } => {
    const el = viewerRef.current;
    if (!el) return { x: rawX, y: rawY };
    const scale = zoom / 100;
    if (scale <= 1) return { x: 0, y: 0 }; // No pan at 100% or less
    // Max pan = how much the scaled image overflows the viewer, with some margin
    const rect = el.getBoundingClientRect();
    const maxPanX = (rect.width * (scale - 1)) / (2 * scale);
    const maxPanY = (rect.height * (scale - 1)) / (2 * scale);
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, rawX)),
      y: Math.max(-maxPanY, Math.min(maxPanY, rawY)),
    };
  }, [zoom]);

  // ── Zoom (non-passive wheel to prevent page scroll) ────────
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setZoom(prev => {
        const next = Math.max(50, Math.min(400, prev + (e.deltaY > 0 ? -15 : 15)));
        if (next <= 100) setPanOffset({ x: 0, y: 0 });
        return next;
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReset = useCallback(() => {
    setZoom(100);
    setBrightness(100);
    setContrast(100);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  // ── Mouse interactions ───────────────────────────────────
  /** Check if a point is inside a finding bbox */
  const ptInBbox = (pt: {x:number;y:number}, f: Finding) =>
    pt.x >= f.bbox.x && pt.x <= f.bbox.x + f.bbox.width &&
    pt.y >= f.bbox.y && pt.y <= f.bbox.y + f.bbox.height;

  /** Check if a point is near any sketch stroke (within threshold %) */
  const ptNearSketch = (pt: {x:number;y:number}, s: SketchStroke, threshold = 3) =>
    s.points.some(sp => Math.abs(sp.x - pt.x) < threshold && Math.abs(sp.y - pt.y) < threshold);

  /** Erase anything under the point */
  const eraseAtPoint = useCallback((pt: {x:number;y:number}) => {
    // Erase findings
    for (const f of findings) {
      if (!eraseHitsRef.current.has(f.id) && ptInBbox(pt, f)) {
        eraseHitsRef.current.add(f.id);
        setFindings(prev => prev.filter(fi => fi.id !== f.id));
        if (editingId === f.id) setEditingId(null);
        if (selectedId === f.id) setSelectedId(null);
        setHasUnsavedChanges(true);
      }
    }
    // Erase sketches
    for (const s of sketches) {
      if (!eraseHitsRef.current.has(s.id) && ptNearSketch(pt, s)) {
        eraseHitsRef.current.add(s.id);
        setSketches(prev => prev.filter(sk => sk.id !== s.id));
        setHasUnsavedChanges(true);
      }
    }
  }, [findings, sketches, editingId, selectedId]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (resizing || dragging) return;
    if (activeTool === "erase") {
      const pt = toImagePercent(e);
      if (pt) {
        pushHistory();
        isErasing.current = true;
        eraseHitsRef.current = new Set();
        eraseAtPoint(pt);
      }
      return;
    }
    if (activeTool === "pan") {
      isPanning.current = true;
      panStart.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
    } else if (activeTool === "draw") {
      const pt = toImagePercent(e);
      if (pt) {
        setIsDrawing(true);
        setDrawStart(pt);
        setDrawCurrent(pt);
      }
    } else if (activeTool === "sketch") {
      const pt = toImagePercent(e);
      if (pt) {
        setCurrentSketch([pt]);
      }
    }
  }, [activeTool, panOffset, toImagePercent, resizing, dragging, pushHistory, eraseAtPoint]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Swipe erase
    if (isErasing.current && activeTool === "erase") {
      const pt = toImagePercent(e);
      if (pt) eraseAtPoint(pt);
      return;
    }
    // Box move drag
    if (dragging) {
      const pt = toImagePercent(e);
      if (!pt) return;
      const f = findings.find(fi => fi.id === dragging.findingId);
      if (!f) return;
      let newX = pt.x - dragging.offsetX;
      let newY = pt.y - dragging.offsetY;
      // Clamp so box stays within image
      newX = Math.max(0, Math.min(100 - f.bbox.width, newX));
      newY = Math.max(0, Math.min(100 - f.bbox.height, newY));
      updateFinding(dragging.findingId, { bbox: { ...f.bbox, x: newX, y: newY } });
      return;
    }
    // Resize handle drag
    if (resizing) {
      const pt = toImagePercent(e);
      if (!pt) return;
      const { handle, findingId } = resizing;
      const f = findings.find(fi => fi.id === findingId);
      if (!f) return;
      let { x, y, width, height } = f.bbox;
      const right = x + width;
      const bottom = y + height;
      const MIN = 3;

      if (handle === "nw") {
        const newX = Math.min(pt.x, right - MIN);
        const newY = Math.min(pt.y, bottom - MIN);
        width = right - newX;
        height = bottom - newY;
        x = newX; y = newY;
      } else if (handle === "ne") {
        const newRight = Math.max(pt.x, x + MIN);
        const newY = Math.min(pt.y, bottom - MIN);
        width = newRight - x;
        height = bottom - newY;
        y = newY;
      } else if (handle === "sw") {
        const newX = Math.min(pt.x, right - MIN);
        const newBottom = Math.max(pt.y, y + MIN);
        width = right - newX;
        height = newBottom - y;
        x = newX;
      } else if (handle === "se") {
        const newRight = Math.max(pt.x, x + MIN);
        const newBottom = Math.max(pt.y, y + MIN);
        width = newRight - x;
        height = newBottom - y;
      }

      x = Math.max(0, x); y = Math.max(0, y);
      width = Math.min(width, 100 - x); height = Math.min(height, 100 - y);

      updateFinding(findingId, { bbox: { x, y, width, height } });
      return;
    }
    if (isPanning.current) {
      const raw = { x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y };
      setPanOffset(clampPan(raw.x, raw.y));
    } else if (isDrawing) {
      const pt = toImagePercent(e);
      if (pt) setDrawCurrent(pt);
    } else if (currentSketch && activeTool === "sketch") {
      const pt = toImagePercent(e);
      if (pt) setCurrentSketch(prev => prev ? [...prev, pt] : [pt]);
    }
  }, [isDrawing, toImagePercent, resizing, clampPan, findings, dragging, currentSketch, activeTool, eraseAtPoint]);

  const handleMouseUp = useCallback(() => {
    // Stop erasing
    if (isErasing.current) {
      isErasing.current = false;
      eraseHitsRef.current = new Set();
      return;
    }
    if (dragging) {
      setDragging(null);
      return;
    }
    if (resizing) {
      setResizing(null);
      return;
    }
    if (isPanning.current) {
      isPanning.current = false;
    }
    if (isDrawing && drawStart && drawCurrent) {
      // Calculate bbox from drag
      const x = Math.min(drawStart.x, drawCurrent.x);
      const y = Math.min(drawStart.y, drawCurrent.y);
      const w = Math.abs(drawCurrent.x - drawStart.x);
      const h = Math.abs(drawCurrent.y - drawStart.y);

      // Minimum size check (at least 3% x 3%)
      if (w >= 3 && h >= 3) {
        pushHistory();
        const newFinding: Finding = {
          id: `human_${Date.now()}`,
          name: "",
          confidence: 100,
          note: "",
          bbox: { x, y, width: w, height: h },
          source: "human",
          modified: false,
          color: pickColor(findings, "human"),
        };
        setPendingFinding(newFinding);
        setPendingName("");
      }
      setIsDrawing(false);
      setDrawStart(null);
      setDrawCurrent(null);
    }
    // Finish sketch stroke
    if (currentSketch && currentSketch.length >= 2) {
      pushHistory();
      setSketches(prev => [...prev, {
        id: `sketch_${Date.now()}`,
        points: currentSketch,
        color: sketchColor,
        width: sketchWidth,
      }]);
      setHasUnsavedChanges(true);
    }
    setCurrentSketch(null);
  }, [isDrawing, drawStart, drawCurrent, findings, resizing, dragging, pushHistory, currentSketch, sketchColor, sketchWidth]);

  // ── Start resize from handle ─────────────────────────────
  const startResize = useCallback((e: React.MouseEvent, findingId: string, handle: "nw" | "ne" | "sw" | "se") => {
    e.stopPropagation();
    e.preventDefault();
    const f = findings.find(fi => fi.id === findingId);
    if (!f) return;
    const pt = toImagePercent(e);
    if (!pt) return;
    setResizing({ findingId, handle, startBbox: { ...f.bbox }, startPt: pt });
  }, [findings, toImagePercent]);

  // ── Start box drag/move ───────────────────────────────────
  const startDrag = useCallback((e: React.MouseEvent, findingId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const pt = toImagePercent(e);
    const f = findings.find(fi => fi.id === findingId);
    if (!pt || !f) return;
    pushHistory();
    setDragging({ findingId, offsetX: pt.x - f.bbox.x, offsetY: pt.y - f.bbox.y });
  }, [findings, toImagePercent, pushHistory]);

  // ── Confirm new finding (requires name) ──────────────────
  const confirmPendingFinding = () => {
    if (!pendingFinding || !pendingName.trim()) return;
    const f = { ...pendingFinding, name: pendingName.trim() };
    setFindings(prev => [...prev, f]);
    setPendingFinding(null);
    setPendingName("");
    setHasUnsavedChanges(true);
    setSelectedId(f.id);
  };

  const cancelPendingFinding = () => {
    setPendingFinding(null);
    setPendingName("");
  };

  // ── Finding CRUD (with source tracking + undo) ───────────
  const updateFinding = (id: string, patch: Partial<Finding>) => {
    setFindings(prev => prev.map(f => {
      if (f.id !== id) return f;
      const wasAi = f.source === "ai" && !f.modified;
      return {
        ...f,
        ...patch,
        modified: wasAi ? true : f.modified,
      };
    }));
    setHasUnsavedChanges(true);
  };

  /** Wrapper that pushes history before update (for discrete edits, not continuous drag) */
  const updateFindingWithHistory = (id: string, patch: Partial<Finding>) => {
    pushHistory();
    updateFinding(id, patch);
  };

  const deleteFinding = (id: string) => {
    pushHistory();
    setFindings(prev => prev.filter(f => f.id !== id));
    if (editingId === id) setEditingId(null);
    if (selectedId === id) setSelectedId(null);
    setHasUnsavedChanges(true);
  };

  const deleteSketch = (id: string) => {
    pushHistory();
    setSketches(prev => prev.filter(s => s.id !== id));
    setHasUnsavedChanges(true);
  };

  // ── Export JSON ──────────────────────────────────────────
  const exportJson = (): McpAnalysisResult => ({
    image_path: data?.image_path || "",
    model_version: data?.model_version,
    analyzed_at: data?.analyzed_at,
    findings,
  });

  const handleSave = async () => {
    const json = exportJson();
    if (threadId && reportId) {
      try {
        const { getBackendBaseURL } = await import("@/core/config");
        const res = await fetch(`${getBackendBaseURL()}/api/threads/${threadId}/imaging-reports/${reportId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(json),
        });
        if (res.ok) {
          console.log("[ImagingViewer] Saved corrected JSON to backend");
          setHasUnsavedChanges(false);
        } else {
          console.error("Failed to save report corrections", res.status);
        }
      } catch (err) {
        console.error("Failed to save report corrections", err);
      }
    } else {
      console.log("[ImagingViewer] Saving corrected JSON (No active thread):", json);
      setHasUnsavedChanges(false);
    }
  };

  const handleDownload = () => {
    const json = exportJson();
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `xray_findings_corrected_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Cursor based on tool
  const cursorClass: Record<ToolMode, string> = {
    zoom: "cursor-zoom-in",
    pan: isPanning.current ? "cursor-grabbing" : "cursor-grab",
    draw: "cursor-crosshair",
    erase: "cursor-pointer",
    sketch: "cursor-crosshair",
  };

  const tools: { mode: ToolMode; icon: React.ElementType; label: string }[] = [
    { mode: "pan", icon: Move, label: "平移" },
    { mode: "draw", icon: Pen, label: "绘制病灶框" },
    { mode: "sketch", icon: Pencil, label: "自由画笔" },
    { mode: "erase", icon: Eraser, label: "删除模式" },
  ];

  // Stats
  const aiCount = findings.filter(f => f.source === "ai" && !f.modified).length;
  const humanCount = findings.filter(f => f.source === "human").length;
  const correctedCount = findings.filter(f => f.source === "ai" && f.modified).length;

  // Drawing preview rect
  const drawRect = (isDrawing && drawStart && drawCurrent) ? {
    x: Math.min(drawStart.x, drawCurrent.x),
    y: Math.min(drawStart.y, drawCurrent.y),
    width: Math.abs(drawCurrent.x - drawStart.x),
    height: Math.abs(drawCurrent.y - drawStart.y),
  } : null;

  return (
    <div className="animate-in fade-in duration-300 flex flex-col h-full">
      {/* ── Header ────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-800">Chest X-Ray Analysis</h2>
          <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
            Model: {data?.model_version || "N/A"} · {data?.image_path || "N/A"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Source stats */}
          <div className="flex items-center gap-1.5 mr-2">
            {aiCount > 0 && (
              <span className="text-[10px] font-bold bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full border border-violet-200 flex items-center gap-1">
                <Bot className="h-3 w-3" /> AI: {aiCount}
              </span>
            )}
            {correctedCount > 0 && (
              <span className="text-[10px] font-bold bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full border border-sky-200 flex items-center gap-1">
                <UserCheck className="h-3 w-3" /> 已修正: {correctedCount}
              </span>
            )}
            {humanCount > 0 && (
              <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                <UserCheck className="h-3 w-3" /> 医生: {humanCount}
              </span>
            )}
          </div>

          <button
            onClick={() => setShowAnnotations(!showAnnotations)}
            className={cn(
              "flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all",
              showAnnotations ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-slate-50 text-slate-400 border-slate-200"
            )}
          >
            {showAnnotations ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            标注
          </button>

          {/* Save / Download */}
          <Button
            variant="outline"
            size="sm"
            className={cn("h-7 text-xs gap-1", hasUnsavedChanges && "border-amber-400 text-amber-700 bg-amber-50")}
            onClick={handleSave}
          >
            <Save className="h-3 w-3" />
            {hasUnsavedChanges ? "保存修改" : "已保存"}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleDownload}>
            <Download className="h-3 w-3" /> JSON
          </Button>
        </div>
      </div>

      {/* ── Drawing mode hint ─────────────────────────── */}
      {activeTool === "draw" && (
        <div className="mb-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 font-medium flex items-center gap-2 shrink-0">
          <Pen className="h-3.5 w-3.5" />
          <span>绘制模式：在影像上拖拽绘制矩形框选病灶区域，松开后输入病灶名称</span>
        </div>
      )}

      {/* ── Image Viewer ──────────────────────────────── */}
      <div className="flex-1 min-h-0 relative">
        <div
          ref={viewerRef}
          className={cn("relative w-full h-full bg-black rounded-xl overflow-hidden shadow-xl", cursorClass[activeTool])}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { isPanning.current = false; }}
        >
          {/* ═══ Transform Layer: image + annotations move together ═══ */}
          <div
            ref={imageLayerRef}
            className="relative w-full h-full transition-transform duration-150"
            style={{
              transform: `scale(${zoom / 100}) translate(${panOffset.x / (zoom / 100)}px, ${panOffset.y / (zoom / 100)}px)`,
              transformOrigin: "center center",
            }}
          >
            {/* X-Ray Image */}
            <img
              src={data?.image_path || ""}
              alt="Medical Image"
              className="w-full h-full object-contain select-none pointer-events-none"
              draggable={false}
              style={{
                filter: `brightness(${brightness / 100}) contrast(${contrast / 100})`,
              }}
            />

            {/* Annotation overlays — same layer as image, moves with zoom/pan */}
            {showAnnotations && findings.map(f => {
              const colors = colorMap[f.color] || colorMap.red!;
              const isSelected = selectedId === f.id;
              return (
                <div
                  key={f.id}
                  className={cn(
                    "absolute",
                    isSelected && "z-10",
                    isSelected && !resizing && !dragging && "cursor-move",
                  )}
                  style={{
                    left: `${f.bbox.x}%`,
                    top: `${f.bbox.y}%`,
                    width: `${f.bbox.width}%`,
                    height: `${f.bbox.height}%`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(isSelected ? null : f.id);
                  }}
                  onMouseDown={(e) => {
                    // Only start drag if this box is already selected and no tool-specific action
                    if (isSelected && activeTool !== "draw" && activeTool !== "erase" && activeTool !== "sketch") {
                      startDrag(e, f.id);
                    }
                  }}
                >
                  {/* Box border */}
                  <div className={cn(
                    "w-full h-full rounded-sm border-2",
                    colors.border, colors.bg,
                    isSelected && "ring-2 ring-white/60 ring-offset-1 ring-offset-black/20"
                  )} />

                  {/* Label tag */}
                  <div className="absolute -top-6 left-0 flex items-center gap-1 pointer-events-none">
                    <span className={cn("text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap flex items-center gap-1", colors.label)}>
                      {f.source === "ai" && !f.modified ? (
                        <Bot className="h-2.5 w-2.5" />
                      ) : (
                        <UserCheck className="h-2.5 w-2.5" />
                      )}
                      {f.name} · {f.confidence.toFixed(1)}%
                    </span>
                  </div>

                  {/* Delete button — visible when selected, at top-right */}
                  {isSelected && (
                    <button
                      className="absolute -top-7 -right-1 bg-red-600 hover:bg-red-700 text-white rounded-full p-1 shadow-lg z-30 transition-all hover:scale-110"
                      title="删除此病灶"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFinding(f.id);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}

                  {/* Resize handles — only visible when selected */}
                  {isSelected && (
                    <>
                      {(["nw", "ne", "sw", "se"] as const).map(handle => (
                        <div
                          key={handle}
                          className={cn(
                            "absolute w-3 h-3 bg-white border-2 border-blue-500 rounded-full z-20 hover:scale-125 transition-transform",
                            handle === "nw" && "-top-1.5 -left-1.5 cursor-nw-resize",
                            handle === "ne" && "-top-1.5 -right-1.5 cursor-ne-resize",
                            handle === "sw" && "-bottom-1.5 -left-1.5 cursor-sw-resize",
                            handle === "se" && "-bottom-1.5 -right-1.5 cursor-se-resize",
                          )}
                          onMouseDown={(e) => {
                            pushHistory();
                            startResize(e, f.id, handle);
                          }}
                        />
                      ))}
                    </>
                  )}
                </div>
              );
            })}

            {/* ── Sketch SVG overlay (freehand lines) ── */}
            {(sketches.length > 0 || currentSketch) && (
              <svg
                className={cn(
                  "absolute inset-0 w-full h-full z-[5]",
                  activeTool === "erase" ? "pointer-events-auto" : "pointer-events-none"
                )}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {sketches.map(s => (
                  <polyline
                    key={s.id}
                    points={s.points.map(p => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={activeTool === "erase" ? Math.max(s.width / (zoom / 100), 6) : s.width / (zoom / 100)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    className={cn(activeTool === "erase" && "cursor-pointer hover:stroke-red-500 transition-colors")}
                    style={activeTool === "erase" ? { pointerEvents: "stroke" } : undefined}
                    onClick={activeTool === "erase" ? (e) => { e.stopPropagation(); deleteSketch(s.id); } : undefined}
                  />
                ))}
                {currentSketch && currentSketch.length >= 2 && (
                  <polyline
                    points={currentSketch.map(p => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke={sketchColor}
                    strokeWidth={sketchWidth / (zoom / 100)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="2,2"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>
            )}

            {/* Drawing preview rectangle — inside transform layer */}
            {drawRect && (
              <div
                className="absolute border-2 border-dashed border-blue-400 bg-blue-400/10 rounded-sm pointer-events-none z-20"
                style={{
                  left: `${drawRect.x}%`,
                  top: `${drawRect.y}%`,
                  width: `${drawRect.width}%`,
                  height: `${drawRect.height}%`,
                }}
              />
            )}

            {/* Pending finding box preview — inside transform layer */}
            {pendingFinding && (
              <div
                className="absolute border-2 border-blue-500 bg-blue-500/15 rounded-sm pointer-events-none z-20 animate-pulse"
                style={{
                  left: `${pendingFinding.bbox.x}%`,
                  top: `${pendingFinding.bbox.y}%`,
                  width: `${pendingFinding.bbox.width}%`,
                  height: `${pendingFinding.bbox.height}%`,
                }}
              />
            )}
          </div>
          {/* ═══ End Transform Layer ═══ */}

          {/* Pending finding: name input dialog — OUTSIDE transform layer, pinned to viewport */}
          {pendingFinding && (
            <div
              className="absolute z-30 pointer-events-auto"
              style={{
                left: `${pendingFinding.bbox.x}%`,
                top: `${Math.min(pendingFinding.bbox.y + pendingFinding.bbox.height + 2, 75)}%`,
              }}
            >
              <div className="bg-white rounded-lg shadow-xl border border-blue-300 p-3 w-64 animate-in zoom-in-95 duration-200">
                <p className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1">
                  <UserCheck className="h-3.5 w-3.5 text-blue-600" />
                  新增病灶标注
                </p>
                <Input
                  placeholder="输入病灶名称 (必填)..."
                  value={pendingName}
                  onChange={(e) => setPendingName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") confirmPendingFinding(); if (e.key === "Escape") cancelPendingFinding(); }}
                  className="h-8 text-sm mb-2"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs flex-1 gap-1" onClick={confirmPendingFinding} disabled={!pendingName.trim()}>
                    <Check className="h-3 w-3" /> 确认
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={cancelPendingFinding}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Floating Toolbar — OUTSIDE transform layer, pinned to viewer corner */}
          <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-md rounded-xl p-1.5 shadow-lg flex flex-col gap-1 border border-white/10 z-20">
            {tools.map(t => (
              <button
                key={t.mode}
                onClick={() => setActiveTool(t.mode)}
                className={cn(
                  "p-2 rounded-lg transition-all flex items-center justify-center",
                  activeTool === t.mode
                    ? "bg-blue-600 text-white shadow-md"
                    : "text-white/60 hover:bg-white/10 hover:text-white"
                )}
                title={t.label}
              >
                <t.icon className="h-4 w-4" />
              </button>
            ))}
            <div className="border-t border-white/10 my-1" />
            <button onClick={() => setZoom(p => Math.min(p + 25, 400))} className="p-2 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-all" title="放大">
              <ZoomIn className="h-4 w-4" />
            </button>
            <button onClick={() => setZoom(p => Math.max(p - 25, 50))} className="p-2 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-all" title="缩小">
              <ZoomOut className="h-4 w-4" />
            </button>
            <button onClick={handleReset} className="p-2 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-all" title="重置视图">
              <RotateCcw className="h-4 w-4" />
            </button>
            {/* Clear all canvas (sketches + findings) */}
            <button
              onClick={() => {
                if (findings.length === 0 && sketches.length === 0) return;
                pushHistory();
                setFindings(data?.findings || []); // reset to original AI findings
                setSketches([]);
                setSelectedId(null);
                setEditingId(null);
                setHasUnsavedChanges(true);
              }}
              className={cn(
                "p-2 rounded-lg transition-all",
                (findings.length > (data?.findings?.length || 0) || sketches.length > 0)
                  ? "text-red-400 hover:bg-red-500/20 hover:text-red-300"
                  : "text-white/60 hover:bg-white/10 hover:text-white"
              )}
              title="一键清除画布 (恢复原始AI标注)"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <div className="border-t border-white/10 my-1" />
            {/* Undo */}
            <button
              onClick={handleUndo}
              disabled={undoStackRef.current.length === 0}
              className={cn(
                "p-2 rounded-lg transition-all relative",
                undoStackRef.current.length > 0
                  ? "text-amber-400 hover:bg-amber-500/20 hover:text-amber-300"
                  : "text-white/20 cursor-not-allowed"
              )}
              title={`撤回 (Ctrl+Z)${undoStackRef.current.length > 0 ? ` · ${undoStackRef.current.length} 步` : ''}`}
            >
              <Undo2 className="h-4 w-4" />
              {undoStackRef.current.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-amber-500 text-black text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
                  {undoStackRef.current.length}
                </span>
              )}
            </button>
            {/* Redo */}
            <button
              onClick={handleRedo}
              disabled={redoStackRef.current.length === 0}
              className={cn(
                "p-2 rounded-lg transition-all relative",
                redoStackRef.current.length > 0
                  ? "text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300"
                  : "text-white/20 cursor-not-allowed"
              )}
              title={`重做 (Ctrl+Shift+Z)${redoStackRef.current.length > 0 ? ` · ${redoStackRef.current.length} 步` : ''}`}
            >
              <Redo2 className="h-4 w-4" />
              {redoStackRef.current.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-emerald-500 text-black text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
                  {redoStackRef.current.length}
                </span>
              )}
            </button>
          </div>

          {/* Bottom Status Bar — OUTSIDE transform layer, pinned to viewer bottom */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-3 pointer-events-none">
            <div className="flex items-center justify-between text-[11px] text-white/70 font-mono">
              <div className="flex items-center gap-4">
                <span>Zoom: {zoom}%</span>
                <span className="flex items-center gap-1"><Sun className="h-3 w-3" /> {brightness}%</span>
                <span className="flex items-center gap-1"><Contrast className="h-3 w-3" /> {contrast}%</span>
              </div>
              <span>512 × 512 px · 8-bit · {new Date().toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Panel ──────────────────────────────── */}
      <div className="mt-3 shrink-0 space-y-3">
        {/* Brightness / Contrast strip */}
        <div className="flex items-center gap-6 bg-white border border-slate-200 rounded-xl px-5 py-2.5 shadow-sm">
          <div className="flex items-center gap-2 flex-1">
            <Sun className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span className="text-[11px] text-slate-500 w-8 shrink-0">亮度</span>
            <input type="range" min="30" max="200" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="flex-1 h-1 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600" />
            <span className="text-[11px] font-mono text-slate-500 w-10 text-right">{brightness}%</span>
          </div>
          <div className="w-px h-5 bg-slate-200" />
          <div className="flex items-center gap-2 flex-1">
            <Contrast className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span className="text-[11px] text-slate-500 w-10 shrink-0">对比度</span>
            <input type="range" min="30" max="200" value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="flex-1 h-1 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600" />
            <span className="text-[11px] font-mono text-slate-500 w-10 text-right">{contrast}%</span>
          </div>
          <div className="w-px h-5 bg-slate-200" />
          <button onClick={handleReset} className="text-[11px] text-slate-400 hover:text-slate-700 transition-colors flex items-center gap-1">
            <RotateCcw className="h-3 w-3" /> 重置
          </button>
        </div>

        {/* Findings list */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
              检出结果
              <span className="text-[9px] font-bold bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full border border-amber-200 normal-case">
                {findings.length} Findings
              </span>
            </h4>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setActiveTool("draw")}>
              <Plus className="h-3 w-3" /> 绘制新病灶
            </Button>
          </div>

          {findings.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">暂无检出结果。选择「绘制新病灶」工具在影像上框选区域</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {findings.map(f => {
                const colors = colorMap[f.color] || colorMap.red!;
                const isEditing = editingId === f.id;
                const isSelected = selectedId === f.id;

                return (
                  <div
                    key={f.id}
                    className={cn(
                      "border rounded-xl p-3 min-w-[260px] max-w-[320px] shrink-0 transition-all relative group cursor-pointer",
                      isEditing ? "ring-2 ring-blue-400 border-blue-300 bg-blue-50/30" :
                      isSelected ? cn("ring-2 ring-offset-1", colors.cardBorder, colors.cardBg, `ring-${f.color}-300`) :
                      cn(colors.cardBorder, "bg-white hover:shadow-md")
                    )}
                    onClick={() => setSelectedId(isSelected ? null : f.id)}
                  >
                    {/* Action buttons (visible on hover) */}
                    <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingId(isEditing ? null : f.id); }}
                        className="p-1 rounded hover:bg-blue-100 text-slate-400 hover:text-blue-600 transition-colors"
                        title="编辑"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteFinding(f.id); }}
                        className="p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Source badge + name */}
                    <div className="flex items-center gap-2 mb-2 pr-12">
                      <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", colors.dot)} />
                      {isEditing ? (
                        <Input
                          className="h-6 text-xs font-bold border-slate-300 px-2"
                          value={f.name}
                          onChange={(e) => updateFinding(f.id, { name: e.target.value })}
                          onClick={(e) => e.stopPropagation()}
                          autoFocus
                        />
                      ) : (
                        <span className={cn("text-xs font-bold truncate", colors.text)}>{f.name}</span>
                      )}
                      <SourceBadge source={f.source} modified={f.modified} small />
                    </div>

                    {/* Confidence — always adjustable with AI original marker */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[11px] text-slate-500 shrink-0">置信度</span>
                      <div className="flex items-center gap-1.5 flex-1" onClick={(e) => e.stopPropagation()}>
                        {/* Bar with adjustable slider */}
                        <div className="flex-1 relative group/conf cursor-pointer" style={{ paddingTop: '6px', paddingBottom: '6px' }}>
                          {/* Background bar */}
                          <div className={cn("w-full h-2 rounded-full overflow-visible relative", colors.barBg)}>
                            {/* Fill bar */}
                            <div className={cn("h-full rounded-full transition-all duration-300", colors.barFill)} style={{ width: `${f.confidence}%` }} />
                            
                            {/* Current value handle (draggable thumb) */}
                            <div
                              className={cn("absolute top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-sm shadow-sm transition-all duration-300 z-10", colors.barFill)}
                              style={{ left: `${f.confidence}%`, marginLeft: '-1.5px' }}
                            />
                            
                            {/* AI original marker handle (dashed style) */}
                            {f.originalConfidence !== undefined && f.originalConfidence !== f.confidence && (
                              <div
                                className="absolute top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-sm z-10 border border-slate-500 bg-white/80"
                                style={{ left: `${f.originalConfidence}%`, marginLeft: '-1.5px', borderStyle: 'dashed' }}
                                title={`AI 原始: ${f.originalConfidence.toFixed(1)}%`}
                              >
                                <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] whitespace-nowrap bg-slate-700 text-white px-1 py-0.5 rounded opacity-0 group-hover/conf:opacity-100 transition-opacity pointer-events-none">
                                  AI {f.originalConfidence.toFixed(1)}%
                                </div>
                              </div>
                            )}
                          </div>
                          {/* Invisible range input overlaid for drag adjustment */}
                          <input
                            type="range" min="0" max="100" step="0.5" value={f.confidence}
                            onMouseDown={() => {
                              pushHistory();
                              // Capture AI original on first manual touch
                              if (f.source === "ai" && f.originalConfidence === undefined) {
                                updateFinding(f.id, { originalConfidence: f.confidence });
                              }
                            }}
                            onChange={(e) => {
                              const newConf = Number(e.target.value);
                              updateFinding(f.id, { confidence: newConf });
                            }}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          />
                        </div>
                        {/* Current value */}
                        <span className={cn("text-[11px] font-bold tabular-nums min-w-[40px] text-right", colors.text)}>
                          {f.confidence.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    {/* AI original confidence label when adjusted */}
                    {f.originalConfidence !== undefined && f.originalConfidence !== f.confidence && (
                      <div className="flex items-center gap-1 mb-1 ml-9">
                        <Bot className="h-3 w-3 text-slate-400" />
                        <span className="text-[10px] text-slate-400">
                          AI 原始: {f.originalConfidence.toFixed(1)}%
                        </span>
                        <span className={cn(
                          "text-[10px] font-semibold",
                          f.confidence > f.originalConfidence ? "text-emerald-500" : "text-red-500"
                        )}>
                          ({f.confidence > f.originalConfidence ? "+" : ""}{(f.confidence - f.originalConfidence).toFixed(1)}%)
                        </span>
                      </div>
                    )}

                    {/* Bbox coordinates (read-only display) */}
                    <div className="text-[10px] text-slate-400 font-mono mb-1">
                      bbox: [{f.bbox.x.toFixed(1)}, {f.bbox.y.toFixed(1)}, {f.bbox.width.toFixed(1)}, {f.bbox.height.toFixed(1)}]
                    </div>

                    {/* Note */}
                    {isEditing ? (
                      <textarea
                        className="w-full mt-1 text-[11px] text-slate-600 bg-white border border-slate-300 rounded-lg p-2 resize-none focus:ring-1 focus:ring-blue-400 focus:outline-none"
                        rows={2}
                        placeholder="备注说明..."
                        value={f.note}
                        onChange={(e) => updateFinding(f.id, { note: e.target.value })}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : f.note ? (
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed line-clamp-2">{f.note}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
