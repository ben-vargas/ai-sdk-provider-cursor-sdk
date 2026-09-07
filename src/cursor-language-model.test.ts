import {
  APICallError,
  LoadAPIKeyError,
  type LanguageModelV3CallOptions,
  type LanguageModelV3StreamPart,
} from '@ai-sdk/provider';
import { AgentNotFoundError, NetworkError, type Run, type SDKAgent } from '@cursor/sdk';
import { CursorAgentManager } from './cursor-agent-manager.js';
import { CursorLanguageModel } from './cursor-language-model.js';
import { noopLogger, type Logger } from './logger.js';
import { FakeRun, FakeSDKAgent, loadDeltaFixture } from './__tests__/fixtures/fake-cursor-sdk.js';
import {
  mockAgentCreate,
  mockAgentResume,
  resetCursorSdkMock,
} from './__tests__/fixtures/mock-cursor-sdk.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function callOptions(
  overrides: Partial<LanguageModelV3CallOptions> = {}
): LanguageModelV3CallOptions {
  return {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    ...overrides,
  };
}

function model(
  agent: SDKAgent,
  settings: Partial<ConstructorParameters<typeof CursorLanguageModel>[0]['settings']> = {},
  logger: Logger = noopLogger
): CursorLanguageModel {
  return new CursorLanguageModel({
    id: 'composer-2.5',
    settings: { apiKey: 'test-key', agent, ...settings },
    agentManager: new CursorAgentManager(logger),
    logger,
  });
}

async function collect(
  stream: ReadableStream<LanguageModelV3StreamPart>
): Promise<LanguageModelV3StreamPart[]> {
  const parts: LanguageModelV3StreamPart[] = [];
  for await (const part of stream) parts.push(part);
  return parts;
}

function controlledAgent(
  run: Run,
  agentId = 'agent-controlled'
): SDKAgent & {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return {
    agentId,
    model: run.model,
    send: vi.fn(async () => run),
    close: vi.fn(),
    reload: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
    listArtifacts: vi.fn(async () => []),
    downloadArtifact: vi.fn(async () => Buffer.alloc(0)),
    getUsage: vi.fn(async () => ({
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      },
      runs: [],
    })),
  };
}

