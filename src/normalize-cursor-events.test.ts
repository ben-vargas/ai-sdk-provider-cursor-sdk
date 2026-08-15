import type { InteractionUpdate, ToolCallDeltaUpdate } from '@cursor/sdk';
import { ToolCallDeltaUpdateSchema } from '@cursor/sdk';
import { CursorStreamConsistencyError } from './errors.js';
import { normalizeCursorUpdate } from './normalize-cursor-events.js';
import { CursorEventNormalizer } from './normalized-events.js';
import { loadDeltaFixture } from './__tests__/fixtures/fake-cursor-sdk.js';

/**
 * Statically and at runtime pins a `tool-call-delta` fixture to the published `@cursor/sdk` shape,
 * so these cases keep proving compatibility with live events rather than with invented ones.
 */
function liveToolCallDelta(update: ToolCallDeltaUpdate): ToolCallDeltaUpdate {
  expect(ToolCallDeltaUpdateSchema.safeParse(update).error).toBeUndefined();
  return update;
}

function normalizeFixture(name: string, preliminary = false) {
  const normalizer = new CursorEventNormalizer(preliminary);
  return loadDeltaFixture(name).events.map(({ update }) =>
    normalizeCursorUpdate(normalizer, update)
  );
}

describe('normalizeCursorUpdate', () => {
  it('emits lazy starts, deltas, auto-closes, and thinking duration metadata', () => {
    const events = normalizeFixture('text-and-thinking').flat();
    expect(events.filter((event) => event.kind !== 'raw')).toEqual([
      { kind: 'reasoning-start', id: 'rsn-1' },
      { kind: 'reasoning-delta', id: 'rsn-1', delta: 'Think' },
      { kind: 'reasoning-delta', id: 'rsn-1', delta: 'ing' },
      { kind: 'reasoning-end', id: 'rsn-1', metadata: { thinkingDurationMs: 42 } },
      { kind: 'text-start', id: 'txt-1' },
      { kind: 'text-delta', id: 'txt-1', delta: 'Answer' },
      { kind: 'text-end', id: 'txt-1' },
      { kind: 'reasoning-start', id: 'rsn-2' },
      { kind: 'reasoning-delta', id: 'rsn-2', delta: 'Check' },
      { kind: 'reasoning-end', id: 'rsn-2', metadata: undefined },
      { kind: 'text-start', id: 'txt-2' },
      { kind: 'text-delta', id: 'txt-2', delta: ' done' },
    ]);
  });

  it('accepts an empty text delta because the published Cursor type permits any string', () => {
    const events = normalizeCursorUpdate(new CursorEventNormalizer(false), {
      type: 'text-delta',
      text: '',
    });
    expect(events).toEqual([
      { kind: 'raw', value: { type: 'text-delta', text: '' }, conditional: true },
      { kind: 'text-start', id: 'txt-1' },
      { kind: 'text-delta', id: 'txt-1', delta: '' },
    ]);
  });

  it('maps the default tool lifecycle and defers call input until completion', () => {
    const [text, started, completed, after] = normalizeFixture('tool-roundtrip');
    expect(text?.map((event) => event.kind)).toEqual(['raw', 'text-start', 'text-delta']);
    expect(started?.filter((event) => event.kind !== 'raw')).toEqual([
      { kind: 'text-end', id: 'txt-1' },
      {
        kind: 'tool-input-start',
        toolCallId: 'call-shell',
        toolName: 'shell',
        metadata: { modelCallId: 'model-call-shell' },
      },
    ]);
    expect(completed?.filter((event) => event.kind !== 'raw')).toEqual([
      {
        kind: 'tool-call',
        toolCallId: 'call-shell',
        toolName: 'shell',
        input: { command: 'pwd' },
        metadata: { modelCallId: 'model-call-shell' },
      },
      {
        kind: 'tool-result',
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
        preliminary: false,
        isError: false,
        metadata: { modelCallId: 'model-call-shell' },
      },
    ]);
    expect(after?.map((event) => event.kind)).toEqual(['raw', 'text-start', 'text-delta']);
  });

  it('emits the call before all preliminary and final results when the flag is enabled', () => {
    const events = normalizeFixture('tool-preliminary', true)
      .flat()
      .filter((event) => event.kind !== 'raw');
    const kinds = events.map((event) => event.kind);
    expect(kinds).toEqual([
      'tool-input-start',
      'tool-call',
      'tool-result',
      'tool-result',
      'tool-result',
    ]);
    const callIndex = kinds.indexOf('tool-call');
    expect(kinds.every((kind, index) => kind !== 'tool-result' || index > callIndex)).toBe(true);
    expect(events.filter((event) => event.kind === 'tool-result')).toEqual([
      expect.objectContaining({
        preliminary: true,
        result: expect.objectContaining({ type: 'shell' }),
        metadata: { modelCallId: 'model-call-prelim' },
      }),
      expect.objectContaining({
        preliminary: true,
        result: { stdout: 'hi' },
        metadata: { modelCallId: 'model-call-prelim' },
      }),
      expect.objectContaining({
        preliminary: false,
        metadata: { modelCallId: 'model-call-prelim' },
      }),
    ]);
  });

  it('uses the shell-output fixture for default raw-only and experimental correlation paths', () => {
    const defaultEvents = normalizeFixture('shell-output', false);
    expect(defaultEvents[1]).toEqual([expect.objectContaining({ kind: 'raw', conditional: true })]);

    const experimentalEvents = normalizeFixture('shell-output', true);
    expect(experimentalEvents[1]).toEqual([
      expect.objectContaining({ kind: 'raw', conditional: true }),
      expect.objectContaining({
        kind: 'tool-result',
        toolCallId: 'call-output',
        preliminary: true,
        result: { stdout: 'hi\n' },
        metadata: { modelCallId: 'model-call-output' },
      }),
    ]);
  });

  it('synthesizes a missing tool start and warns once', () => {
    const events = normalizeFixture('tool-missing-start').flat();
    const semantic = events.filter((event) => event.kind !== 'raw');
    expect(semantic).toEqual([
      expect.objectContaining({ kind: 'tool-input-start', toolCallId: 'call-missing' }),
      expect.objectContaining({ kind: 'compatibility-warning', feature: 'tool-events' }),
      {
        kind: 'tool-call',
        toolCallId: 'call-missing',
        toolName: 'shell',
        input: { command: 'true' },
        metadata: { modelCallId: 'model-call-missing' },
      },
      expect.objectContaining({ kind: 'tool-result', toolCallId: 'call-missing' }),
    ]);

    const normalizer = new CursorEventNormalizer(false);
    const complete = (callId: string) =>
      normalizeCursorUpdate(normalizer, {
        type: 'tool-call-completed',
        callId,
        modelCallId: `model-${callId}`,
        toolCall: { type: 'read', args: { path: callId } },
      });
    const warnings = [...complete('first'), ...complete('second')].filter(
      (event) => event.kind === 'compatibility-warning' && event.feature === 'tool-events'
    );
    expect(warnings).toHaveLength(1);
  });

  it.each([
    [undefined, { status: 'completed' }],
    [null, null],
  ] as const)('normalizes a completed tool result payload %s', (result, expected) => {
    const events = normalizeCursorUpdate(new CursorEventNormalizer(false), {
      type: 'tool-call-completed',
      callId: 'call-result',
      modelCallId: 'model-call-result',
      toolCall: {
        type: 'read',
        args: { path: 'README.md' },
        ...(result !== undefined ? { result } : {}),
      },
    });
    expect(events.find((event) => event.kind === 'tool-result')).toMatchObject({
      result: expected,
      metadata: { modelCallId: 'model-call-result' },
    });
  });

  it('marks tool errors and redacts sensitive input and result values', () => {
    const serialized = JSON.stringify(normalizeFixture('tool-error'));
    expect(serialized).not.toContain('CURSOR_API_KEY=secret');
    expect(serialized).not.toContain('"apiKey":"secret"');
    expect(serialized).toContain('[REDACTED]');
    const result = normalizeFixture('tool-error')
      .flat()
      .find((event) => event.kind === 'tool-result');
    expect(result).toMatchObject({ kind: 'tool-result', isError: true, preliminary: false });
  });

  it.each([
    [{ error: { message: 'boom' } }, true],
    [{ error: '' }, false],
  ] as const)('uses the fallback error-key heuristic for result %j', (result, isError) => {
    const events = normalizeCursorUpdate(new CursorEventNormalizer(false), {
      type: 'tool-call-completed',
      callId: 'call-error-shape',
      modelCallId: 'model-call-error-shape',
      toolCall: { type: 'read', args: {}, result },
    });
    expect(events.find((event) => event.kind === 'tool-result')).toMatchObject({ isError });
  });

  it('maps turn usage and closes any active content block', () => {
    const normalizer = new CursorEventNormalizer(false);
    normalizeCursorUpdate(normalizer, { type: 'text-delta', text: 'hello' });
    expect(
      normalizeCursorUpdate(normalizer, {
        type: 'turn-ended',
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheWriteTokens: 4,
          reasoningTokens: 1,
        },
      }).filter((event) => event.kind !== 'raw')
    ).toEqual([
      { kind: 'text-end', id: 'txt-1' },
      {
        kind: 'turn-usage',
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheWriteTokens: 4,
          reasoningTokens: 1,
          raw: {
            inputTokens: 1,
            outputTokens: 2,
            cacheReadTokens: 3,
            cacheWriteTokens: 4,
            reasoningTokens: 1,
          },
        },
      },
    ]);
  });

  it('closes active text on turn-ended without fabricating usage', () => {
    const normalizer = new CursorEventNormalizer(false);
    normalizeCursorUpdate(normalizer, { type: 'text-delta', text: 'hello' });
    expect(
      normalizeCursorUpdate(normalizer, { type: 'turn-ended' }).filter(
        (event) => event.kind !== 'raw'
      )
    ).toEqual([{ kind: 'text-end', id: 'txt-1' }]);
  });

  it('keeps every documented non-semantic event as raw-only', () => {
    for (const events of normalizeFixture('summary-events')) {
      expect(events).toEqual([expect.objectContaining({ kind: 'raw', conditional: true })]);
    }
  });

  it('recurses tool-call-delta taskUpdate so nested subagent text and tools are visible', () => {
    const normalizer = new CursorEventNormalizer(false);
    const textEvents = normalizeCursorUpdate(
      normalizer,
      liveToolCallDelta({
        type: 'tool-call-delta',
        callId: 'call-task',
        modelCallId: 'model-call-task',
        taskUpdate: { type: 'text-delta', text: 'subagent' },
      })
    );
    expect(textEvents.filter((event) => event.kind !== 'raw')).toEqual([
      { kind: 'text-start', id: 'txt-1' },
      { kind: 'text-delta', id: 'txt-1', delta: 'subagent' },
    ]);

    const started = normalizeCursorUpdate(
      normalizer,
      liveToolCallDelta({
        type: 'tool-call-delta',
        callId: 'call-task',
        modelCallId: 'model-call-task',
        taskUpdate: {
          type: 'tool-call-started',
          callId: 'call-nested-read',
          modelCallId: 'model-call-nested-read',
          toolCall: { type: 'read', args: { path: 'README.md' } },
        },
      })
    );
    expect(started.filter((event) => event.kind !== 'raw')).toEqual([
      { kind: 'text-end', id: 'txt-1' },
      {
        kind: 'tool-input-start',
        toolCallId: 'call-nested-read',
        toolName: 'read',
        metadata: { modelCallId: 'model-call-nested-read' },
      },
    ]);

    const completed = normalizeCursorUpdate(
      normalizer,
      liveToolCallDelta({
        type: 'tool-call-delta',
        callId: 'call-task',
        modelCallId: 'model-call-task',
        taskUpdate: {
          type: 'tool-call-completed',
          callId: 'call-nested-read',
          modelCallId: 'model-call-nested-read',
          toolCall: {
            type: 'read',
            args: { path: 'README.md' },
            result: { status: 'success', value: { content: 'ok', totalLines: 1, fileSize: 2 } },
          },
        },
      })
    );
    expect(completed.filter((event) => event.kind !== 'raw')).toEqual([
      {
        kind: 'tool-call',
        toolCallId: 'call-nested-read',
        toolName: 'read',
        input: { path: 'README.md' },
        metadata: { modelCallId: 'model-call-nested-read' },
      },
      {
        kind: 'tool-result',
        toolCallId: 'call-nested-read',
        toolName: 'read',
        result: { status: 'success', value: { content: 'ok', totalLines: 1, fileSize: 2 } },
        preliminary: false,
        isError: false,
        metadata: { modelCallId: 'model-call-nested-read' },
      },
    ]);
  });

  // Defensive: `modelCallId` is required by ToolCallDeltaUpdateSchema, so this shape is not a live
  // 1.0.28 event. The fallback exists so an SDK that relaxes the field cannot lose tool identity.
  it('inherits the parent modelCallId when a nested tool update omits it', () => {
    const update = {
      type: 'tool-call-delta',
      callId: 'call-task',
      modelCallId: 'model-call-task',
      taskUpdate: {
        type: 'tool-call-started',
        callId: 'call-nested-shell',
        toolCall: { type: 'shell', args: { command: 'pwd' } },
      },
    };
    expect(ToolCallDeltaUpdateSchema.safeParse(update).success).toBe(false);
    const events = normalizeCursorUpdate(new CursorEventNormalizer(false), update);
    expect(events.find((event) => event.kind === 'tool-input-start')).toMatchObject({
      toolCallId: 'call-nested-shell',
      metadata: { modelCallId: 'model-call-task' },
    });
  });

  it('fails closed on a tool-call-delta without a taskUpdate object', () => {
    expect(() =>
      normalizeCursorUpdate(new CursorEventNormalizer(false), {
        type: 'tool-call-delta',
        callId: 'call-task',
        modelCallId: 'model-call-task',
      })
    ).toThrow(/taskUpdate.*object/);
  });

  // Defensive: NestedTaskUpdate has no 'tool-call-delta' member, so the SDK cannot emit this today.
  // The recursion still has to terminate rather than throw if deeper nesting is ever published.
  it('does not throw on tool-call-delta and drops deeper nested tool-call-delta', () => {
    const update = {
      type: 'tool-call-delta',
      callId: 'call-task',
      modelCallId: 'model-call-task',
      taskUpdate: {
        type: 'tool-call-delta',
        callId: 'call-deeper',
        modelCallId: 'model-call-deeper',
        taskUpdate: { type: 'text-delta', text: 'dropped' },
      },
    };
    expect(ToolCallDeltaUpdateSchema.safeParse(update).success).toBe(false);
    const events = normalizeCursorUpdate(new CursorEventNormalizer(false), update);
    expect(events.filter((event) => event.kind !== 'raw')).toEqual([]);
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'raw', conditional: true })])
    );
  });

  it('preserves harmless unknowns as raw and deduplicates warnings by type', () => {
    const [first, second] = normalizeFixture('unknown-safe-event');
    expect(first).toEqual([
      expect.objectContaining({ kind: 'raw' }),
      expect.objectContaining({
        kind: 'compatibility-warning',
        feature: 'unknown-event:future-progress',
      }),
    ]);
    expect(second).toEqual([expect.objectContaining({ kind: 'raw' })]);
  });

  it.each([
    'future-tool-state',
    'future-call-state',
    'future-complete-state',
    'future-finish-state',
    'future-permission-state',
    'future-usage-state',
    'future-result-state',
  ])('fails closed on unknown completion-sensitive event name %s', (type) => {
    expect(() => normalizeCursorUpdate(new CursorEventNormalizer(false), { type })).toThrow(
      CursorStreamConsistencyError
    );
  });

  it('preserves a harmless near-miss unknown event', () => {
    expect(
      normalizeCursorUpdate(new CursorEventNormalizer(false), { type: 'future-progress' })
    ).toEqual([
      expect.objectContaining({ kind: 'raw' }),
      expect.objectContaining({ kind: 'compatibility-warning' }),
    ]);
  });

  it('fails closed on malformed non-object updates and required tool identifiers', () => {
    expect(() => normalizeCursorUpdate(new CursorEventNormalizer(false), null)).toThrow(
      /non-object/
    );
    expect(() =>
      normalizeCursorUpdate(new CursorEventNormalizer(false), {
        type: 'tool-call-started',
        callId: '',
        modelCallId: 'model-call',
        toolCall: { type: 'shell', args: { command: 'pwd' } },
      } as InteractionUpdate)
    ).toThrow(/callId.*non-empty/);
  });

  it('fails closed on malformed required and optional usage counters', () => {
    expect(() =>
      normalizeCursorUpdate(new CursorEventNormalizer(false), {
        type: 'turn-ended',
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
        },
      })
    ).toThrow(/cacheWriteTokens.*finite number/);

    expect(() =>
      normalizeCursorUpdate(new CursorEventNormalizer(false), {
        type: 'turn-ended',
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheWriteTokens: 4,
          reasoningTokens: '5',
        },
      })
    ).toThrow(/reasoningTokens.*finite number/);
  });
});

