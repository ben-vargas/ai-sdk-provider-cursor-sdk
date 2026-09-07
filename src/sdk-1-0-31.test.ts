import { generateText, streamText } from 'ai';
import { createCursor } from './cursor-provider.js';
import { cursorSettingsSchema } from './settings.js';
import { FakeSDKAgent, loadDeltaFixture } from './__tests__/fixtures/fake-cursor-sdk.js';
import {
  mockAgentCreate,
  mockAgentResume,
  resetCursorSdkMock,
} from './__tests__/fixtures/mock-cursor-sdk.js';

const promptA = '  You are a coding assistant. Use the available tools to inspect files.  ';
const promptB = 'You are a reviewer. Read files and report findings.';
const agent = (id = 'agent-local') => new FakeSDKAgent(loadDeltaFixture('text-only'), {}, id);

describe('Cursor SDK 1.0.31 options through the AI SDK', () => {
  beforeEach(() => resetCursorSdkMock());

  it('preserves the exact explicit system prompt through defaults, create, and streaming', async () => {
    mockAgentCreate.mockResolvedValue(agent());
    const cursor = createCursor({ apiKey: 'key', defaultSettings: { systemPrompt: promptA } });
    try {
      const result = streamText({ model: cursor('auto'), prompt: 'hello' });
      expect(await result.text).toBeTruthy();
      expect(mockAgentCreate).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: promptA, local: {} })
      );
    } finally {
      await cursor.close();
    }
  });

  it('lets model settings override the default system prompt', async () => {
    mockAgentCreate.mockResolvedValue(agent());
    const cursor = createCursor({ apiKey: 'key', defaultSettings: { systemPrompt: promptA } });
    try {
      await generateText({ model: cursor('auto', { systemPrompt: promptB }), prompt: 'hello' });
      expect(mockAgentCreate).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: promptB })
      );
    } finally {
      await cursor.close();
    }
  });

  it('forwards Agent Serve configuration through strict settings to cloud creation', async () => {
    mockAgentCreate.mockResolvedValue(agent('bc-cloud'));
    const cursor = createCursor({ apiKey: 'key' });
    const cloud = { agentServeAgent: 'reviewer', repos: [{ url: 'https://example.test/repo' }] };
    try {
      await generateText({ model: cursor('auto', { cloud }), prompt: 'hello' });
      expect(mockAgentCreate).toHaveBeenCalledWith(expect.objectContaining({ cloud }));
      expect(mockAgentCreate.mock.calls[0]?.[0]).not.toHaveProperty('local');
    } finally {
      await cursor.close();
    }
  });

  it('re-passes the prompt on resume and only shares handles with the same effective prompt', async () => {
    mockAgentResume.mockImplementation(async () => agent());
    const cursor = createCursor({ apiKey: 'key' });
    const configurations = [
      { systemPrompt: promptA },
      { systemPrompt: promptB },
      { systemPrompt: promptA },
      { systemPrompt: promptA, sdkAgentOptions: { systemPrompt: promptB } },
      {},
      { systemPrompt: promptA, sdkAgentOptions: { systemPrompt: undefined } },
    ];
    try {
      for (const settings of configurations) {
        await generateText({
          model: cursor('auto', settings),
          prompt: 'hello',
          providerOptions: { cursor: { agentId: 'agent-local' } },
        });
      }
      expect(mockAgentResume).toHaveBeenCalledTimes(3);
      expect(mockAgentResume.mock.calls.map((call) => call[1]?.systemPrompt)).toEqual([
        promptA,
        promptB,
        undefined,
      ]);
      expect(mockAgentCreate).not.toHaveBeenCalled();
    } finally {
      await cursor.close();
    }
  });

  it('uses the escape-hatch prompt for creation with the same precedence as resume', async () => {
    mockAgentCreate.mockResolvedValue(agent());
    const cursor = createCursor({ apiKey: 'key' });
    try {
      await generateText({
        model: cursor('auto', {
          systemPrompt: promptA,
          sdkAgentOptions: { systemPrompt: promptB },
        }),
        prompt: 'hello',
      });
      expect(mockAgentCreate).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: promptB })
      );
    } finally {
      await cursor.close();
    }
  });

  it('rejects a cloud ID supplied per call before resuming with a system prompt', async () => {
    const cursor = createCursor({ apiKey: 'key' });
    try {
      await expect(
        generateText({
          model: cursor('auto', { systemPrompt: promptA }),
          prompt: 'hello',
          providerOptions: { cursor: { agentId: 'bc-cloud' } },
        })
      ).rejects.toThrow(/local Cursor agents/);
      expect(mockAgentResume).not.toHaveBeenCalled();
    } finally {
      await cursor.close();
    }
  });

  it('keeps AI SDK system messages separate from the explicit harness replacement', async () => {
    const cursor = createCursor({ apiKey: 'key' });
    try {
      await expect(
        generateText({
          model: cursor('auto', { systemPrompt: promptA }),
          system: 'Additional instruction',
          prompt: 'hello',
        })
      ).rejects.toThrow(/system/);
      expect(mockAgentCreate).not.toHaveBeenCalled();
    } finally {
      await cursor.close();
    }
  });
});

describe('new SDK option validation', () => {
  it.each(['', '  ', 42, null])(
    'rejects invalid systemPrompt %j through both entry points',
    (value) => {
      expect(cursorSettingsSchema.safeParse({ systemPrompt: value }).success).toBe(false);
      expect(
        cursorSettingsSchema.safeParse({ sdkAgentOptions: { systemPrompt: value } }).success
      ).toBe(false);
    }
  );

  it.each([
    { systemPrompt: promptA, cloud: {} },
    { systemPrompt: promptA, sdkAgentOptions: { cloud: {} } },
    { cloud: {}, sdkAgentOptions: { systemPrompt: promptA } },
    { sdkAgentOptions: { cloud: {}, systemPrompt: promptA } },
    { agentId: 'bc-cloud', systemPrompt: promptA },
    { agent: agent(), systemPrompt: promptA },
    { agent: agent(), sdkAgentOptions: { systemPrompt: promptA } },
  ])('rejects unsupported runtime/identity combination %#', (settings) => {
    expect(cursorSettingsSchema.safeParse(settings).success).toBe(false);
  });

  it('validates the Agent Serve slug type', () => {
    expect(
      cursorSettingsSchema.parse({ cloud: { agentServeAgent: 'reviewer' } }).cloud?.agentServeAgent
    ).toBe('reviewer');
    expect(cursorSettingsSchema.safeParse({ cloud: { agentServeAgent: 42 } }).success).toBe(false);
  });
});