describe('CursorLanguageModel streaming and generation', () => {
  beforeEach(() => resetCursorSdkMock());

  it('replays early deltas, callbacks, metadata, usage, and finish from the canonical stream', async () => {
    const fixtureAgent = new FakeSDKAgent(loadDeltaFixture('text-only'));
    const onDeltaEvent = vi.fn();
    const onRunCreated = vi.fn();
    const onRunResult = vi.fn();
    const languageModel = model(fixtureAgent, { onDeltaEvent, onRunCreated, onRunResult });
    const { stream } = await languageModel.doStream(callOptions());
    const parts = await collect(stream);

    expect(parts[0]).toEqual({ type: 'stream-start', warnings: [] });
    const firstTextIndex = parts.findIndex((part) => part.type === 'text-delta');
    const metadataIndex = parts.findIndex((part) => part.type === 'response-metadata');
    expect(firstTextIndex).toBeGreaterThan(-1);
    expect(metadataIndex).toBeGreaterThan(firstTextIndex);
    expect(parts.filter((part) => part.type === 'text-delta')).toEqual([
      expect.objectContaining({ delta: 'Hello' }),
      expect.objectContaining({ delta: ' world' }),
    ]);
    expect(parts.at(-1)).toMatchObject({
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'finished' },
      usage: {
        inputTokens: { total: 13, noCache: 10, cacheRead: 2, cacheWrite: 1 },
        outputTokens: { total: 4, text: 3, reasoning: 1 },
      },
      providerMetadata: {
        cursor: {
          agentId: 'agent-fixture',
          runId: 'run-text',
          requestId: 'request-text',
          result: 'Hello world',
        },
      },
    });
    expect(onDeltaEvent).toHaveBeenCalledTimes(3);
    expect(onRunCreated).toHaveBeenCalledWith(fixtureAgent.lastRun);
    expect(onRunResult).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-text' }));
  });

  it('folds doGenerate from the same stream semantics', async () => {
    const generated = await model(new FakeSDKAgent(loadDeltaFixture('tool-roundtrip'))).doGenerate(
      callOptions()
    );
    expect(generated.content.map((part) => part.type)).toEqual([
      'text',
      'tool-call',
      'tool-result',
      'text',
    ]);
    expect(generated.content.filter((part) => part.type === 'text')).toEqual([
      expect.objectContaining({ text: 'Before' }),
      expect.objectContaining({ text: 'After' }),
    ]);
    expect(generated.content.find((part) => part.type === 'tool-call')).toMatchObject({
      toolCallId: 'call-shell',
      providerExecuted: true,
      dynamic: true,
    });
    expect(generated.content.filter((part) => part.type === 'tool-result')).toHaveLength(1);
    expect(generated.finishReason).toEqual({ unified: 'stop', raw: 'finished' });
  });

  it('preserves reasoning/text block ordering through doGenerate', async () => {
    const generated = await model(
      new FakeSDKAgent(loadDeltaFixture('text-and-thinking'))
    ).doGenerate(callOptions());
    expect(generated.content).toEqual([
      expect.objectContaining({ type: 'reasoning', text: 'Thinking' }),
      expect.objectContaining({ type: 'text', text: 'Answer' }),
      expect.objectContaining({ type: 'reasoning', text: 'Check' }),
      expect.objectContaining({ type: 'text', text: ' done' }),
    ]);
  });

  it('forwards per-call provider overrides and reasserts sticky model selection on every send', async () => {
    const agent = new FakeSDKAgent(loadDeltaFixture('text-only'));
    const languageModel = model(agent, {
      mode: 'plan',
      modelParams: [{ id: 'fast', value: 'false' }],
      idempotencyKey: 'settings-key',
    });
    const overrides = {
      providerOptions: {
        cursor: {
          mode: 'agent',
          modelParams: [{ id: 'fast', value: 'true' }],
          idempotencyKey: 'call-key',
          localForce: true,
        },
      },
    } satisfies Partial<LanguageModelV3CallOptions>;
    await languageModel.doGenerate(callOptions(overrides));
    await languageModel.doGenerate(callOptions(overrides));
    expect(agent.sent).toHaveLength(2);
    for (const sent of agent.sent) {
      expect(sent.options).toMatchObject({
        model: { id: 'composer-2.5', params: [{ id: 'fast', value: 'true' }] },
        mode: 'agent',
        idempotencyKey: 'call-key',
        local: { force: true },
        onDelta: expect.any(Function),
      });
      expect(sent.options).not.toHaveProperty('mcpServers');
      expect(sent.options).not.toHaveProperty('onStep');
      expect(sent.options).not.toHaveProperty('cloud');
    }
  });

  it('uses settings-tier send options and omits local when localForce is not enabled', async () => {
    const agent = new FakeSDKAgent(loadDeltaFixture('text-only'));
    await model(agent, {
      mode: 'plan',
      modelParams: [{ id: 'fast', value: 'settings' }],
      idempotencyKey: 'settings-key',
    }).doGenerate(callOptions());

    expect(agent.sent[0]?.options).toMatchObject({
      model: { id: 'composer-2.5', params: [{ id: 'fast', value: 'settings' }] },
      mode: 'plan',
      idempotencyKey: 'settings-key',
    });
    expect(agent.sent[0]?.options).not.toHaveProperty('local');
  });

  it('omits mode when neither call options nor model settings configure it', async () => {
    const agent = new FakeSDKAgent(loadDeltaFixture('text-only'));
    await model(agent).doGenerate(callOptions());

    expect(agent.sent[0]?.options).not.toHaveProperty('mode');
  });

  it('includes raw redacted Cursor updates only when requested', async () => {
    const hidden = await model(new FakeSDKAgent(loadDeltaFixture('summary-events'))).doStream(
      callOptions()
    );
    expect((await collect(hidden.stream)).some((part) => part.type === 'raw')).toBe(false);

    const visible = await model(new FakeSDKAgent(loadDeltaFixture('summary-events'))).doStream(
      callOptions({ includeRawChunks: true })
    );
    expect((await collect(visible.stream)).filter((part) => part.type === 'raw')).toHaveLength(7);
  });

  it('surfaces call and prompt-conversion warnings in stream and generate results', async () => {
    const languageModel = model(new FakeSDKAgent(loadDeltaFixture('text-only')), {
      promptHistoryMode: 'ignore',
      systemMessageMode: 'ignore',
    });
    const result = await languageModel.doGenerate(
      callOptions({
        temperature: 0.5,
        prompt: [
          { role: 'system', content: 'system' },
          { role: 'user', content: [{ type: 'text', text: 'old' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
          { role: 'user', content: [{ type: 'text', text: 'latest' }] },
        ],
      })
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'unsupported', feature: 'temperature' }),
        expect.objectContaining({ type: 'unsupported', feature: 'prompt.system' }),
        expect.objectContaining({ type: 'other' }),
      ])
    );
  });

  it('uses terminal result fallback with a visible compatibility warning', async () => {
    const fixture = loadDeltaFixture('text-only');
    fixture.events = fixture.events.filter(({ update }) => update.type === 'turn-ended');
    fixture.result.result = 'fallback text';
    const result = await model(new FakeSDKAgent(fixture)).doGenerate(callOptions());
    expect(result.content).toEqual([
      expect.objectContaining({ type: 'text', text: 'fallback text' }),
    ]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ type: 'compatibility', feature: 'text-delta-fallback' })
    );
  });

  it('resumes via providerOptions agentId and returns it through provider metadata', async () => {
    const resumed = new FakeSDKAgent(loadDeltaFixture('text-only'), {}, 'agent-resumed');
    mockAgentResume.mockResolvedValue(resumed);
    const languageModel = new CursorLanguageModel({
      id: 'composer-2.5',
      settings: { apiKey: 'test-key' },
      agentManager: new CursorAgentManager(noopLogger),
      logger: noopLogger,
    });
    const result = await languageModel.doGenerate(
      callOptions({ providerOptions: { cursor: { agentId: 'agent-resumed' } } })
    );
    expect(mockAgentResume).toHaveBeenCalledWith(
      'agent-resumed',
      expect.objectContaining({ apiKey: 'test-key' })
    );
    expect(result.providerMetadata?.cursor).toMatchObject({ agentId: 'agent-resumed' });
  });

  it('reuses one lazily created agent for repeated calls on the model instance', async () => {
    const created = new FakeSDKAgent(loadDeltaFixture('text-only'));
    mockAgentCreate.mockResolvedValue(created);
    const languageModel = new CursorLanguageModel({
      id: 'composer-2.5',
      settings: { apiKey: 'test-key' },
      agentManager: new CursorAgentManager(noopLogger),
      logger: noopLogger,
    });
    await languageModel.doGenerate(callOptions());
    await languageModel.doGenerate(callOptions());
    expect(mockAgentCreate).toHaveBeenCalledTimes(1);
    expect(created.sent).toHaveLength(2);
  });

  it('rejects invalid per-call options before touching the agent', async () => {
    const agent = new FakeSDKAgent(loadDeltaFixture('text-only'));
    await expect(
      model(agent).doGenerate(callOptions({ providerOptions: { cursor: { unexpected: true } } }))
    ).rejects.toThrow(/^Invalid providerOptions\.cursor:/);
    expect(agent.sent).toHaveLength(0);
  });
});

