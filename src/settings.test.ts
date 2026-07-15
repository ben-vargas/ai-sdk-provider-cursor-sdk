import type { CursorSettings } from './settings.js';
import {
  cursorProviderOptionsSchema,
  cursorSettingsSchema,
  mergeCursorSettings,
} from './settings.js';

const fakeAgent = {
  agentId: 'agent-injected',
  send: vi.fn(),
  close: vi.fn(),
};

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const settingsCoverage = {
  apiKey: 'key',
  agentId: 'agent-1',
  agent: fakeAgent,
  createNewAgentPerCall: true,
  agentName: 'test agent',
  mode: 'plan',
  local: { cwd: '/repo' },
  cloud: { repos: [{ url: 'https://example.test/repo' }] },
  customTools: { lookup: { execute: async () => 'ok' } },
  mcpServers: { docs: { type: 'http', url: 'https://example.test/mcp' } },
  agents: { reviewer: { description: 'reviews', prompt: 'Review changes' } },
  promptHistoryMode: 'flatten',
  systemMessageMode: 'prefix',
  modelParams: [{ id: 'fast', value: 'true' }],
  experimentalPreliminaryToolResults: true,
  sdkAgentOptions: { name: 'sdk name' },
  idempotencyKey: 'idempotency-1',
  logger,
  verbose: true,
  onDeltaEvent: vi.fn(),
  onRunResult: vi.fn(),
  onRunCreated: vi.fn(),
} satisfies Record<keyof Required<CursorSettings>, unknown>;

describe('cursorSettingsSchema', () => {
  for (const [name, value] of Object.entries(settingsCoverage)) {
    it(`validates ${name} independently`, () => {
      expect(cursorSettingsSchema.safeParse({ [name]: value }).success).toBe(true);
    });
  }

  it('accepts both stdio and HTTP MCP server shapes', () => {
    expect(
      cursorSettingsSchema.safeParse({
        mcpServers: {
          local: {
            command: 'node',
            args: ['server.mjs'],
            env: { TOKEN: 'secret' },
            cwd: '/repo',
          },
          remote: {
            type: 'sse',
            url: 'https://example.test/mcp',
            headers: { Authorization: 'Bearer token' },
            auth: { CLIENT_ID: 'client', CLIENT_SECRET: 'secret', scopes: ['read'] },
          },
        },
      }).success
    ).toBe(true);
  });

  it.each([
    { agentId: 'agent', agent: fakeAgent },
    { agentId: 'agent', createNewAgentPerCall: true },
    { agent: fakeAgent, createNewAgentPerCall: true },
  ])('rejects mutually exclusive identity settings %#', (value) => {
    expect(cursorSettingsSchema.safeParse(value).success).toBe(false);
  });

  it('rejects empty agent IDs', () => {
    const result = cursorSettingsSchema.safeParse({ agentId: '   ' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toMatch(/cannot be empty/);
  });

  it('accepts agentId with createNewAgentPerCall explicitly false', () => {
    expect(
      cursorSettingsSchema.safeParse({
        agentId: 'agent-1',
        createNewAgentPerCall: false,
      }).success
    ).toBe(true);
  });

  it('rejects local and cloud together', () => {
    expect(cursorSettingsSchema.safeParse({ local: {}, cloud: {} }).success).toBe(false);
  });

  it('rejects custom tools on cloud through either setting path', () => {
    const customTools = { tool: { execute: () => 'ok' } };
    expect(cursorSettingsSchema.safeParse({ cloud: {}, customTools }).success).toBe(false);
    expect(cursorSettingsSchema.safeParse({ cloud: {}, local: { customTools } }).success).toBe(
      false
    );
  });

  it.each(['model', 'apiKey', 'agentId', 'idempotencyKey'] as const)(
    'blocklists provider-managed sdkAgentOptions.%s',
    (key) => {
      const result = cursorSettingsSchema.safeParse({ sdkAgentOptions: { [key]: 'bad' } });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.message).toContain('provider-managed');
    }
  );

  it('strictly rejects unknown settings and nested option keys', () => {
    expect(cursorSettingsSchema.safeParse({ unknown: true }).success).toBe(false);
    expect(cursorSettingsSchema.safeParse({ local: { unknown: true } }).success).toBe(false);
    expect(cursorSettingsSchema.safeParse({ cloud: { unknown: true } }).success).toBe(false);
  });
});

describe('cursorProviderOptionsSchema', () => {
  it('accepts every supported per-call override', () => {
    expect(
      cursorProviderOptionsSchema.parse({
        agentId: 'agent-call',
        mode: 'plan',
        modelParams: [{ id: 'fast', value: 'true' }],
        idempotencyKey: 'send-1',
        localForce: true,
      })
    ).toEqual({
      agentId: 'agent-call',
      mode: 'plan',
      modelParams: [{ id: 'fast', value: 'true' }],
      idempotencyKey: 'send-1',
      localForce: true,
    });
  });

  it.each([
    { agentId: '' },
    { mode: 'ask' },
    { modelParams: [{ id: 'fast', value: 1 }] },
    { localForce: 'yes' },
    { extra: true },
  ])('rejects invalid per-call options %#', (value) => {
    expect(cursorProviderOptionsSchema.safeParse(value).success).toBe(false);
  });
});

describe('mergeCursorSettings', () => {
  it('uses model settings over defaults and shallow-replaces nested objects', () => {
    const defaults: CursorSettings = {
      mode: 'agent',
      local: { cwd: '/default', autoReview: true },
      mcpServers: { one: { command: 'one' } },
      customTools: { one: { execute: () => 'one' } },
    };
    const overrides: CursorSettings = {
      mode: 'plan',
      local: { cwd: '/override' },
      mcpServers: { two: { command: 'two' } },
      customTools: { two: { execute: () => 'two' } },
    };
    expect(mergeCursorSettings(defaults, overrides)).toEqual({
      mode: 'plan',
      local: { cwd: '/override' },
      mcpServers: { two: { command: 'two' } },
      customTools: { two: overrides.customTools?.two },
    });
  });
});
