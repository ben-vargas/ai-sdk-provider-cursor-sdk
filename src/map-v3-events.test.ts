import type { LanguageModelV3StreamPart, SharedV3Warning } from '@ai-sdk/provider';
import { APICallError } from '@ai-sdk/provider';
import { CursorV3StreamEmitter } from './map-v3-events.js';
import {
  FakeRun,
  loadDeltaFixture,
  loadResultFixture,
} from './__tests__/fixtures/fake-cursor-sdk.js';

function harness(args: { raw?: boolean; preliminary?: boolean } = {}) {
  const parts: LanguageModelV3StreamPart[] = [];
  const errors: unknown[] = [];
  let closeCount = 0;
  const controller = {
    enqueue(part: LanguageModelV3StreamPart) {
      parts.push(part);
    },
    close() {
      closeCount += 1;
    },
    error(error: unknown) {
      errors.push(error);
    },
  } as ReadableStreamDefaultController<LanguageModelV3StreamPart>;
  return {
    emitter: new CursorV3StreamEmitter(controller, args.raw ?? false, args.preliminary ?? false),
    parts,
    errors,
    closeCount: () => closeCount,
  };
}

const context = {
  operation: 'run.wait',
  modelId: 'composer-2.5',
  agentId: 'agent-fixture',
  promptExcerpt: 'hello',
};

