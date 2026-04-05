export type ToolCallKey = {
  name: string;
  runId?: string | null;
};

export type ToolCallDiagnostic = {
  name: string;
  runId?: string;
  startedAtMs: number;
  finishedAtMs?: number;
  durationMs?: number;
};

export type ToolChainDiagnostics = {
  submittedAtMs: number;
  streamStartedAtMs?: number;
  tools: ToolCallDiagnostic[];
};

export function createToolChainDiagnostics(submittedAtMs: number): ToolChainDiagnostics {
  return {
    submittedAtMs,
    tools: [],
  };
}

export function markStreamStarted(
  diagnostics: ToolChainDiagnostics,
  streamStartedAtMs: number,
): ToolChainDiagnostics {
  return {
    ...diagnostics,
    streamStartedAtMs,
  };
}

export function startToolCall(
  diagnostics: ToolChainDiagnostics,
  tool: ToolCallKey,
  startedAtMs: number,
): ToolChainDiagnostics {
  return {
    ...diagnostics,
    tools: [
      ...diagnostics.tools,
      {
        name: tool.name,
        runId: tool.runId ?? undefined,
        startedAtMs,
      },
    ],
  };
}

export function completeToolCall(
  diagnostics: ToolChainDiagnostics,
  tool: ToolCallKey,
  finishedAtMs: number,
): ToolChainDiagnostics {
  const nextTools = [...diagnostics.tools];

  for (let index = nextTools.length - 1; index >= 0; index -= 1) {
    const current = nextTools[index];
    if (!current || current.finishedAtMs != null) {
      continue;
    }

    const sameName = current.name === tool.name;
    const sameRun = tool.runId == null || current.runId === tool.runId;
    if (!sameName || !sameRun) {
      continue;
    }

    nextTools[index] = {
      ...current,
      finishedAtMs,
      durationMs: Math.max(0, finishedAtMs - current.startedAtMs),
    };
    break;
  }

  return {
    ...diagnostics,
    tools: nextTools,
  };
}

export function buildToolChainWarnings(
  diagnostics: ToolChainDiagnostics,
  nowMs: number,
): string[] {
  const warnings: string[] = [];

  if (
    diagnostics.streamStartedAtMs != null &&
    diagnostics.tools.length === 0 &&
    nowMs - diagnostics.streamStartedAtMs >= 15_000
  ) {
    warnings.push("工具阶段尚未开始，可能卡在模型推理或排队");
  }

  const repeatedNames = new Set<string>();
  for (const tool of diagnostics.tools) {
    const currentCount = diagnostics.tools.filter(
      (candidate) => candidate.name === tool.name,
    ).length;
    if (currentCount >= 3) {
      repeatedNames.add(tool.name);
    }
  }
  if (repeatedNames.size > 0) {
    warnings.push("同一工具被重复调用，可能存在重试或循环");
  }

  const activeTool = [...diagnostics.tools]
    .reverse()
    .find((tool) => tool.finishedAtMs == null);
  if (activeTool && nowMs - activeTool.startedAtMs >= 30_000) {
    warnings.push("工具执行时间过长，可能卡在外部服务或 IO");
  }

  return warnings;
}