describe('CursorEventNormalizer terminal invariants', () => {
  it('closes the active block at finish', () => {
    const normalizer = new CursorEventNormalizer(false);
    normalizer.emitDelta('text', 'hello');
    expect(normalizer.finish('finished')).toEqual([{ kind: 'text-end', id: 'txt-1' }]);
  });

  it('rejects a successful finish with a dangling tool', () => {
    const normalizer = new CursorEventNormalizer(false);
    normalizer.startTool({
      callId: 'call-1',
      toolName: 'shell',
      input: { command: 'sleep 1' },
      modelCallId: 'model-call-1',
    });
    expect(() => normalizer.finish('finished')).toThrow(/before tool call 'call-1'/);
  });

  it('rejects duplicate starts for the same unfinished tool call', () => {
    const normalizer = new CursorEventNormalizer(false);
    const tool = {
      callId: 'call-duplicate',
      toolName: 'shell',
      input: { command: 'pwd' },
      modelCallId: 'model-call-duplicate',
    };
    normalizer.startTool(tool);
    expect(() => normalizer.startTool(tool)).toThrow(/started more than once/);
  });

  it('drops uncorrelated and late partial tool snapshots with one warning', () => {
    const normalizer = new CursorEventNormalizer(true);
    expect(
      normalizer.partialTool({
        callId: 'unknown',
        snapshot: { type: 'shell' },
        modelCallId: 'model-unknown',
      })
    ).toEqual([
      expect.objectContaining({ kind: 'compatibility-warning', feature: 'partial-tool-events' }),
    ]);
    normalizer.startTool({
      callId: 'complete',
      toolName: 'shell',
      input: { command: 'pwd' },
      modelCallId: 'model-complete',
    });
    normalizer.completeTool({
      callId: 'complete',
      toolName: 'shell',
      input: { command: 'pwd' },
      result: { status: 'success' },
      isError: false,
      modelCallId: 'model-complete',
    });
    expect(
      normalizer.partialTool({
        callId: 'complete',
        snapshot: { type: 'shell' },
        modelCallId: 'model-complete',
      })
    ).toEqual([]);
  });

  it('emits only one final result for duplicate completion', () => {
    const normalizer = new CursorEventNormalizer(false);
    const completion = {
      callId: 'call-complete',
      toolName: 'read',
      input: { path: 'README.md' },
      result: { status: 'success' },
      isError: false,
      modelCallId: 'model-call-complete',
    };
    const events = [...normalizer.completeTool(completion), ...normalizer.completeTool(completion)];
    expect(events.filter((event) => event.kind === 'tool-result')).toHaveLength(1);
  });

  it('keeps shell output raw-only when zero or two shell tools are open', () => {
    const normalizer = new CursorEventNormalizer(true);
    expect(normalizer.shellOutput({ stdout: 'orphan' })).toEqual([]);
    for (const id of ['one', 'two']) {
      normalizer.startTool({
        callId: id,
        toolName: 'shell',
        input: { command: id },
        modelCallId: `model-${id}`,
      });
    }
    expect(normalizer.shellOutput({ stdout: 'ambiguous' })).toEqual([]);
  });

  it.each(['cancelled', 'error'] as const)(
    'synthesizes call-before-aborted-result for a dangling tool on %s',
    (status) => {
      const normalizer = new CursorEventNormalizer(false);
      normalizer.startTool({
        callId: 'call-1',
        toolName: 'shell',
        input: { command: 'sleep 1' },
        modelCallId: 'model-call-1',
      });
      expect(normalizer.finish(status)).toEqual([
        expect.objectContaining({ kind: 'tool-call', toolCallId: 'call-1' }),
        expect.objectContaining({
          kind: 'tool-result',
          toolCallId: 'call-1',
          result: { status: 'aborted' },
          isError: true,
        }),
      ]);
    }
  );

  it('generates guarded terminal-text fallback blocks and deduplicates its warning', () => {
    const normalizer = new CursorEventNormalizer(false);
    expect(normalizer.fallbackText('terminal')).toEqual([
      { kind: 'text-start', id: 'txt-1' },
      { kind: 'text-delta', id: 'txt-1', delta: 'terminal' },
      { kind: 'text-end', id: 'txt-1' },
      expect.objectContaining({
        kind: 'compatibility-warning',
        feature: 'text-delta-fallback',
      }),
    ]);
    expect(normalizer.fallbackText('again')).toHaveLength(3);
  });
});