describe('CursorLanguageModel terminal errors', () => {
  beforeEach(() => resetCursorSdkMock());

  it('finishes an external cancellation without treating it as an app abort', async () => {
    const result = await model(new FakeSDKAgent(loadDeltaFixture('cancelled'))).doGenerate(
      callOptions()
    );
    expect(result.finishReason).toEqual({ unified: 'other', raw: 'cancelled' });
    expect(result.content).toEqual([
      expect.objectContaining({ type: 'tool-call', toolCallId: 'call-cancelled' }),
      expect.objectContaining({
        type: 'tool-result',
        toolCallId: 'call-cancelled',
        result: { status: 'aborted' },
        isError: true,
      }),
    ]);
  });

  it('streams error then finish for RunResult error while doGenerate rejects', async () => {
    const streamed = await model(new FakeSDKAgent(loadDeltaFixture('run-error'))).doStream(
      callOptions()
    );
    const parts = await collect(streamed.stream);
    const errorIndex = parts.findIndex((part) => part.type === 'error');
    const finishIndex = parts.findIndex((part) => part.type === 'finish');
    expect(errorIndex).toBeGreaterThan(-1);
    expect(finishIndex).toBe(errorIndex + 1);
    expect(parts[errorIndex]).toMatchObject({
      type: 'error',
      error: expect.objectContaining({ isRetryable: true }),
    });
    await expect(
      model(new FakeSDKAgent(loadDeltaFixture('run-error'))).doGenerate(callOptions())
    ).rejects.toMatchObject({ message: 'backend overloaded', isRetryable: true });
  });

  it('fails closed on unknown semantic deltas with one retryable error part and no finish', async () => {
    const { stream } = await model(
      new FakeSDKAgent(loadDeltaFixture('unknown-semantic-event'))
    ).doStream(callOptions());
    const parts = await collect(stream);
    expect(parts.map((part) => part.type)).toEqual(['stream-start', 'response-metadata', 'error']);
    const errorPart = parts.find((part) => part.type === 'error');
    const error = errorPart?.type === 'error' ? errorPart.error : undefined;
    expect(APICallError.isInstance(error)).toBe(true);
    expect(error).toMatchObject({ isRetryable: true });
  });

  it('maps send and wait rejections into error parts that doGenerate rethrows', async () => {
    const sendError = new NetworkError('send unavailable', {
      status: 503,
      code: 'network',
    });
    await expect(
      model(new FakeSDKAgent(loadDeltaFixture('text-only'), { sendRejects: sendError })).doGenerate(
        callOptions()
      )
    ).rejects.toMatchObject({ message: 'send unavailable', isRetryable: true });

    const run = new FakeRun({
      agentId: 'agent-controlled',
      result: { id: 'run-wait', status: 'finished' },
    });
    vi.spyOn(run, 'wait').mockRejectedValue(
      new NetworkError('wait unavailable', { status: 504, code: 'timeout' })
    );
    await expect(model(controlledAgent(run)).doGenerate(callOptions())).rejects.toMatchObject({
      message: 'wait unavailable',
      isRetryable: true,
      url: 'cursor-sdk://run.wait',
    });
  });

  it('evicts a cached resumed handle when send reports AgentNotFoundError', async () => {
    const stale = new FakeSDKAgent(loadDeltaFixture('text-only'), {
      sendRejects: new AgentNotFoundError('stale send'),
    });
    const healthy = new FakeSDKAgent(loadDeltaFixture('text-only'), {}, 'agent-resumed');
    mockAgentResume.mockResolvedValueOnce(stale).mockResolvedValueOnce(healthy);
    const languageModel = new CursorLanguageModel({
      id: 'composer-2.5',
      settings: { apiKey: 'test-key', agentId: 'agent-resumed' },
      agentManager: new CursorAgentManager(noopLogger),
      logger: noopLogger,
    });

    await expect(languageModel.doGenerate(callOptions())).rejects.toMatchObject({
      data: { code: 'agent_not_found' },
    });
    await expect(languageModel.doGenerate(callOptions())).resolves.toMatchObject({
      finishReason: { unified: 'stop' },
    });
    expect(mockAgentResume).toHaveBeenCalledTimes(2);
  });

  it('evicts a cached model-scoped handle when send reports AgentNotFoundError', async () => {
    const stale = new FakeSDKAgent(loadDeltaFixture('text-only'), {
      sendRejects: new AgentNotFoundError('stale send'),
    });
    const healthy = new FakeSDKAgent(loadDeltaFixture('text-only'));
    mockAgentCreate.mockResolvedValueOnce(stale).mockResolvedValueOnce(healthy);
    const languageModel = new CursorLanguageModel({
      id: 'composer-2.5',
      settings: { apiKey: 'test-key' },
      agentManager: new CursorAgentManager(noopLogger),
      logger: noopLogger,
    });

    await expect(languageModel.doGenerate(callOptions())).rejects.toMatchObject({
      data: { code: 'agent_not_found' },
    });
    await expect(languageModel.doGenerate(callOptions())).resolves.toMatchObject({
      finishReason: { unified: 'stop' },
    });
    expect(mockAgentCreate).toHaveBeenCalledTimes(2);
  });

  it('closes a call-scoped agent after send rejects', async () => {
    const agent = new FakeSDKAgent(loadDeltaFixture('text-only'), {
      sendRejects: new NetworkError('send failed', { status: 503 }),
    });
    mockAgentCreate.mockResolvedValue(agent);
    const languageModel = new CursorLanguageModel({
      id: 'composer-2.5',
      settings: { apiKey: 'test-key', createNewAgentPerCall: true },
      agentManager: new CursorAgentManager(noopLogger),
      logger: noopLogger,
    });

    await expect(languageModel.doGenerate(callOptions())).rejects.toThrow('send failed');
    expect(agent.closeCalls).toHaveLength(1);
  });

  it('limits error prompt excerpts to the first 200 characters', async () => {
    const agent = new FakeSDKAgent(loadDeltaFixture('text-only'), {
      sendRejects: new NetworkError('send failed', { status: 503 }),
    });
    const prompt = 'x'.repeat(250);
    await expect(
      model(agent).doGenerate(
        callOptions({ prompt: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] })
      )
    ).rejects.toMatchObject({
      requestBodyValues: { promptExcerpt: 'x'.repeat(200) },
      data: { promptExcerpt: 'x'.repeat(200) },
    });
  });

  it('rejects unsupported wait operations as non-retryable configuration errors', async () => {
    const run = new FakeRun({
      agentId: 'agent-controlled',
      result: { id: 'run-no-wait', status: 'finished' },
      unsupported: ['wait'],
    });
    await expect(model(controlledAgent(run)).doGenerate(callOptions())).rejects.toMatchObject({
      message: 'wait disabled by fixture',
      isRetryable: false,
    });
  });

  it('throws LoadAPIKeyError before agent acquisition', async () => {
    const original = process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;
    const agent = new FakeSDKAgent(loadDeltaFixture('text-only'));
    const languageModel = new CursorLanguageModel({
      id: 'auto',
      settings: { agent },
      agentManager: new CursorAgentManager(noopLogger),
      logger: noopLogger,
    });
    let thrown: unknown;
    try {
      await languageModel.doGenerate(callOptions());
    } catch (error) {
      thrown = error;
    } finally {
      if (original !== undefined) process.env.CURSOR_API_KEY = original;
    }
    expect(LoadAPIKeyError.isInstance(thrown)).toBe(true);
    expect(agent.sent).toHaveLength(0);
  });
});

