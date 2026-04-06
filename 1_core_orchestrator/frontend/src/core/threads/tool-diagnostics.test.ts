import { describe, expect, it } from "vitest";

import {
  buildToolChainWarnings,
  completeToolCall,
  createToolChainDiagnostics,
  markStreamStarted,
  startToolCall,
} from "./tool-diagnostics";

describe("tool diagnostics", () => {
  it("flags when the first tool has still not started long after stream start", () => {
    const diagnostics = markStreamStarted(createToolChainDiagnostics(1_000), 2_000);

    expect(buildToolChainWarnings(diagnostics, 18_500)).toContain("工具阶段尚未开始，可能卡在模型推理或排队");
  });

  it("tracks tool durations and flags repeated tool retries", () => {
    let diagnostics = createToolChainDiagnostics(1_000);
    diagnostics = markStreamStarted(diagnostics, 1_200);
    diagnostics = startToolCall(diagnostics, { name: "read_file", runId: "run-1" }, 2_000);
    diagnostics = completeToolCall(diagnostics, { name: "read_file", runId: "run-1" }, 4_400);
    diagnostics = startToolCall(diagnostics, { name: "read_file", runId: "run-2" }, 5_000);
    diagnostics = completeToolCall(diagnostics, { name: "read_file", runId: "run-2" }, 7_000);
    diagnostics = startToolCall(diagnostics, { name: "read_file", runId: "run-3" }, 8_000);

    expect(diagnostics.tools[0]?.durationMs).toBe(2_400);
    expect(buildToolChainWarnings(diagnostics, 9_000)).toContain("同一工具被重复调用，可能存在重试或循环");
  });
});