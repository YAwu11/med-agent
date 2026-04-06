import { FileText } from "lucide-react";
import { type FocusEvent, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type OcrBlockType = "title" | "text" | "table" | "figure" | "formula";

export interface OcrBaseBlock {
  type: OcrBlockType;
  bbox?: [number, number, number, number];
  score?: number;
}

export interface OcrTitleBlock extends OcrBaseBlock {
  type: "title";
  res: { text: string; [key: string]: unknown } | string;
}

export interface OcrTextBlock extends OcrBaseBlock {
  type: "text";
  res: { text: string; [key: string]: unknown } | string;
}

export interface OcrTableBlock extends OcrBaseBlock {
  type: "table";
  res: { html?: string; text?: string; cells?: unknown[]; [key: string]: unknown } | string;
}

export interface OcrUnknownBlock extends OcrBaseBlock {
  type: "figure" | "formula";
  res?: unknown;
}

export type OcrBlock = OcrTitleBlock | OcrTextBlock | OcrTableBlock | OcrUnknownBlock;
type EditableOcrBlock = OcrTitleBlock | OcrTextBlock | OcrTableBlock;

interface OcrDocumentViewerProps {
  blocks: OcrBlock[];
  title?: string;
  className?: string;
  onChange?: (blocks: OcrBlock[]) => void;
}

export function OcrDocumentViewer({ blocks, title, className, onChange }: OcrDocumentViewerProps) {
  const handleBlockChange = (index: number, newValue: string, key: "text" | "html") => {
    if (!onChange) return;
    const newBlocks = [...blocks];
    const target = newBlocks[index];
    if (!target || !hasEditableRes(target)) {
      return;
    }
    
    // Create new res object to avoid direct mutation
    const currentRes = target.res;
    if (typeof currentRes === "string") {
      target.res = key === "text" ? newValue : { html: newValue };
    } else {
      target.res = { ...currentRes, [key]: newValue };
    }
    
    onChange(newBlocks);
  };

  return (
     <div className={cn("w-full h-full bg-white flex flex-col items-stretch", className)}>
        {/* Header Block similar to LabReportViewer */}
        <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between bg-white shrink-0 shadow-sm z-10 sticky top-0">
           <div className="flex items-center gap-3">
             <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center border border-indigo-100/50">
               <FileText className="h-5 w-5" />
             </div>
             <div>
               <h3 className="text-lg font-bold text-slate-800 tracking-tight">{title ?? "原始识别报告"}</h3>
               <p className="text-xs text-slate-500 font-medium tracking-wide">Structured OCR Document Flow (Editable)</p>
             </div>
           </div>
        </div>
        
        {/* Flow Document Body */}
        <div className="flex-1 overflow-auto p-12 bg-[#Fdfbf7] relative scroll-smooth">
           <div className="max-w-[1200px] mx-auto space-y-6 bg-white p-10 rounded-2xl shadow-sm border border-slate-200 min-h-full">
              {blocks.map((block, i) => {
                 return <OcrBlockRenderer 
                   key={i} 
                   block={block} 
                   index={i} 
                   onChange={(val, key) => handleBlockChange(i, val, key)} 
                 />;
              })}
              {blocks.length === 0 && (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                  <p>未解析到任何结构化块内容</p>
                </div>
              )}
           </div>
        </div>
     </div>
  );
}

function hasEditableRes(block: OcrBlock): block is EditableOcrBlock {
  return "res" in block;
}

function OcrBlockRenderer({ block, index, onChange }: { block: OcrBlock; index: number, onChange: (val: string, key: "text" | "html") => void }) {
  const blockRes = hasEditableRes(block) ? block.res : undefined;

  if (block.type === "title") {
    const text = typeof block.res === "string" ? block.res : block.res.text ?? "";
    return (
      <div className={cn("group flex items-baseline gap-2", index > 0 ? "mt-12 mb-4" : "mb-6")}>
        <div className="w-1.5 h-5 bg-indigo-500 rounded-full shrink-0 self-center" />
        <EditableText 
          tagName="h2" 
          html={text} 
          onChange={(newText) => onChange(newText, "text")} 
          className="text-xl font-bold text-slate-800 tracking-tight outline-none focus:ring-2 focus:ring-indigo-100 focus:bg-indigo-50/30 rounded px-1 -ml-1 transition-all min-w-[50px] cursor-text" 
        />
      </div>
    );
  }

  if (block.type === "text") {
    const text = typeof block.res === "string" ? block.res : block.res.text ?? "";
    return (
      <EditableText 
        tagName="div" 
        html={text} 
        onChange={(newText) => onChange(newText, "text")} 
        className="text-[15px] leading-relaxed text-slate-700 pl-3.5 my-2 outline-none focus:ring-2 focus:ring-slate-100 focus:bg-slate-50/50 rounded py-1 -ml-1 transition-all cursor-text min-h-[1.5em]" 
      />
    );
  }

  if (block.type === "table") {
    const html = typeof block.res === "string" ? "" : block.res.html ?? "";
    if (!html) {
      const fallbackText = typeof block.res === "string" ? block.res : block.res.text ?? "[解析异常表格]";
      return <div className="text-sm text-slate-500 italic pl-3.5 border-l-2 border-slate-200 my-4">{fallbackText}</div>;
    }

    return (
      <div className="my-8">
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white hover:border-indigo-200 transition-colors">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex justify-between items-center text-xs text-slate-500">
             <span>表格数据支持点击直接编辑修改</span>
             <span className="text-slate-400">Auto-saved</span>
          </div>
          <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-200">
             <EditableTableBlock html={html} onChange={(newHtml) => onChange(newHtml, "html")} />
          </div>
        </div>
      </div>
    );
  }

  // Fallback for unknown block types
  return (
    <div className="text-xs text-slate-400 font-mono p-3 bg-slate-50 rounded border border-slate-100 break-all my-2">
       [Unknown Block Type: {block.type}] {JSON.stringify(blockRes).substring(0, 100)}...
    </div>
  );
}

// ── Isolated ContentEditable Components (ADR Compliant) ────────

function EditableText({ tagName, html, className, onChange }: { tagName: "h2" | "div"; html: string; className: string; onChange: (text: string) => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const divRef = useRef<HTMLDivElement>(null);
  
  const handleBlur = () => {
    const currentElement = tagName === "h2" ? headingRef.current : divRef.current;
    if (!currentElement) return;
    const currentText = currentElement.innerText ?? "";
    if (currentText !== html) {
      onChange(currentText);
    }
  };
  
  // Only dangerously set it once, let the DOM handle the rest unless html prop totally changes from a different evidence pick
  const [internalHtml, setInternalHtml] = useState(html);
  useEffect(() => {
    // Only update if it significantly diverged (e.g. switching tabs). Prevents SSE bouncing cursor.
    const currentElement = tagName === "h2" ? headingRef.current : divRef.current;
    if (currentElement && currentElement.innerText !== html) {
      setInternalHtml(html);
    }
  }, [html, tagName]);

  if (tagName === "h2") {
    return (
      <h2
        ref={headingRef}
        contentEditable
        suppressContentEditableWarning
        className={className}
        onBlur={handleBlur}
        dangerouslySetInnerHTML={{ __html: internalHtml }}
      />
    );
  }

  return (
    <div
      ref={divRef}
      contentEditable
      suppressContentEditableWarning
      className={className}
      onBlur={handleBlur}
      dangerouslySetInnerHTML={{ __html: internalHtml }}
    />
  );
}

function EditableTableBlock({ html, onChange }: { html: string, onChange: (newHtml: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [internalHtml, setInternalHtml] = useState(html);

  // Sync prop changes safely without wiping active edits
  useEffect(() => {
    if (!containerRef.current) return;
    
    // A heuristic: if the outerHTML of the current table differs drastically from `html`
    // (e.g. switching tabs or a major backend refresh), update it.
    // If it's just a debounce loopback, ignore it so cursor stays put.
    const currentLiveHtml = containerRef.current.querySelector("table")?.outerHTML ?? "";
    // Normalize string lengths roughly to detect a completely new table vs minor local edit
    if (Math.abs(currentLiveHtml.length - html.length) > 50 || currentLiveHtml === "") {
      setInternalHtml(html);
    }
  }, [html]);

  // Inject contentEditable into TDs dynamically
  useEffect(() => {
    if (!containerRef.current) return;
    const tds = containerRef.current.querySelectorAll("td, th");
    tds.forEach(td => {
      td.setAttribute("contenteditable", "true");
      td.classList.add(
        "hover:bg-indigo-50/40", 
        "focus:bg-white", 
        "focus:outline", 
        "focus:outline-2", 
        "focus:outline-indigo-400", 
        "focus:-outline-offset-2", 
        "transition-all", 
        "cursor-text"
      );
      // Suppress warning is not needed for dynamically set attributes
    });
  }, [internalHtml]); // Re-run when we reset internalHtml

  const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    // Don't trigger save if navigating between cells in the same table
    if (e.relatedTarget instanceof Node && containerRef.current.contains(e.relatedTarget)) return;

    const tableEl = containerRef.current.querySelector("table");
    if (!tableEl) return;

    // Clone to sanitize
    const clone = tableEl.cloneNode(true) as HTMLTableElement;
    clone.querySelectorAll("td, th").forEach(td => {
      td.removeAttribute("contenteditable");
      td.classList.remove(
        "hover:bg-indigo-50/40", 
        "focus:bg-white", 
        "focus:outline", 
        "focus:outline-2", 
        "focus:outline-indigo-400", 
        "focus:-outline-offset-2", 
        "transition-all", 
        "cursor-text"
      );
      // Fix potential <br> injections from contentEditable line breaks
      if (td.innerHTML.endsWith("<br>")) {
        td.innerHTML = td.innerHTML.slice(0, -4);
      }
    });

    const newOuterHtml = clone.outerHTML;
    
    // Only dispatch if really changed
    if (newOuterHtml !== html) {
      onChange(newOuterHtml);
    }
  };

  return (
    <div 
      ref={containerRef}
      onBlur={handleBlur}
      dangerouslySetInnerHTML={{ __html: internalHtml }}
      className="
        w-full relative
        [&>table]:w-full [&>table]:text-sm [&>table]:text-left [&>table]:m-0 [&>table]:border-collapse
        [&>table>thead]:bg-slate-50 [&>table>thead]:border-b [&>table>thead]:border-slate-200
        [&>table>thead>tr>th]:px-4 [&>table>thead>tr>th]:py-3 [&>table>thead>tr>th]:font-semibold [&>table>thead>tr>th]:text-slate-500 [&>table>thead>tr>th]:text-[12px] [&>table>thead>tr>th]:uppercase [&>table>thead>tr>th]:tracking-wider [&>table>thead>tr>th]:whitespace-nowrap [&>table>thead>tr>th]:border-r [&>table>thead>tr>th]:border-slate-200 [&>table>thead>tr>th:last-child]:border-r-0
        [&>table>tbody>tr]:border-b [&>table>tbody>tr]:border-slate-100 [&>table>tbody>tr]:transition-colors
        [&>table>tbody>tr:last-child]:border-b-0
        [&>table>tbody>tr>td]:px-4 [&>table>tbody>tr>td]:py-3 [&>table>tbody>tr>td]:text-slate-700 [&>table>tbody>tr>td]:align-middle [&>table>tbody>tr>td]:border-r [&>table>tbody>tr>td]:border-slate-100 [&>table>tbody>tr>td:last-child]:border-r-0
      "
    />
  );
}
