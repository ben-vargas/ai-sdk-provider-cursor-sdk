import type { CursorLocalSettings, CursorSettings } from './settings.js';
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
  teamId: 42,
  mode: 'plan',
  systemPrompt: 'You are a coding assistant with access to tools.',
  tools: ['shell', 'read'],
  disallowedTools: ['delete'],
  local: { cwd: '/repo', dirs: ['/other'] },
  cloud: {
    repos: [{ url: 'https://example.test/repo' }],
    metadata: { team: 'platform' },
    openAsCursorGithubApp: true,
    agentServeAgent: 'reviewer',
  },
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

  it('rejects tools and disallowedTools when cloud is set', () => {
    expect(cursorSettingsSchema.safeParse({ cloud: {}, tools: ['shell'] }).success).toBe(false);
    expect(cursorSettingsSchema.safeParse({ cloud: {}, disallowedTools: ['delete'] }).success).toBe(
      false
    );
    expect(cursorSettingsSchema.safeParse({ cloud: {}, tools: [] }).success).toBe(false);
  });

  it('accepts a legacy cwd array and first-class tool allow/deny lists', () => {
    expect(
      cursorSettingsSchema.safeParse({
        local: { cwd: ['/repo', '/other'], dirs: ['/extra'] },
        tools: [],
        disallowedTools: ['mcp'],
      }).success
    ).toBe(true);
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

  it('keeps subagentInherit out of the typed and validated local settings', () => {
    // @ts-expect-error subagentInherit is reachable only through sdkAgentOptions.local.
    const local: CursorLocalSettings = { subagentInherit: {} };
    expect(cursorSettingsSchema.safeParse({ local }).success).toBe(false);
  });

  it('keeps the SDK 1.4.0 executor, file-system, and bridge options out of local settings', () => {
    const excluded = [
      // @ts-expect-error resourceProviderOptions is reachable only through sdkAgentOptions.local.
      { resourceProviderOptions: {} },
      // @ts-expect-error reportedWorkspacePath is reachable only through sdkAgentOptions.local.
      { reportedWorkspacePath: '/' },
      // @ts-expect-error fs is reachable only through sdkAgentOptions.local.
      { fs: () => ({}) },
      // @ts-expect-error hostMcpBridgeUrls is reachable only through sdkAgentOptions.local.
      { hostMcpBridgeUrls: ['http://127.0.0.1:1'] },
    ] satisfies CursorLocalSettings[];
    for (const local of excluded) {
      expect(cursorSettingsSchema.safeParse({ local }).success).toBe(false);
    }
  });

  it('keeps the SDK-internal onMcpAuthRequest out of the typed and validated local settings', () => {
    // @ts-expect-error onMcpAuthRequest is reachable only through sdkAgentOptions.local.
    const local: CursorLocalSettings = { onMcpAuthRequest: async () => undefined };
    expect(cursorSettingsSchema.safeParse({ local }).success).toBe(false);
  });

  it('accepts a local connection-state listener and rejects a non-function', () => {
    const local: CursorLocalSettings = { onConnectionStateChange: () => undefined };
    expect(cursorSettingsSchema.parse({ local }).local).toEqual(local);
    expect(
      cursorSettingsSchema.safeParse({ local: { onConnectionStateChange: 'log' } }).success
    ).toBe(false);
  });

  it('accepts a trusted sandbox helper path and still rejects unknown sandbox keys', () => {
    const local: CursorLocalSettings = {
      sandboxOptions: { enabled: true, binaryPath: '/opt/cursor/cursorsandbox' },
    };
    expect(cursorSettingsSchema.parse({ local }).local).toEqual(local);
    // The helper path stays optional: the sandbox is usually enabled without one.
    const enabledOnly: CursorLocalSettings = { sandboxOptions: { enabled: true } };
    expect(cursorSettingsSchema.parse({ local: enabledOnly }).local).toEqual(enabledOnly);
    for (const sandboxOptions of [
      { enabled: true, binaryPath: 1 },
      { enabled: true, helperPath: '/opt/cursor/cursorsandbox' },
      { binaryPath: '/opt/cursor/cursorsandbox' },
    ]) {
      expect(cursorSettingsSchema.safeParse({ local: { sandboxOptions } }).success).toBe(false);
    }
  });

  it('accepts the SDK ModelSelection shape, including maxMode, for a subagent model', () => {
    const agents: CursorSettings['agents'] = {
      reviewer: {
        description: 'review',
        prompt: 'Review',
        model: { id: 'composer-2.5', params: [{ id: 'fast', value: 'true' }], maxMode: true },
      },
    };
    expect(cursorSettingsSchema.safeParse({ agents }).success).toBe(true);
    expect(
      cursorSettingsSchema.safeParse({
        agents: { reviewer: { ...agents.reviewer, model: { id: 'composer-2.5', maxMode: 'yes' } } },
      }).success
    ).toBe(false);
  });

  it('accepts only positive safe-integer team IDs', () => {
    expect(cursorSettingsSchema.safeParse({ teamId: 1 }).success).toBe(true);
    for (const teamId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, '42']) {
      expect(cursorSettingsSchema.safeParse({ teamId }).success).toBe(false);
    }
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
