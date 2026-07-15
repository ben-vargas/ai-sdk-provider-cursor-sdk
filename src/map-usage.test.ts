import type { TokenUsage } from '@cursor/sdk';
import { CursorUsageAccumulator, mapCursorUsage } from './map-usage.js';

describe('mapCursorUsage', () => {
  it('maps cache and reasoning tokens into the V4 nested shape', () => {
    const usage: TokenUsage = {
      inputTokens: 10,
      outputTokens: 8,
      cacheReadTokens: 4,
      cacheWriteTokens: 2,
      reasoningTokens: 3,
      totalTokens: 24,
    };
    expect(mapCursorUsage(usage)).toEqual({
      inputTokens: { total: 16, noCache: 10, cacheRead: 4, cacheWrite: 2 },
      outputTokens: { total: 8, text: 5, reasoning: 3 },
      raw: usage,
    });
  });

  it('preserves explicit zero token counts when reasoning is unreported', () => {
    const usage: TokenUsage = {
      inputTokens: 1,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 1,
    };
    expect(mapCursorUsage(usage)).toEqual({
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: undefined, reasoning: undefined },
      raw: usage,
    });
  });

  it('returns undefined fields rather than fabricated zeros when usage is absent', () => {
    expect(mapCursorUsage()).toEqual({
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
      raw: undefined,
    });
  });
});

describe('CursorUsageAccumulator', () => {
  it('uses terminal cumulative usage as the authority', () => {
    const accumulator = new CursorUsageAccumulator();
    accumulator.add({
      inputTokens: 100,
      outputTokens: 100,
      cacheReadTokens: 100,
      cacheWriteTokens: 100,
    });
    const terminal: TokenUsage = {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      totalTokens: 10,
    };
    expect(accumulator.resolve(terminal)).toBe(terminal);
  });

  it('field-wise sums incremental turns and computes the Cursor total', () => {
    const accumulator = new CursorUsageAccumulator();
    accumulator.add({
      inputTokens: 2,
      outputTokens: 3,
      cacheReadTokens: 5,
      cacheWriteTokens: 7,
      reasoningTokens: 1,
    });
    accumulator.add({
      inputTokens: 11,
      outputTokens: 13,
      cacheReadTokens: 17,
      cacheWriteTokens: 19,
      reasoningTokens: 2,
    });
    expect(accumulator.resolve()).toEqual({
      inputTokens: 13,
      outputTokens: 16,
      cacheReadTokens: 22,
      cacheWriteTokens: 26,
      reasoningTokens: 3,
      totalTokens: 77,
    });
  });

  it('ignores incomplete checkpoints and returns undefined when none are complete', () => {
    const accumulator = new CursorUsageAccumulator();
    accumulator.add({ inputTokens: 1, outputTokens: 2 });
    expect(accumulator.resolve()).toBeUndefined();
  });

  it('counts a complete all-zero checkpoint', () => {
    const accumulator = new CursorUsageAccumulator();
    accumulator.add({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    });
    expect(accumulator.resolve()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    });
  });
});
