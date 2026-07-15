import { NoObjectGeneratedError, generateObject, generateText, streamObject, streamText } from 'ai';
import { z } from 'zod';
import { createCursor } from '../cursor-provider.js';
import {
  FakeRun,
  FakeSDKAgent,
  loadDeltaFixture,
  type DeltaFixture,
} from './fixtures/fake-cursor-sdk.js';
import { mockAgentCreate, resetCursorSdkMock } from './fixtures/mock-cursor-sdk.js';

function jsonFixture(value: unknown): DeltaFixture {
  const text = JSON.stringify(value);
  const fixture = loadDeltaFixture('text-only');
  fixture.events = [
    { update: { type: 'text-delta', text: text.slice(0, Math.ceil(text.length / 2)) } },
    { update: { type: 'text-delta', text: text.slice(Math.ceil(text.length / 2)) } },
  ];
  fixture.result.result = text;
  return fixture;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('AI SDK v7 integration over the mocked Cursor boundary', () => {
  const originalWarningLogger = globalThis.AI_SDK_LOG_WARNINGS;

  beforeEach(() => {
    globalThis.AI_SDK_LOG_WARNINGS = false;
    resetCursorSdkMock();
    vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.AI_SDK_LOG_WARNINGS = originalWarningLogger;
    vi.restoreAllMocks();
  });

  it('generateText returns Cursor text, usage, warnings, and provider metadata', async () => {
    const agent = new FakeSDKAgent(loadDeltaFixture('text-only'));
    mockAgentCreate.mockResolvedValue(agent);
    const provider = createCursor({ apiKey: 'test-key', logger: false });
    const model = provider('composer-2.5');
    expect(model.specificationVersion).toBe('v4');
    const result = await generateText({
      model,
      prompt: 'Say hello',
    });

    expect(result.text).toBe('Hello world');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toMatchObject({ inputTokens: 13, outputTokens: 4 });
    expect(result.warnings ?? []).toEqual([]);
    expect(result.providerMetadata?.cursor).toMatchObject({
      agentId: 'agent-fixture',
      runId: 'run-text',
      requestId: 'request-text',
      result: 'Hello world',
    });
    expect(agent.sent[0]?.message).toEqual({ text: 'Say hello' });
    await provider.close();
  });

  it('a bare generateText call does not warn for AI SDK injected defaults', async () => {
    mockAgentCreate.mockResolvedValue(new FakeSDKAgent(loadDeltaFixture('text-only')));
    const provider = createCursor({ apiKey: 'test-key', logger: false });
    const result = await generateText({ model: provider('auto'), prompt: 'Plain call' });
    expect(result.warnings ?? []).toEqual([]);
    expect(process.emitWarning).not.toHaveBeenCalled();
    await provider.close();
  });

  it('streamText yields paired text events and a terminal usage/finish event', async () => {
    mockAgentCreate.mockResolvedValue(new FakeSDKAgent(loadDeltaFixture('text-only')));
    const provider = createCursor({ apiKey: 'test-key', logger: false });
    const result = streamText({ model: provider('auto'), prompt: 'Stream it' });
    const eventTypes: string[] = [];
    let text = '';
    let finishReason: string | undefined;
    for await (const part of result.fullStream) {
      eventTypes.push(part.type);
      if (part.type === 'text-delta') text += part.text;
      if (part.type === 'finish') finishReason = part.finishReason;
    }
    expect(text).toBe('Hello world');
    expect(eventTypes).toEqual(
      expect.arrayContaining(['text-start', 'text-delta', 'text-end', 'finish'])
    );
    expect(finishReason).toBe('stop');
    await expect(result.text).resolves.toBe('Hello world');
    await provider.close();
  });

  it('generateObject follows the documented warn-and-client-validate path', async () => {
    mockAgentCreate.mockResolvedValue(new FakeSDKAgent(jsonFixture({ name: 'Ada', age: 36 })));
    const provider = createCursor({ apiKey: 'test-key', logger: false });
    const result = await generateObject({
      model: provider('auto'),
      schema: z.object({ name: z.string(), age: z.number() }),
      prompt: 'Return a person as JSON',
    });
    expect(result.object).toEqual({ name: 'Ada', age: 36 });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ type: 'unsupported', feature: 'responseFormat' })
    );
    await provider.close();
  });

  it('generateObject rejects non-JSON output with NoObjectGeneratedError', async () => {
    const fixture = loadDeltaFixture('text-only');
    fixture.events = [{ update: { type: 'text-delta', text: 'not JSON' } }];
    fixture.result.result = 'not JSON';
    mockAgentCreate.mockResolvedValue(new FakeSDKAgent(fixture));
    const provider = createCursor({ apiKey: 'test-key', logger: false });

    let thrown: unknown;
    try {
      await generateObject({
        model: provider('auto'),
        schema: z.object({ name: z.string() }),
        prompt: 'Return a person as JSON',
      });
    } catch (error) {
      thrown = error;
    }
    expect(NoObjectGeneratedError.isInstance(thrown)).toBe(true);
    await provider.close();
  });

  it('streamObject parses partial and final objects despite the unsupported-format warning', async () => {
    mockAgentCreate.mockResolvedValue(new FakeSDKAgent(jsonFixture({ name: 'Grace', age: 45 })));
    const provider = createCursor({ apiKey: 'test-key', logger: false });
    const result = streamObject({
      model: provider('auto'),
      schema: z.object({ name: z.string(), age: z.number() }),
      prompt: 'Return a person as JSON',
    });
    const partials: unknown[] = [];
    for await (const partial of result.partialObjectStream) partials.push(partial);
    expect(partials.length).toBeGreaterThan(0);
    await expect(result.object).resolves.toEqual({ name: 'Grace', age: 45 });
    await provider.close();
  });

  it('AI SDK abortSignal preserves an already-aborted reason and prevents SDK creation', async () => {
    const controller = new AbortController();
    const reason = new Error('AI SDK abort');
    controller.abort(reason);
    const provider = createCursor({ apiKey: 'test-key', logger: false });
    await expect(
      generateText({
        model: provider('auto'),
        prompt: 'Never sent',
        abortSignal: controller.signal,
      })
    ).rejects.toBe(reason);
    expect(mockAgentCreate).not.toHaveBeenCalled();
    await provider.close();
  });

  it('AI SDK abortSignal preserves the reason after streamed text and cancels the run', async () => {
    const gate = deferred();
    const run = new FakeRun({
      agentId: 'agent-fixture',
      result: { id: 'run-ai-abort', status: 'finished' },
      completion: gate.promise,
    });
    const agent = new FakeSDKAgent(loadDeltaFixture('text-only'));
    vi.spyOn(agent, 'send').mockImplementation(async (_message, options) => {
      await options?.onDelta?.({ update: { type: 'text-delta', text: 'partial' } });
      return run;
    });
    mockAgentCreate.mockResolvedValue(agent);
    const provider = createCursor({ apiKey: 'test-key', logger: false });
    const controller = new AbortController();
    const reason = new Error('AI SDK in-flight abort');
    const result = streamText({
      model: provider('auto'),
      prompt: 'Start streaming',
      abortSignal: controller.signal,
    });
    let thrown: unknown;

    try {
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') controller.abort(reason);
      }
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(reason);
    expect(run.cancelCalls).toHaveLength(1);
    gate.resolve();
    await provider.close();
  });
});
