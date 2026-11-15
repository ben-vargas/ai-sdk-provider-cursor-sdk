import type { TokenUsage } from '@cursor/sdk';
import { CursorUsageAccumulator, mapCursorUsage } from './map-usage.js';

describe('mapCursorUsage', () => {
  it('maps cache and reasoning tokens into the V4 nested shape', () => {
    // Cursor's inputTokens is the whole prompt: 10 uncached + 4 cache read + 2 cache write.
    const usage: TokenUsage = {
      inputTokens: 16,
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

  it('never reports negative uncached input when cache counts exceed the input total', () => {
    const usage: TokenUsage = {
      inputTokens: 5,
      outputTokens: 1,
      cacheReadTokens: 4,
      cacheWriteTokens: 3,
      totalTokens: 6,
    };
    expect(mapCursorUsage(usage).inputTokens).toEqual({
      total: 5,
      noCache: 0,
      cacheRead: 4,
      cacheWrite: 3,
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
      inputTokens: 8,
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
      inputTokens: 14,
      outputTokens: 3,
      cacheReadTokens: 5,
      cacheWriteTokens: 7,
      reasoningTokens: 1,
    });
    accumulator.add({
      inputTokens: 47,
      outputTokens: 13,
      cacheReadTokens: 17,
      cacheWriteTokens: 19,
      reasoningTokens: 2,
    });
    // inputTokens already includes the cache fields, so the total is input + output.
    expect(accumulator.resolve()).toEqual({
      inputTokens: 61,
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