describe('CursorLanguageModel abort and cancellation', () => {
  beforeEach(() => resetCursorSdkMock());

  it('passes through an already-aborted signal before send', async () => {
    const agent = new FakeSDKAgent(loadDeltaFixture('text-only'));
    const controller = new AbortController();
    const reason = new Error('already aborted');
    controller.abort(reason);
    await expect(
      model(agent).doStream(callOptions({ abortSignal: controller.signal }))
    ).rejects.toBe(reason);
    expect(agent.sent).toHaveLength(0);
  });

  it('aborts pending agent acquisition and releases a late call-scoped agent', async () => {
    const gate = deferred<FakeSDKAgent>();
    const agent = new FakeSDKAgent(loadDeltaFixture('text-only'));
    mockAgentCreate.mockReturnValue(gate.promise);
    const languageModel = new CursorLanguageModel({
      id: 'composer-2.5',
      settings: { apiKey: 'test-key', createNewAgentPerCall: true },
      agentManager: new CursorAgentManager(noopLogger),
      logger: noopLogger,
    });
    const controller = new AbortController();
    const reason = new Error('abort acquisition');
    const pending = languageModel.doStream(callOptions({ abortSignal: controller.signal }));

    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    gate.resolve(agent);
    await vi.waitFor(() => expect(agent.closeCalls).toHaveLength(1));
    expect(agent.sent).toHaveLength(0);
  });

  it('aborts while queued behind the per-agent mutex without a second send', async () => {
    const firstGate = deferred();
    const firstRun = new FakeRun({
      agentId: 'agent-controlled',
      result: { id: 'run-first', status: 'finished', result: 'first' },
      completion: firstGate.promise,
    });
    const secondRun = new FakeRun({
      agentId: 'agent-controlled',
      result: { id: 'run-second', status: 'finished', result: 'second' },
    });
    const agent = controlledAgent(firstRun);
    agent.send.mockResolvedValueOnce(firstRun).mockResolvedValueOnce(secondRun);
    const languageModel = model(agent);
    const first = await languageModel.doStream(callOptions());
    const firstCollection = collect(first.stream);
    await vi.waitFor(() => expect(agent.send).toHaveBeenCalledTimes(1));

    const controller = new AbortController();
    const reason = new Error('queued abort');
    const second = await languageModel.doStream(callOptions({ abortSignal: controller.signal }));
    controller.abort(reason);
    await expect(collect(second.stream)).rejects.toBe(reason);
    expect(agent.send).toHaveBeenCalledTimes(1);

    firstGate.resolve();
    await firstCollection;
  });

  it('cancels an in-flight run and errors the stream with the original reason', async () => {
    const gate = deferred();
    const run = new FakeRun({
      agentId: 'agent-controlled',
      result: { id: 'run-abort', status: 'finished' },
      completion: gate.promise,
    });
    const agent = controlledAgent(run);
    const controller = new AbortController();
    const reason = new Error('in-flight abort');
    const { stream } = await model(agent).doStream(callOptions({ abortSignal: controller.signal }));
    const collecting = collect(stream);
    await vi.waitFor(() => expect(agent.send).toHaveBeenCalledTimes(1));
    controller.abort(reason);
    await expect(collecting).rejects.toBe(reason);
    expect(run.cancelCalls).toHaveLength(1);
    gate.resolve();
  });

  it('aborts after a text delta without emitting a finish part', async () => {
    const gate = deferred();
    const run = new FakeRun({
      agentId: 'agent-controlled',
      result: { id: 'run-after-delta', status: 'finished' },
      completion: gate.promise,
    });
    const agent = controlledAgent(run);
    agent.send.mockImplementation(async (_message, sendOptions) => {
      await sendOptions?.onDelta?.({ update: { type: 'text-delta', text: 'partial' } });
      return run;
    });
    const controller = new AbortController();
    const reason = new Error('abort after delta');
    const { stream } = await model(agent).doStream(callOptions({ abortSignal: controller.signal }));
    const reader = stream.getReader();
    const observed: LanguageModelV3StreamPart[] = [];

    while (!observed.some((part) => part.type === 'text-delta')) {
      const next = await reader.read();
      if (next.done) throw new Error('stream ended before a text delta');
      observed.push(next.value);
    }
    controller.abort(reason);
    await expect(reader.read()).rejects.toBe(reason);
    expect(run.cancelCalls).toHaveLength(1);
    expect(observed.some((part) => part.type === 'finish')).toBe(false);
    gate.resolve();
  });

  it('aborts while send is pending and cancels the run when its handle resolves later', async () => {
    const agent = new FakeSDKAgent(loadDeltaFixture('text-only'), { delayMs: 50 });
    const controller = new AbortController();
    const reason = new Error('abort pending send');
    const { stream } = await model(agent).doStream(callOptions({ abortSignal: controller.signal }));
    const collecting = collect(stream);
    await vi.waitFor(() => expect(agent.lastRun).toBeDefined());

    controller.abort(reason);
    await expect(collecting).rejects.toBe(reason);
    await vi.waitFor(() => expect(agent.lastRun?.cancelCalls).toHaveLength(1));
  });

  it('settles cancellation before releasing a call-scoped agent', async () => {
    const waitGate = deferred();
    const cancelGate = deferred();
    const run = new FakeRun({
      agentId: 'agent-call-scoped',
      result: { id: 'run-call-scoped-abort', status: 'finished' },
      completion: waitGate.promise,
    });
    const cancel = vi.spyOn(run, 'cancel').mockImplementation(async () => cancelGate.promise);
    const agent = controlledAgent(run, 'agent-call-scoped');
    mockAgentCreate.mockResolvedValue(agent);
    const languageModel = new CursorLanguageModel({
      id: 'composer-2.5',
      settings: { apiKey: 'test-key', createNewAgentPerCall: true },
      agentManager: new CursorAgentManager(noopLogger),
      logger: noopLogger,
    });
    const controller = new AbortController();
    const reason = new Error('cancel before release');
    const { stream } = await languageModel.doStream(
      callOptions({ abortSignal: controller.signal })
    );
    const collecting = collect(stream);
    await vi.waitFor(() => expect(agent.send).toHaveBeenCalledTimes(1));

    controller.abort(reason);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(agent.close).not.toHaveBeenCalled();

    cancelGate.resolve();
    await expect(collecting).rejects.toBe(reason);
    expect(agent.close).toHaveBeenCalledTimes(1);
    waitGate.resolve();
  });

  it('treats consumer stream cancellation as best-effort run cancellation', async () => {
    const gate = deferred();
    const run = new FakeRun({
      agentId: 'agent-controlled',
      result: { id: 'run-consumer-cancel', status: 'finished' },
      completion: gate.promise,
    });
    const agent = controlledAgent(run);
    const { stream } = await model(agent).doStream(callOptions());
    const reader = stream.getReader();
    await expect(reader.read()).resolves.toMatchObject({
      value: { type: 'stream-start' },
      done: false,
    });
    await reader.cancel(new Error('consumer stopped'));
    await vi.waitFor(() => expect(run.cancelCalls).toHaveLength(1));
    gate.resolve();
  });

  it('releases a call-scoped agent after consumer stream cancellation', async () => {
    const gate = deferred();
    const run = new FakeRun({
      agentId: 'agent-call-scoped',
      result: { id: 'run-consumer-call-scoped', status: 'finished' },
      completion: gate.promise,
    });
    const agent = controlledAgent(run, 'agent-call-scoped');
    mockAgentCreate.mockResolvedValue(agent);
    const languageModel = new CursorLanguageModel({
      id: 'composer-2.5',
      settings: { apiKey: 'test-key', createNewAgentPerCall: true },
      agentManager: new CursorAgentManager(noopLogger),
      logger: noopLogger,
    });
    const { stream } = await languageModel.doStream(callOptions());
    const reader = stream.getReader();
    await reader.read();
    await vi.waitFor(() => expect(agent.send).toHaveBeenCalledTimes(1));

    await reader.cancel(new Error('consumer stopped'));
    await vi.waitFor(() => expect(run.cancelCalls).toHaveLength(1));
    await vi.waitFor(() => expect(agent.close).toHaveBeenCalledTimes(1));
    gate.resolve();
  });

  it('removes every caller abort listener after normal completion', async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await model(new FakeSDKAgent(loadDeltaFixture('text-only'))).doGenerate(
      callOptions({ abortSignal: controller.signal })
    );

    const abortListeners = add.mock.calls
      .filter(([type]) => type === 'abort')
      .map(([, listener]) => listener);
    expect(abortListeners.length).toBeGreaterThan(0);
    for (const listener of abortListeners) {
      expect(remove).toHaveBeenCalledWith('abort', listener);
    }
  });

  it('logs and swallows cancellation failures while preserving the abort reason', async () => {
    const gate = deferred();
    const run = new FakeRun({
      agentId: 'agent-controlled',
      result: { id: 'run-cancel-fails', status: 'finished' },
      completion: gate.promise,
    });
    vi.spyOn(run, 'cancel').mockRejectedValue(new Error('cancel failed'));
    const agent = controlledAgent(run);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const controller = new AbortController();
    const reason = new Error('abort remains authoritative');
    const { stream } = await model(agent, {}, logger).doStream(
      callOptions({ abortSignal: controller.signal })
    );
    const collecting = collect(stream);
    await vi.waitFor(() => expect(agent.send).toHaveBeenCalled());
    controller.abort(reason);
    await expect(collecting).rejects.toBe(reason);
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to cancel Cursor run run-cancel-fails.',
        expect.objectContaining({ message: 'cancel failed' })
      )
    );
    gate.resolve();
  });
});
