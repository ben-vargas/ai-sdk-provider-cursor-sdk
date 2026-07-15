import { APICallError, type LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { reduceCursorStream } from './reduce-stream.js';

const usage = {
  inputTokens: { total: 3, noCache: 2, cacheRead: 1, cacheWrite: 0 },
  outputTokens: { total: 4, text: 3, reasoning: 1 },
};

function streamOf(parts: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

describe('reduceCursorStream', () => {
  it('folds content, metadata, warnings, usage, and finish reason in order', async () => {
    const warnings = [{ type: 'unsupported', feature: 'temperature', details: 'ignored' } as const];
    const result = await reduceCursorStream(
      streamOf([
        { type: 'stream-start', warnings },
        {
          type: 'response-metadata',
          id: 'run-1',
          modelId: 'composer-2.5',
          timestamp: new Date('2026-07-14T00:00:00Z'),
        },
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', delta: 'think' },
        { type: 'reasoning-delta', id: 'r1', delta: 'ing' },
        { type: 'reasoning-end', id: 'r1' },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'hel' },
        { type: 'text-delta', id: 't1', delta: 'lo' },
        { type: 'text-end', id: 't1' },
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'shell',
          input: '{}',
          providerExecuted: true,
          dynamic: true,
        },
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'shell',
          result: { stdout: 'partial' },
          preliminary: true,
          dynamic: true,
        },
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'shell',
          result: { stdout: 'final' },
          dynamic: true,
        },
        { type: 'raw', rawValue: { ignored: true } },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'finished' },
          usage,
          providerMetadata: { cursor: { agentId: 'agent-1', runId: 'run-1' } },
        },
      ])
    );

    expect(result).toEqual({
      content: [
        { type: 'reasoning', text: 'thinking', providerMetadata: undefined },
        { type: 'text', text: 'hello', providerMetadata: undefined },
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'shell',
          input: '{}',
          providerExecuted: true,
          dynamic: true,
        },
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'shell',
          result: { stdout: 'final' },
          dynamic: true,
        },
      ],
      finishReason: { unified: 'stop', raw: 'finished' },
      usage,
      warnings,
      providerMetadata: { cursor: { agentId: 'agent-1', runId: 'run-1' } },
      response: {
        id: 'run-1',
        modelId: 'composer-2.5',
        timestamp: new Date('2026-07-14T00:00:00Z'),
      },
    });
  });

  it('replaces each preliminary result with the next one and retains one final result', async () => {
    const result = await reduceCursorStream(
      streamOf([
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'shell',
          result: { step: 1 },
          preliminary: true,
        },
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'shell',
          result: { step: 2 },
          preliminary: true,
        },
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'shell',
          result: { step: 3 },
        },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'finished' },
          usage,
        },
      ])
    );
    expect(result.content).toEqual([
      expect.objectContaining({ type: 'tool-result', result: { step: 3 } }),
    ]);
    expect(result.content[0]).not.toHaveProperty('preliminary');
  });

  it('merges providerMetadata from reasoning-end and text-end into folded content', async () => {
    const result = await reduceCursorStream(
      streamOf([
        { type: 'stream-start', warnings: [] },
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', delta: 'think' },
        {
          type: 'reasoning-end',
          id: 'r1',
          providerMetadata: { cursor: { thinkingDurationMs: 1200 } },
        },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'hi' },
        { type: 'text-end', id: 't1', providerMetadata: { cursor: { note: 'done' } } },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'finished' }, usage },
      ])
    );
    expect(result.content).toEqual([
      {
        type: 'reasoning',
        text: 'think',
        providerMetadata: { cursor: { thinkingDurationMs: 1200 } },
      },
      { type: 'text', text: 'hi', providerMetadata: { cursor: { note: 'done' } } },
    ]);
  });

  it('appends custom stream parts to folded content', async () => {
    const result = await reduceCursorStream(
      streamOf([
        { type: 'stream-start', warnings: [] },
        { type: 'custom', kind: 'cursor.checkpoint', providerMetadata: { cursor: { at: 1 } } },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'finished' }, usage },
      ])
    );
    expect(result.content).toEqual([
      { type: 'custom', kind: 'cursor.checkpoint', providerMetadata: { cursor: { at: 1 } } },
    ]);
  });

  it('throws the exact error part value', async () => {
    const error = new Error('run failed');
    await expect(
      reduceCursorStream(
        streamOf([
          { type: 'stream-start', warnings: [] },
          { type: 'error', error },
          {
            type: 'finish',
            finishReason: { unified: 'error', raw: 'error' },
            usage,
          },
        ])
      )
    ).rejects.toBe(error);
  });

  it('throws a retryable APICallError when the stream closes without finish', async () => {
    let thrown: unknown;
    try {
      await reduceCursorStream(streamOf([{ type: 'stream-start', warnings: [] }]));
    } catch (error) {
      thrown = error;
    }
    expect(APICallError.isInstance(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      message: 'Cursor run ended without a terminal result.',
      isRetryable: true,
      url: 'cursor-sdk://agent.send',
    });
  });
});
