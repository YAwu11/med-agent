"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { FileText, Columns2, AlignJustify, AlertTriangle, SearchCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Streamdown } from "streamdown";
import { streamdownPlugins } from "@/core/streamdown";

interface LabMarkdownViewerProps {
  rawText: string;
  title?: string;
  isAbnormal?: boolean;
  evidenceId?: string;
  caseId?: string | null;
  /** [ADR-035] OCR 原始数值指纹，用于与 LLM 清洗后数值交叉对账 */
  ocrRawNumbers?: string[];
}

/** 
 * 解析 Markdown 表格行为二维数组
 * 返回 { headers: string[], rows: string[][] }
 */
function parseMarkdownTable(md: string): { headers: string[]; rows: string[][]; beforeTable: string; afterTable: string } {
  const lines = md.split("\n");
  let tableStart = -1;
  let tableEnd = -1;
  const tableLines: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (tableStart === -1) tableStart = i;
      tableEnd = i;
      tableLines.push(trimmed);
      inTable = true;
    } else if (inTable) {
      // 表格结束了
      break;
    }
  }

  if (tableLines.length < 2) {
    return { headers: [], rows: [], beforeTable: md, afterTable: "" };
  }

  const parseLine = (line: string) =>
    line.slice(1, -1).split("|").map(cell => cell.trim());

  const headers = parseLine(tableLines[0] ?? "");
  const rows: string[][] = [];

  for (let i = 1; i < tableLines.length; i++) {
    const cells = parseLine(tableLines[i] ?? "");
    // 跳过分隔行 |---|---|
    if (cells.every(c => /^[\s\-:]+$/.test(c))) continue;
    rows.push(cells);
  }

  const beforeTable = lines.slice(0, tableStart).join("\n");
  const afterTable = lines.slice(tableEnd + 1).join("\n").trim();

  return { headers, rows, beforeTable, afterTable };
}

/**
 * 验证逻辑：检查异常标记是否与参考区间匹配
 * 返回需要警告的行索引及原因
 */
function validateLabResults(headers: string[], rows: string[][]): Map<number, string> {
  const warnings = new Map<number, string>();
  
  // 动态匹配 "结果" 和 "参考区间" 列的索引，兼容各家医院不同格式
  let resultCol = headers.findIndex(h => /结果|测定值|检测值|数值/i.test(h));
  let refCol = headers.findIndex(h => /参考|范围|区间|正常值/i.test(h));

  // 兜底方案，如果各种奇葩表头都没匹配上，降级到常规位置
  if (resultCol === -1) resultCol = 3;
  if (refCol === -1) refCol = 4;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length <= refCol) continue;

    const resultCell = row[resultCol] || "";
    const refCell = row[refCol] || "";

    // 提取箭头方向
    const hasUp = resultCell.includes("↑");
    const hasDown = resultCell.includes("↓");
    if (!hasUp && !hasDown) continue;

    // 提取数值
    const numMatch = resultCell.match(/([\d.]+)/);
    if (!numMatch?.[1]) continue;
    const value = parseFloat(numMatch[1]);
    if (isNaN(value)) continue;

    // 解析参考区间（支持 "3.5-9.5"、"<1"、">0.1" 格式）
    const rangeMatch = refCell.match(/([\d.]+)\s*[-~]\s*([\d.]+)/);
    const ltMatch = refCell.match(/[<＜]\s*([\d.]+)/);
    const gtMatch = refCell.match(/[>＞]\s*([\d.]+)/);

    if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
      const low = parseFloat(rangeMatch[1]);
      const high = parseFloat(rangeMatch[2]);
      
      if (hasDown && value >= low && value <= high) {
        // 标记为 ↓ 但值在正常范围内 → 可能 OCR 识别小数点有误
        warnings.set(i, `标记为 ↓ 但 ${value} 在参考区间 ${low}-${high} 内，请核实`);
      }
      if (hasUp && value >= low && value <= high) {
        warnings.set(i, `标记为 ↑ 但 ${value} 在参考区间 ${low}-${high} 内，请核实`);
      }
    } else if (ltMatch && ltMatch[1]) {
      const threshold = parseFloat(ltMatch[1]);
      if (hasUp && value < threshold) {
        warnings.set(i, `标记为 ↑ 但 ${value} < ${threshold}，请核实`);
      }
    } else if (gtMatch && gtMatch[1]) {
      const threshold = parseFloat(gtMatch[1]);
      if (hasDown && value > threshold) {
        warnings.set(i, `标记为 ↓ 但 ${value} > ${threshold}，请核实`);
      }
    }
  }

  return warnings;
}