describe('CursorV3StreamEmitter', () => {
  it('emits stream start and response metadata without delaying early deltas', () => {
    const { emitter, parts } = harness();
    const warnings: SharedV3Warning[] = [];
    emitter.emitStart(warnings);
    emitter.emitUpdate({ type: 'text-delta', text: 'early' });
    const run = new FakeRun({
      agentId: 'agent-fixture',
      result: { id: 'run-1', status: 'finished', model: { id: 'resolved-model' } },
    });
    emitter.emitResponseMetadata(run, 'requested-model');
    expect(parts.map((part) => part.type)).toEqual([
      'stream-start',
      'text-start',
      'text-delta',
      'response-metadata',
    ]);
    expect(parts.at(-1)).toMatchObject({
      type: 'response-metadata',
      id: 'run-1',
      modelId: 'resolved-model',
      timestamp: expect.any(Date),
    });
  });

  it('uses the requested model ID when the run has no resolved model', () => {
    const { emitter, parts } = harness();
    emitter.emitResponseMetadata(
      new FakeRun({ agentId: 'agent-fixture', result: { id: 'run-fallback', status: 'finished' } }),
      'requested-model'
    );
    expect(parts).toEqual([
      expect.objectContaining({
        type: 'response-metadata',
        id: 'run-fallback',
        modelId: 'requested-model',
      }),
    ]);
  });

  it('pairs reasoning and text starts/deltas/ends and carries thinking duration', () => {
    const { emitter, parts } = harness();
    for (const { update } of loadDeltaFixture('text-and-thinking').events) {
      emitter.emitUpdate(update);
    }
    expect(parts).toEqual([
      { type: 'reasoning-start', id: 'rsn-1' },
      { type: 'reasoning-delta', id: 'rsn-1', delta: 'Think' },
      { type: 'reasoning-delta', id: 'rsn-1', delta: 'ing' },
      {
        type: 'reasoning-end',
        id: 'rsn-1',
        providerMetadata: { cursor: { thinkingDurationMs: 42 } },
      },
      { type: 'text-start', id: 'txt-1' },
      { type: 'text-delta', id: 'txt-1', delta: 'Answer' },
      { type: 'text-end', id: 'txt-1' },
      { type: 'reasoning-start', id: 'rsn-2' },
      { type: 'reasoning-delta', id: 'rsn-2', delta: 'Check' },
      { type: 'reasoning-end', id: 'rsn-2' },
      { type: 'text-start', id: 'txt-2' },
      { type: 'text-delta', id: 'txt-2', delta: ' done' },
    ]);
  });

  it('emits a complete provider-executed dynamic tool sequence in order', () => {
    const { emitter, parts } = harness();
    for (const { update } of loadDeltaFixture('tool-roundtrip').events) {
      emitter.emitUpdate(update);
    }
    expect(parts.map((part) => part.type)).toEqual([
      'text-start',
      'text-delta',
      'text-end',
      'tool-input-start',
      'tool-input-delta',
      'tool-input-end',
      'tool-call',
      'tool-result',
      'text-start',
      'text-delta',
    ]);
    expect(parts[3]).toMatchObject({
      type: 'tool-input-start',
      id: 'call-shell',
      toolName: 'shell',
      providerExecuted: true,
      dynamic: true,
      providerMetadata: { cursor: { modelCallId: 'model-call-shell' } },
    });
    expect(parts[6]).toEqual({
      type: 'tool-call',
      toolCallId: 'call-shell',
      toolName: 'shell',
      input: '{"command":"pwd"}',
      providerExecuted: true,
      dynamic: true,
      providerMetadata: { cursor: { modelCallId: 'model-call-shell' } },
    });
    expect(parts[7]).toEqual({
      type: 'tool-result',
      toolCallId: 'call-shell',
      toolName: 'shell',
      result: {
        status: 'success',
        value: {
          exitCode: 0,
          signal: '',
          stdout: '/repo\n',
          stderr: '',
          executionTime: 3,
        },
      },
      dynamic: true,
      providerMetadata: { cursor: { modelCallId: 'model-call-shell' } },
    });
    expect(parts[7]).not.toHaveProperty('preliminary');
    expect(parts[7]).not.toHaveProperty('isError');
  });

  it('never emits an experimental preliminary result before its tool call', () => {
    const { emitter, parts } = harness({ preliminary: true });
    for (const { update } of loadDeltaFixture('tool-preliminary').events) {
      emitter.emitUpdate(update);
    }
    const callIndex = parts.findIndex((part) => part.type === 'tool-call');
    const results = parts
      .map((part, index) => ({ part, index }))
      .filter(({ part }) => part.type === 'tool-result');
    expect(callIndex).toBeGreaterThan(-1);
    expect(results.every(({ index }) => index > callIndex)).toBe(true);
    expect(results).toHaveLength(3);
    expect(results[0]?.part).toMatchObject({ type: 'tool-result', preliminary: true });
    expect(results[0]?.part).toMatchObject({
      providerMetadata: { cursor: { modelCallId: 'model-call-prelim' } },
    });
    expect(results[1]?.part).toMatchObject({
      type: 'tool-result',
      preliminary: true,
      providerMetadata: { cursor: { modelCallId: 'model-call-prelim' } },
    });
    expect(results[2]?.part).toMatchObject({
      providerMetadata: { cursor: { modelCallId: 'model-call-prelim' } },
    });
    expect(results[2]?.part).not.toHaveProperty('preliminary');
    expect(parts.map((part) => part.type)).toEqual([
      'tool-input-start',
      'tool-input-delta',
      'tool-input-end',
      'tool-call',
      'tool-result',
      'tool-result',
      'tool-result',
    ]);
  });

  it.each([
    [undefined, { status: 'completed' }],
    [null, { value: null }],
  ] as const)('emits a non-null V3 tool result for payload %s', (result, expected) => {
    const { emitter, parts } = harness();
    emitter.emitUpdate({
      type: 'tool-call-completed',
      callId: 'call-result',
      modelCallId: 'model-call-result',
      toolCall: {
        type: 'read',
        args: { path: 'README.md' },
        ...(result !== undefined ? { result } : {}),
      },
    } as never);
    expect(parts.find((part) => part.type === 'tool-result')).toMatchObject({
      result: expected,
      providerMetadata: { cursor: { modelCallId: 'model-call-result' } },
    });
  });

  it('gates event raw parts on includeRawChunks and always surfaces late warnings', () => {
    const hidden = harness();
    const hiddenWarnings: SharedV3Warning[] = [];
    hidden.emitter.emitStart(hiddenWarnings);
    for (const { update } of loadDeltaFixture('unknown-safe-event').events) {
      hidden.emitter.emitUpdate(update);
    }
    expect(hidden.parts.filter((part) => part.type === 'raw')).toEqual([
      {
        type: 'raw',
        rawValue: expect.objectContaining({
          type: 'cursor-sdk-compatibility-warning',
          feature: 'unknown-event:future-progress',
        }),
      },
    ]);
    expect(hiddenWarnings).toEqual([
      expect.objectContaining({
        type: 'compatibility',
        feature: 'unknown-event:future-progress',
      }),
    ]);

    const visible = harness({ raw: true });
    visible.emitter.emitStart([]);
    for (const { update } of loadDeltaFixture('unknown-safe-event').events) {
      visible.emitter.emitUpdate(update);
    }
    expect(visible.parts.filter((part) => part.type === 'raw')).toEqual([
      { type: 'raw', rawValue: { type: 'future-progress', value: 1 } },
      {
        type: 'raw',
        rawValue: {
          type: 'cursor-sdk-compatibility-warning',
          feature: 'unknown-event:future-progress',
          message:
            "Unknown optional Cursor update 'future-progress' was preserved as redacted raw data.",
        },
      },
      { type: 'raw', rawValue: { type: 'future-progress', value: 2 } },
    ]);
  });

  it('uses terminal usage as authority and emits complete provider metadata', () => {
    const { emitter, parts } = harness();
    emitter.emitStart([]);
    emitter.emitUpdate({ type: 'text-delta', text: 'done' });
    emitter.emitTerminal(loadResultFixture('finished-with-usage'), 'agent-123', context);
    const finish = parts.find((part) => part.type === 'finish');
    expect(finish).toEqual({
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'finished' },
      usage: {
        inputTokens: { total: 21, noCache: 3, cacheRead: 7, cacheWrite: 11 },
        outputTokens: { total: 5, text: 3, reasoning: 2 },
        raw: {
          inputTokens: 3,
          outputTokens: 5,
          cacheReadTokens: 7,
          cacheWriteTokens: 11,
          reasoningTokens: 2,
          totalTokens: 26,
        },
      },
      providerMetadata: {
        cursor: {
          agentId: 'agent-123',
          runId: 'run-finished',
          requestId: 'request-finished',
          model: 'composer-2.5',
          modelParams: [{ id: 'fast', value: 'true' }],
          status: 'finished',
          durationMs: 12,
          result: 'done',
          usage: {
            inputTokens: 3,
            outputTokens: 5,
            cacheReadTokens: 7,
            cacheWriteTokens: 11,
            reasoningTokens: 2,
            totalTokens: 26,
          },
          git: {
            branches: [
              {
                repoUrl: 'https://example.test/repo',
                branch: 'cursor/run',
                prUrl: 'https://example.test/pr/1',
              },
            ],
          },
        },
      },
    });
  });

  it('falls back to accumulated turn usage when terminal usage is absent', () => {
    const { emitter, parts } = harness();
    for (const { update } of loadDeltaFixture('multi-turn-usage').events) {
      emitter.emitUpdate(update);
    }
    emitter.emitTerminal(loadResultFixture('finished-no-usage'), 'agent', context);
    expect(parts.find((part) => part.type === 'finish')).toMatchObject({
      usage: {
        inputTokens: { total: 48, noCache: 9, cacheRead: 17, cacheWrite: 22 },
        outputTokens: { total: 14, text: 13, reasoning: 1 },
      },
      providerMetadata: {
        cursor: {
          usage: {
            inputTokens: 9,
            outputTokens: 14,
            cacheReadTokens: 17,
            cacheWriteTokens: 22,
            reasoningTokens: 1,
            totalTokens: 62,
          },
        },
      },
    });
  });

  it('synthesizes terminal text only when no text delta was streamed', () => {
    const { emitter, parts } = harness();
    const warnings: SharedV3Warning[] = [];
    emitter.emitStart(warnings);
    emitter.emitTerminal(
      { id: 'run-fallback', status: 'finished', result: 'terminal text' },
      'agent',
      context
    );
    expect(parts.map((part) => part.type)).toEqual([
      'stream-start',
      'text-start',
      'text-delta',
      'text-end',
      'raw',
      'finish',
    ]);
    expect(warnings).toContainEqual(expect.objectContaining({ feature: 'text-delta-fallback' }));
  });

  it('synthesizes terminal text after an empty text delta', () => {
    const { emitter, parts } = harness();
    const warnings: SharedV3Warning[] = [];
    emitter.emitStart(warnings);
    emitter.emitUpdate({ type: 'text-delta', text: '' });
    emitter.emitTerminal(
      { id: 'run-empty-delta', status: 'finished', result: 'terminal text' },
      'agent',
      context
    );

    expect(parts.filter((part) => part.type === 'text-delta')).toEqual([
      { type: 'text-delta', id: 'txt-1', delta: '' },
      { type: 'text-delta', id: 'txt-2', delta: 'terminal text' },
    ]);
    expect(warnings).toContainEqual(expect.objectContaining({ feature: 'text-delta-fallback' }));
  });

  it('emits error then finish for an error RunResult', () => {
    const { emitter, parts } = harness();
    emitter.emitTerminal(loadResultFixture('error'), 'agent', context);
    expect(parts.map((part) => part.type)).toEqual(['error', 'finish']);
    const error = parts[0]?.type === 'error' ? parts[0].error : undefined;
    expect(APICallError.isInstance(error)).toBe(true);
    expect(error).toMatchObject({ isRetryable: true, data: { code: 'rate_limit' } });
    expect(parts[1]).toMatchObject({
      type: 'finish',
      finishReason: { unified: 'error', raw: 'rate_limit' },
    });
  });

  it('emits dangling-tool abort before error and finish for an error fixture', () => {
    const { emitter, parts } = harness();
    const fixture = loadDeltaFixture('run-error');
    for (const { update } of fixture.events) emitter.emitUpdate(update);
    emitter.emitTerminal(fixture.result, 'agent', context);
    expect(parts.map((part) => part.type)).toEqual([
      'tool-input-start',
      'tool-input-delta',
      'tool-input-end',
      'tool-call',
      'tool-result',
      'error',
      'finish',
    ]);
    expect(parts[4]).toMatchObject({
      type: 'tool-result',
      result: { status: 'aborted' },
      isError: true,
    });
  });

  it('emits at most one terminal finish part', () => {
    const { emitter, parts } = harness();
    const result = loadResultFixture('finished-with-usage');
    emitter.emitUpdate({ type: 'text-delta', text: 'done' });
    emitter.emitTerminal(result, 'agent', context);
    emitter.emitTerminal(result, 'agent', context);
    expect(parts.filter((part) => part.type === 'finish')).toHaveLength(1);
  });

  it('emits an aborted result for dangling tools before an external-cancel finish', () => {
    const { emitter, parts } = harness();
    for (const { update } of loadDeltaFixture('cancelled').events) emitter.emitUpdate(update);
    emitter.emitTerminal(loadResultFixture('cancelled'), 'agent', context);
    const callIndex = parts.findIndex((part) => part.type === 'tool-call');
    const resultIndex = parts.findIndex((part) => part.type === 'tool-result');
    expect(callIndex).toBeGreaterThan(-1);
    expect(resultIndex).toBeGreaterThan(callIndex);
    expect(parts[resultIndex]).toMatchObject({ result: { status: 'aborted' }, isError: true });
    expect(parts.at(-1)).toMatchObject({
      type: 'finish',
      finishReason: { unified: 'other', raw: 'cancelled' },
    });
  });

  it('closes and errors idempotently', () => {
    const closed = harness();
    closed.emitter.close();
    closed.emitter.close();
    closed.emitter.emitError(new Error('ignored'));
    expect(closed.closeCount()).toBe(1);
    expect(closed.parts).toEqual([]);

    const errored = harness();
    const reason = new Error('stream aborted');
    errored.emitter.error(reason);
    errored.emitter.error(reason);
    expect(errored.errors).toEqual([reason]);
  });
});
