import type { JSONObject, LanguageModelV4Usage } from '@ai-sdk/provider';
import type { TokenUsage } from '@cursor/sdk';
import type { NormalizedUsageInput } from './normalized-events.js';

type TurnUsageInput = Omit<TokenUsage, 'totalTokens'>;

function completeTurnUsage(usage: NormalizedUsageInput): TurnUsageInput | undefined {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = usage;
  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    cacheReadTokens === undefined ||
    cacheWriteTokens === undefined
  ) {
    return undefined;
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
  };
}

// @cursor/sdk declares these helpers internally but does not export them from
// its public package entrypoint (re-verified against the pinned version during
// canary triage; see docs/GAP_ANALYSIS.md). Keep the documented field-wise
// behavior here until the helpers become part of the published API.
function toTokenUsage(usage: TurnUsageInput | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    ...usage,
    totalTokens:
      usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
  };
}

function sumTokenUsage(usages: ReadonlyArray<TurnUsageInput>): TokenUsage | undefined {
  if (usages.length === 0) return undefined;
  const sum: TurnUsageInput = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  let reasoningTokens: number | undefined;
  for (const usage of usages) {
    sum.inputTokens += usage.inputTokens;
    sum.outputTokens += usage.outputTokens;
    sum.cacheReadTokens += usage.cacheReadTokens;
    sum.cacheWriteTokens += usage.cacheWriteTokens;
    if (usage.reasoningTokens !== undefined) {
      reasoningTokens = (reasoningTokens ?? 0) + usage.reasoningTokens;
    }
  }
  if (reasoningTokens !== undefined) sum.reasoningTokens = reasoningTokens;
  return toTokenUsage(sum);
}

export class CursorUsageAccumulator {
  private readonly turns: TurnUsageInput[] = [];

  add(usage: NormalizedUsageInput): void {
    const input = completeTurnUsage(usage);
    if (input) this.turns.push(input);
  }

  resolve(terminalUsage?: TokenUsage): TokenUsage | undefined {
    if (terminalUsage) return terminalUsage;
    return sumTokenUsage(this.turns);
  }
}

export function mapCursorUsage(usage?: TokenUsage): LanguageModelV4Usage {
  return {
    inputTokens: {
      total: usage ? usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens : undefined,
      noCache: usage?.inputTokens,
      cacheRead: usage?.cacheReadTokens,
      cacheWrite: usage?.cacheWriteTokens,
    },
    outputTokens: {
      total: usage?.outputTokens,
      text:
        usage?.reasoningTokens !== undefined
          ? usage.outputTokens - usage.reasoningTokens
          : undefined,
      reasoning: usage?.reasoningTokens,
    },
    raw: usage ? ({ ...usage } as JSONObject) : undefined,
  };
}