/**
 * [ADR-035] OCR↔LLM 数值交叉验证
 * 比对表格中“结果”列的每个数值与 OCR 原始指纹，找出被 LLM 清洗管道篡改的数值
 */
function crossValidateNumbers(
  rows: string[][],
  resultColIdx: number,
  ocrRawNumbers: string[]
): Map<number, { ocrValue: string; llmValue: string }> {
  const mismatches = new Map<number, { ocrValue: string; llmValue: string }>();
  if (!ocrRawNumbers || ocrRawNumbers.length === 0) return mismatches;

  const ocrSet = new Set(ocrRawNumbers);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length <= resultColIdx) continue;

    const cell = row[resultColIdx] || "";
    // 提取数值（忽略箭头与空格）
    const numMatch = cell.replace(/[↑↓]/g, "").trim().match(/([\d.]+)/);
    if (!numMatch?.[1]) continue;
    const llmValue = numMatch[1];

    // 严格匹配：OCR 原始数据中必须存在完全相同的数字
    if (ocrSet.has(llmValue)) continue;

    // 模糊匹配：允许 ±0.01 误差（处理 "5.5" vs "5.50" 的情况）
    const llmFloat = parseFloat(llmValue);
    const fuzzyMatch = ocrRawNumbers.find(n => {
      const diff = Math.abs(parseFloat(n) - llmFloat);
      return diff < 0.011;
    });

    if (!fuzzyMatch) {
      // 在 OCR 原始数据中找不到任何近似值，标记为不匹配
      mismatches.set(i, { ocrValue: "未在OCR原始数据中找到匹配", llmValue });
    } else if (fuzzyMatch !== llmValue) {
      // 找到了近似值但不完全一致，显示 OCR 原始值
      mismatches.set(i, { ocrValue: fuzzyMatch, llmValue });
    }
  }
  return mismatches;
}

/**
 * 可编辑单元格组件：点击即可编辑，失焦自动保存
 */
function EditableCell({ 
  value, 
  isAbnormal, 
  warning,
  ocrMismatch,
  onChange 
}: { 
  value: string; 
  isAbnormal?: boolean; 
  warning?: string;
  ocrMismatch?: string;
  onChange: (newVal: string) => void;
}) {
  const ref = useRef<HTMLTableCellElement>(null);

  const handleBlur = useCallback(() => {
    if (ref.current) {
      const newText = ref.current.textContent || "";
      if (newText !== value) {
        onChange(newText);
      }
    }
  }, [value, onChange]);

  // 阻止回车换行，直接提交
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      ref.current?.blur();
    }
  }, []);

  return (
    <td
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={cn(
        "px-4 py-2.5 text-slate-700 align-middle outline-none cursor-text",
        "focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-blue-300 transition-all",
        isAbnormal && "text-red-700 font-bold",
        warning && "underline decoration-wavy decoration-amber-500",
        ocrMismatch && "underline decoration-wavy decoration-purple-500 bg-purple-50/40"
      )}
      title={ocrMismatch || warning}
    >
      {value}
    </td>
  );
}

// === 元数据块解析逻辑 ===
type BeforeLine = 
  | { type: "raw"; text: string }
  | { type: "field"; prefix: string; key: string; sep: string; value: string };

function parseBeforeTable(text: string): BeforeLine[] {
  return text.split("\n").map(line => {
    const m = line.match(/^(\s*[-*]?\s*)([^:：\n]{1,30})([:：])(.*)$/);
    if (m) {
      const value = m[4]?.trim() || "";
      if (value.length > 0) {
        return {
          type: "field",
          prefix: m[1] || "",
          key: m[2]?.trim() || "",
          sep: m[3] || "",
          value: value
        };
      }
    }
    return { type: "raw", text: line };
  });
}

function rebuildBeforeTable(lines: BeforeLine[]): string {
  return lines.map(l => l.type === "raw" ? l.text : `${l.prefix}${l.key}${l.sep} ${l.value}`).join("\n");
}


/**
 * 化验单 Markdown 渲染器 v2
 * 
 * - Markdown 头部（标题、患者信息）用 Streamdown 渲染
 * - 表格部分解析为交互式 HTML 表格：
 *   - 每个单元格点击即可编辑
 *   - 异常值（↑ ↓）单元格+整行强烈红色高亮
 *   - 自动验证：箭头与参考区间不一致时显示警告
 *   - 支持单列/双列布局切换
 */
export function LabMarkdownViewer({ rawText, title, isAbnormal, evidenceId, caseId, ocrRawNumbers }: LabMarkdownViewerProps) {
  const [dualColumn, setDualColumn] = useState(false);

  // 解析 Markdown 为 header + table
  const parsed = useMemo(() => parseMarkdownTable(rawText), [rawText]);

  // 可编辑的表格与元数据状态
  const parsedBeforeInitial = useMemo(() => parseBeforeTable(parsed.beforeTable), [parsed.beforeTable]);
  const [beforeLines, setBeforeLines] = useState<BeforeLine[]>(parsedBeforeInitial);
  const [tableRows, setTableRows] = useState<string[][]>(parsed.rows);
  
  // 当 rawText 变化时同步
  useEffect(() => {
    setTableRows(parsed.rows);
    setBeforeLines(parsedBeforeInitial);
  }, [parsed.rows, parsedBeforeInitial]);

  // 验证结果
  const warnings = useMemo(() => validateLabResults(parsed.headers, tableRows), [parsed.headers, tableRows]);

  // 动态寻找结果列的索引，以便给该列标底部红线波浪警告
  const resultColFallback = useMemo(() => {
    let col = parsed.headers.findIndex(h => /结果|测定值|检测值|数值/i.test(h));
    return col === -1 ? 3 : col;
  }, [parsed.headers]);

  // [ADR-035] OCR↔LLM 数值交叉验证
  const mismatches = useMemo(() => 
    crossValidateNumbers(tableRows, resultColFallback, ocrRawNumbers || []),
    [tableRows, resultColFallback, ocrRawNumbers]
  );

  // 动态将 beforeLines 分组为 "markdown" 和 "fields" 以供独立渲染
  const beforeBlocks = useMemo(() => {
    const blocks: { type: "markdown" | "fields", data: any }[] = [];
    let curRaw: string[] = [];
    let curFields: { originalIndex: number, line: BeforeLine & { type: "field" } }[] = [];

    const flushRaw = () => {
      if (curRaw.length > 0) {
        blocks.push({ type: "markdown", data: curRaw.join("\n") });
        curRaw = [];
      }
    };
    const flushFields = () => {
      if (curFields.length > 0) {
        blocks.push({ type: "fields", data: curFields });
        curFields = [];
      }
    };

    beforeLines.forEach((line, idx) => {
      if (line.type === "raw") {
        flushFields();
        curRaw.push(line.text);
      } else {
        flushRaw();
        curFields.push({ originalIndex: idx, line });
      }
    });
    flushFields();
    flushRaw();
    return blocks;
  }, [beforeLines]);

  // 编辑元数据字段
  const handleFieldChange = useCallback((idx: number, newVal: string) => {
    setBeforeLines(prev => {
      const updated = [...prev];
      const line = updated[idx];
      if (line && line.type === "field") {
        updated[idx] = { ...line, value: newVal };
      }
      
      if (caseId && evidenceId) {
        const newBeforeStr = rebuildBeforeTable(updated);
        const newMd = rebuildMarkdown(newBeforeStr, parsed.headers, tableRows, parsed.afterTable);
        fetch(`/api/cases/${caseId}/evidence/${evidenceId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ai_analysis: newMd }),
        }).catch(err => console.error("自动保存元数据失败:", err));
      }
      return updated;
    });
  }, [caseId, evidenceId, parsed.headers, tableRows, parsed.afterTable]);

  // 编辑某个单元格
  const handleCellChange = useCallback((rowIdx: number, colIdx: number, newVal: string) => {
    setTableRows(prev => {
      const updated = prev.map(r => [...r]);
      const row = updated[rowIdx];
      if (row) row[colIdx] = newVal;
      return updated;
    });

    // 异步保存到后端
    if (caseId && evidenceId) {
      const updatedRows = [...tableRows];
      const currentRow = updatedRows[rowIdx];
      if (currentRow) {
        updatedRows[rowIdx] = [...currentRow];
        updatedRows[rowIdx]![colIdx] = newVal;
      }
      
      // 重建 Markdown 并保存，注意使用当前最新的 beforeLines
      const newMd = rebuildMarkdown(rebuildBeforeTable(beforeLines), parsed.headers, updatedRows, parsed.afterTable);
      fetch(`/api/cases/${caseId}/evidence/${evidenceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai_analysis: newMd }),
      }).catch(err => console.error("自动保存失败:", err));
    }
  }, [caseId, evidenceId, tableRows, parsed]);

  // 渲染表格（支持拆分双列）
  const renderTable = useCallback((rows: string[][], startIdx: number) => (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="bg-slate-100 border-b-2 border-slate-200">
          {parsed.headers.map((h, i) => (
            <th key={i} className="px-4 py-3 text-left font-bold text-slate-600 text-xs uppercase tracking-wider whitespace-nowrap border-b border-slate-200">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => {
          const actualIdx = startIdx + ri;
          const rowText = row.join("");
          const rowIsAbnormal = rowText.includes("↑") || rowText.includes("↓");
          const rowWarning = warnings.get(actualIdx);
          const rowMismatch = mismatches.get(actualIdx);
          
          return (
            <tr
              key={actualIdx}
              className={cn(
                "border-b border-slate-100 transition-colors group",
                rowIsAbnormal && "bg-red-50 border-l-[3px] border-l-red-500",
                rowWarning && "bg-amber-50/60 border-l-[3px] border-l-amber-500",
                rowMismatch && !rowIsAbnormal && !rowWarning && "bg-purple-50/40 border-l-[3px] border-l-purple-400",
                !rowIsAbnormal && !rowWarning && !rowMismatch && "hover:bg-blue-50/30"
              )}
            >
              {row.map((cell, ci) => {
                const cellIsAbnormal = cell.includes("↑") || cell.includes("↓");
                // [ADR-035] 只在「结果」列显示交叉验证的 mismatch 提示
                const cellMismatch = (ci === resultColFallback || ci === 3) && rowMismatch
                  ? `⚠️ OCR原始值: ${rowMismatch.ocrValue}，LLM清洗后: ${rowMismatch.llmValue}`
                  : undefined;
                return (
                  <EditableCell
                    key={ci}
                    value={cell}
                    isAbnormal={cellIsAbnormal}
                    warning={((ci === resultColFallback) || (ci === 3)) && rowWarning ? rowWarning : undefined}
                    ocrMismatch={cellMismatch}
                    onChange={(newVal) => handleCellChange(actualIdx, ci, newVal)}
                  />
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  ), [parsed.headers, warnings, mismatches, handleCellChange]);

  // 双列拆分
  const midPoint = Math.ceil(tableRows.length / 2);
  const leftRows = tableRows.slice(0, midPoint);
  const rightRows = tableRows.slice(midPoint);

  return (
    <div className="h-full w-full flex flex-col">
      {/* Header */}
      <div className="px-8 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center border border-indigo-100/50">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800 tracking-tight">{title || "识别报告"}</h3>
            <p className="text-xs text-slate-500 font-medium tracking-wide">点击单元格可直接编辑 · 异常值自动高亮</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 验证警告统计 */}
          {warnings.size > 0 && (
            <span className="flex items-center gap-1 bg-amber-50 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-full border border-amber-200">
              <AlertTriangle className="h-3.5 w-3.5" />
              {warnings.size} 项待核实
            </span>
          )}

          {/* [ADR-035] OCR↔LLM 数值对账异常统计 */}
          {mismatches.size > 0 && (
            <span className="flex items-center gap-1 bg-purple-50 text-purple-700 text-xs font-bold px-2.5 py-1 rounded-full border border-purple-200">
              <SearchCheck className="h-3.5 w-3.5" />
              {mismatches.size} 项数值待核对
            </span>
          )}

          {/* 布局切换 */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDualColumn(prev => !prev)}
            className="h-8 px-2 text-slate-500 hover:text-slate-700"
            title={dualColumn ? "切换为单列" : "切换为双列"}
          >
            {dualColumn ? <AlignJustify className="h-4 w-4" /> : <Columns2 className="h-4 w-4" />}
            <span className="ml-1 text-xs">{dualColumn ? "单列" : "双列"}</span>
          </Button>

          {/* 异常状态标签 */}
          {isAbnormal ? (
            <span className="bg-red-100 text-red-700 text-xs font-bold px-2.5 py-1 rounded-full border border-red-200">存在异常项</span>
          ) : (
            <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full border border-emerald-200">未见明显异常</span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        {beforeBlocks.length > 0 && (
          <div className={cn(
            "mx-auto bg-white p-8 rounded-t-2xl border border-b-0 border-slate-200 shadow-sm",
            dualColumn ? "max-w-[1400px]" : "max-w-[1000px]"
          )}>
            {beforeBlocks.map((block, bIdx) => {
              if (block.type === "markdown") {
                const mdText = block.data as string;
                if (!mdText.trim()) return null;
                return (
                  <div key={bIdx} className={cn(
                    "prose prose-slate prose-sm max-w-none my-4",
                    "[&_h1]:text-2xl [&_h1]:font-extrabold [&_h1]:text-slate-800 [&_h1]:mb-6 [&_h1]:border-b [&_h1]:border-slate-100 [&_h1]:pb-3",
                    "[&>ul]:list-none [&>ul]:pl-0 [&>ul>li]:font-bold [&>ul>li]:text-slate-800 [&>ul>li]:text-sm [&>ul>li]:mb-4 [&>ul>li]:pb-2 [&>ul>li]:border-b [&>ul>li]:border-slate-100",
                    "[&>p]:text-sm [&>p]:text-slate-600"
                  )}>
                    <Streamdown {...streamdownPlugins}>{mdText}</Streamdown>
                  </div>
                );
              } else {
                const fields = block.data as { originalIndex: number, line: BeforeLine & { type: "field" } }[];
                return (
                  <div key={bIdx} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4 mb-6">
                    {fields.map(f => (
                      <div key={f.originalIndex} className="flex flex-col space-y-1.5 focus-within:ring-0">
                        <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider pl-1">
                          {f.line.key}
                        </label>
                        <input
                          type="text"
                          value={f.line.value}
                          onChange={(e) => handleFieldChange(f.originalIndex, e.target.value)}
                          className={cn(
                            "h-10 px-3 text-sm font-medium text-slate-800 bg-slate-50/70",
                            "border border-slate-200 rounded-lg shadow-sm transition-all focus:outline-none",
                            "hover:bg-white hover:border-slate-300 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                          )}
                        />
                      </div>
                    ))}
                  </div>
                );
              }
            })}
          </div>
        )}

        {/* 交互式数据表格 */}
        {parsed.headers.length > 0 && (
          <div className={cn(
            "mx-auto bg-white rounded-b-2xl border border-slate-200 shadow-sm overflow-hidden",
            dualColumn ? "max-w-[1400px]" : "max-w-[1000px]"
          )}>
            {dualColumn ? (
              <div className="grid grid-cols-2 divide-x divide-slate-200">
                <div className="overflow-auto">{renderTable(leftRows, 0)}</div>
                <div className="overflow-auto">{renderTable(rightRows, midPoint)}</div>
              </div>
            ) : (
              <div className="overflow-auto">{renderTable(tableRows, 0)}</div>
            )}
          </div>
        )}

        {/* 表格后的附加内容 */}
        {parsed.afterTable.trim() && (
          <div className={cn(
            "mx-auto mt-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm",
            "prose prose-slate prose-sm max-w-none",
            "[&_blockquote]:bg-amber-50 [&_blockquote]:border-l-4 [&_blockquote]:border-amber-400 [&_blockquote]:p-3 [&_blockquote]:rounded-r-lg [&_blockquote]:text-sm [&_blockquote]:text-amber-800",
            dualColumn ? "max-w-[1400px]" : "max-w-[1000px]"
          )}>
            <Streamdown {...streamdownPlugins}>
              {parsed.afterTable}
            </Streamdown>
          </div>
        )}
      </div>
    </div>
  );
}

/** 将编辑后的表格数据重新拼装回 Markdown 字符串 */
function rebuildMarkdown(beforeTable: string, headers: string[], rows: string[][], afterTable: string): string {
  const headerLine = "| " + headers.join(" | ") + " |";
  const sepLine = "| " + headers.map(() => "---").join(" | ") + " |";
  const dataLines = rows.map(row => "| " + row.join(" | ") + " |");
  
  const parts = [beforeTable.trim(), "", headerLine, sepLine, ...dataLines];
  if (afterTable.trim()) {
    parts.push("", afterTable.trim());
  }
  return parts.join("\n");
}
