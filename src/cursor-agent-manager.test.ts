import { AgentNotFoundError } from '@cursor/sdk';
import {
  CursorAgentManager,
  resumeCacheKey,
  type AcquireAgentOptions,
} from './cursor-agent-manager.js';
import { noopLogger } from './logger.js';
import type { CursorSettings } from './settings.js';
import { FakeSDKAgent, loadDeltaFixture } from './__tests__/fixtures/fake-cursor-sdk.js';
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

function fakeAgent(agentId = 'agent-1'): FakeSDKAgent {
  return new FakeSDKAgent(loadDeltaFixture('text-only'), {}, agentId);
}

function acquireOptions(overrides: Partial<AcquireAgentOptions> = {}): AcquireAgentOptions {
  return {
    modelScope: {},
    modelId: 'composer-2.5',
    apiKey: 'cursor-key',
    settings: {},
    callOptions: {},
    ...overrides,
  };
}

describe('CursorAgentManager acquisition and ownership', () => {
  beforeEach(() => resetCursorSdkMock());

  it('creates a local agent explicitly and forwards every mapped creation setting', async () => {
    const agent = fakeAgent();
    mockAgentCreate.mockResolvedValue(agent);
    const manager = new CursorAgentManager(noopLogger);
    const customTool = { execute: vi.fn(() => 'ok') };
    const onConnectionStateChange = vi.fn();
    const sandboxOptions = { enabled: true, binaryPath: '/opt/cursor/cursorsandbox' };
    const scope = await manager.acquire(
      acquireOptions({
        settings: {
          agentName: 'Provider agent',
          teamId: 42,
          mode: 'plan',
          local: {
            cwd: '/repo',
            dirs: ['/extra'],
            autoReview: true,
            sandboxOptions,
            onConnectionStateChange,
          },
          customTools: { custom: customTool },
          tools: ['shell', 'read'],
          disallowedTools: ['delete'],
          mcpServers: { docs: { command: 'node', args: ['server.mjs'] } },
          agents: { reviewer: { description: 'review', prompt: 'Review' } },
          modelParams: [{ id: 'fast', value: 'false' }],
        },
        callOptions: {
          mode: 'agent',
          modelParams: [{ id: 'fast', value: 'true' }],
        },
      })
    );
    expect(scope.agent).toBe(agent);
    expect(scope.callScoped).toBe(false);
    expect(mockAgentCreate).toHaveBeenCalledWith({
      model: { id: 'composer-2.5', params: [{ id: 'fast', value: 'true' }] },
      apiKey: 'cursor-key',
      name: 'Provider agent',
      teamId: 42,
      mode: 'agent',
      local: {
        cwd: '/repo',
        dirs: ['/extra'],
        autoReview: true,
        sandboxOptions,
        onConnectionStateChange,
        customTools: { custom: customTool },
      },
      tools: ['shell', 'read'],
      disallowedTools: ['delete'],
      mcpServers: { docs: { command: 'node', args: ['server.mjs'] } },
      agents: { reviewer: { description: 'review', prompt: 'Review' } },
    });
  });

  it('migrates a legacy cwd array to cwd + dirs before calling the SDK', async () => {
    mockAgentCreate.mockResolvedValue(fakeAgent());
    const manager = new CursorAgentManager(noopLogger);
    await manager.acquire(
      acquireOptions({
        settings: { local: { cwd: ['/repo', '/other'], dirs: ['/extra'] } },
      })
    );
    expect(mockAgentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        // Documented precedence: migrated `cwd` array extras first, explicit `dirs` after them.
        local: { cwd: '/repo', dirs: ['/other', '/extra'] },
      })
    );
    const passed = mockAgentCreate.mock.calls[0]?.[0] as { local?: { cwd?: unknown } };
    expect(Array.isArray(passed.local?.cwd)).toBe(false);
  });

  it('passes an empty tools allow-list through to Agent.create', async () => {
    mockAgentCreate.mockResolvedValue(fakeAgent());
    const manager = new CursorAgentManager(noopLogger);
    await manager.acquire(acquireOptions({ settings: { tools: [] } }));
    expect(mockAgentCreate.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ tools: [] }));
  });

  it('forwards cloud metadata and openAsCursorGithubApp', async () => {
    mockAgentCreate.mockResolvedValue(fakeAgent('bc-cloud'));
    const manager = new CursorAgentManager(noopLogger);
    await manager.acquire(
      acquireOptions({
        settings: {
          cloud: {
            repos: [{ url: 'https://example.test/repo' }],
            metadata: { team: 'platform' },
            openAsCursorGithubApp: true,
          },
        },
      })
    );
    expect(mockAgentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        cloud: {
          repos: [{ url: 'https://example.test/repo' }],
          metadata: { team: 'platform' },
          openAsCursorGithubApp: true,
        },
      })
    );
  });

  it('passes explicit local empty options when no runtime is configured', async () => {
    mockAgentCreate.mockResolvedValue(fakeAgent());
    const manager = new CursorAgentManager(noopLogger);
    await manager.acquire(acquireOptions());
    expect(mockAgentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ local: {}, mode: 'agent' })
    );
    expect(mockAgentCreate.mock.calls[0]?.[0]).not.toHaveProperty('cloud');
  });

  it('passes cloud settings without a local key', async () => {
    mockAgentCreate.mockResolvedValue(fakeAgent('bc-cloud'));
    const manager = new CursorAgentManager(noopLogger);
    await manager.acquire(
      acquireOptions({ settings: { cloud: { repos: [{ url: 'https://example.test/repo' }] } } })
    );
    expect(mockAgentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ cloud: { repos: [{ url: 'https://example.test/repo' }] } })
    );
    expect(mockAgentCreate.mock.calls[0]?.[0]).not.toHaveProperty('local');
  });

  it('resumes by per-call ID before settings ID and re-passes ephemeral config', async () => {
    const agent = fakeAgent('agent-call');
    mockAgentResume.mockResolvedValue(agent);
    const manager = new CursorAgentManager(noopLogger);
    const scope = await manager.acquire(
      acquireOptions({
        settings: {
          agentId: 'agent-settings',
          teamId: 42,
          mcpServers: { docs: { command: 'docs' } },
          agents: { reviewer: { description: 'review', prompt: 'Review' } },
          tools: [],
          disallowedTools: ['mcp'],
          sdkAgentOptions: { name: 'resume name' },
        },
        callOptions: { agentId: 'agent-call' },
      })
    );
    expect(scope.agent).toBe(agent);
    expect(mockAgentResume).toHaveBeenCalledWith('agent-call', {
      apiKey: 'cursor-key',
      teamId: 42,
      mcpServers: { docs: { command: 'docs' } },
      agents: { reviewer: { description: 'review', prompt: 'Review' } },
      tools: [],
      disallowedTools: ['mcp'],
      name: 'resume name',
    });
    expect(mockAgentCreate).not.toHaveBeenCalled();
  });

  it('reuses one cached agent per model scope and one resumed handle per matching resume key', async () => {
    const created = fakeAgent('agent-created');
    const resumed = fakeAgent('agent-resumed');
    mockAgentCreate.mockResolvedValue(created);
    mockAgentResume.mockResolvedValue(resumed);
    const manager = new CursorAgentManager(noopLogger);
    const modelScope = {};

    expect((await manager.acquire(acquireOptions({ modelScope }))).agent).toBe(created);
    expect((await manager.acquire(acquireOptions({ modelScope }))).agent).toBe(created);
    expect(mockAgentCreate).toHaveBeenCalledTimes(1);
    expect(manager.hasCachedModelAgent(modelScope)).toBe(true);

    expect(
      (await manager.acquire(acquireOptions({ callOptions: { agentId: 'agent-resumed' } }))).agent
    ).toBe(resumed);
    expect(
      (await manager.acquire(acquireOptions({ callOptions: { agentId: 'agent-resumed' } }))).agent
    ).toBe(resumed);
    expect(mockAgentResume).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a resumed handle when tools or disallowedTools differ', async () => {
    const unrestricted = fakeAgent('agent-shared');
    const allowNone = fakeAgent('agent-shared');
    const denied = fakeAgent('agent-shared');
    const allowListed = fakeAgent('agent-shared');
    mockAgentResume
      .mockResolvedValueOnce(unrestricted)
      .mockResolvedValueOnce(allowNone)
      .mockResolvedValueOnce(denied)
      .mockResolvedValueOnce(allowListed);
    const manager = new CursorAgentManager(noopLogger);

    const first = await manager.acquire(
      acquireOptions({ callOptions: { agentId: 'agent-shared' } })
    );
    const second = await manager.acquire(
      acquireOptions({
        callOptions: { agentId: 'agent-shared' },
        settings: { tools: [] },
      })
    );
    const third = await manager.acquire(
      acquireOptions({
        callOptions: { agentId: 'agent-shared' },
        settings: { disallowedTools: ['shell'] },
      })
    );
    const reusedAllowNone = await manager.acquire(
      acquireOptions({
        callOptions: { agentId: 'agent-shared' },
        settings: { tools: [] },
      })
    );
    const reusedOrdered = await manager.acquire(
      acquireOptions({
        callOptions: { agentId: 'agent-shared' },
        settings: { tools: ['read', 'shell'] },
      })
    );
    const reusedReordered = await manager.acquire(
      acquireOptions({
        callOptions: { agentId: 'agent-shared' },
        settings: { tools: ['shell', 'read'] },
      })
    );

    expect(first.agent).toBe(unrestricted);
    expect(second.agent).toBe(allowNone);
    expect(third.agent).toBe(denied);
    expect(reusedAllowNone.agent).toBe(allowNone);
    expect(reusedOrdered.agent).toBe(allowListed);
    expect(reusedReordered.agent).toBe(allowListed);
    expect(mockAgentResume).toHaveBeenCalledTimes(4);
    expect(mockAgentResume).toHaveBeenNthCalledWith(1, 'agent-shared', { apiKey: 'cursor-key' });
    expect(mockAgentResume).toHaveBeenNthCalledWith(2, 'agent-shared', {
      apiKey: 'cursor-key',
      tools: [],
    });
    expect(mockAgentResume).toHaveBeenNthCalledWith(3, 'agent-shared', {
      apiKey: 'cursor-key',
      disallowedTools: ['shell'],
    });
    expect(resumeCacheKey('agent-shared', { tools: ['read', 'shell'] })).toBe(
      resumeCacheKey('agent-shared', { tools: ['shell', 'read'] })
    );
    expect(resumeCacheKey('agent-shared', {})).not.toBe(
      resumeCacheKey('agent-shared', { tools: [] })
    );
  });

  it('separates resumed handles by subagentInherit identity', () => {
    const inherit = { reportedWorkspacePath: '/' };
    const withInherit = (subagentInherit: object) => ({
      sdkAgentOptions: { local: { subagentInherit } },
    });
    expect(resumeCacheKey('agent-shared', withInherit(inherit))).toBe(
      resumeCacheKey('agent-shared', withInherit(inherit))
    );
    expect(resumeCacheKey('agent-shared', withInherit(inherit))).not.toBe(
      resumeCacheKey('agent-shared', withInherit({ reportedWorkspacePath: '/' }))
    );
    expect(resumeCacheKey('agent-shared', withInherit(inherit))).not.toBe(
      resumeCacheKey('agent-shared', {})
    );
  });

  it('separates resumed handles by team ID, including the escape-hatch override', () => {
    const key = (settings: CursorSettings) => resumeCacheKey('agent-shared', settings);
    expect(key({ teamId: 1 })).toBe(key({ teamId: 1 }));
    expect(key({ teamId: 1 })).not.toBe(key({ teamId: 2 }));
    expect(key({ teamId: 1 })).not.toBe(key({}));
    expect(key({ teamId: 1, sdkAgentOptions: { teamId: 2 } })).toBe(key({ teamId: 2 }));
  });

  it('separates resumed handles by executor and file-system identity and workspace path', () => {
    const withLocal = (local: Record<string, unknown>): CursorSettings => ({
      sdkAgentOptions: { local },
    });
    const key = (local: Record<string, unknown>) =>
      resumeCacheKey('agent-shared', withLocal(local));
    const fs = () => ({}) as never;
    const resourceProviderOptions = {};
    for (const [name, value, other] of [
      ['fs', fs, () => ({}) as never],
      ['resourceProviderOptions', resourceProviderOptions, {}],
      ['reportedWorkspacePath', '/repo', '/other'],
    ] as const) {
      expect(key({ [name]: value })).toBe(key({ [name]: value }));
      expect(key({ [name]: value })).not.toBe(key({ [name]: other }));
      expect(key({ [name]: value })).not.toBe(key({}));
    }
  });

  it('separates resumed handles by MCP sign-in handler and connection listener identity', () => {
    type ResumeLocal = NonNullable<CursorSettings['sdkAgentOptions']>['local'];
    const key = (local: ResumeLocal) =>
      resumeCacheKey('agent-shared', { sdkAgentOptions: { local } });
    const onMcpAuthRequest = async () => undefined;
    const onConnectionStateChange = () => undefined;

    expect(key({ onMcpAuthRequest })).toBe(key({ onMcpAuthRequest }));
    expect(key({ onMcpAuthRequest })).not.toBe(key({ onMcpAuthRequest: async () => undefined }));
    expect(key({ onMcpAuthRequest })).not.toBe(key({}));

    expect(key({ onConnectionStateChange })).toBe(key({ onConnectionStateChange }));
    expect(key({ onConnectionStateChange })).not.toBe(
      key({ onConnectionStateChange: () => undefined })
    );
    expect(key({ onConnectionStateChange })).not.toBe(key({}));
    // Creation-time `settings.local` is not sent on resume, so its listener must not split handles.
    expect(resumeCacheKey('agent-shared', { local: { onConnectionStateChange } })).toBe(
      resumeCacheKey('agent-shared', {})
    );
  });

  it('resumes a separate handle when host MCP bridge URLs change or are removed', async () => {
    const withBridges = fakeAgent('agent-shared');
    const otherBridges = fakeAgent('agent-shared');
    const noBridges = fakeAgent('agent-shared');
    mockAgentResume
      .mockResolvedValueOnce(withBridges)
      .mockResolvedValueOnce(otherBridges)
      .mockResolvedValueOnce(noBridges);
    const manager = new CursorAgentManager(noopLogger);
    const acquire = (hostMcpBridgeUrls?: string[]) =>
      manager.acquire(
        acquireOptions({
          callOptions: { agentId: 'agent-shared' },
          settings: hostMcpBridgeUrls ? { sdkAgentOptions: { local: { hostMcpBridgeUrls } } } : {},
        })
      );
    const a = 'http://127.0.0.1:9001';
    const b = 'http://127.0.0.1:9002';

    expect((await acquire([a, b])).agent).toBe(withBridges);
    expect((await acquire([b, a])).agent).toBe(withBridges);
    expect((await acquire([b])).agent).toBe(otherBridges);
    expect((await acquire()).agent).toBe(noBridges);
    expect(mockAgentResume).toHaveBeenCalledTimes(3);
    expect(mockAgentResume.mock.calls.map(([, options]) => options.local)).toEqual([
      { hostMcpBridgeUrls: [a, b] },
      { hostMcpBridgeUrls: [b] },
      undefined,
    ]);
  });

  it('uses injected agents without taking ownership', async () => {
    const injected = fakeAgent('agent-injected');
    const manager = new CursorAgentManager(noopLogger);
    const scope = await manager.acquire(acquireOptions({ settings: { agent: injected } }));
    expect(scope.agent).toBe(injected);
    await scope.release();
    await manager.close();
    expect(injected.closeCalls).toHaveLength(0);
    expect(mockAgentCreate).not.toHaveBeenCalled();
  });

  it('closes createNewAgentPerCall agents exactly once when their scope is released', async () => {
    const agent = fakeAgent();
    mockAgentCreate.mockResolvedValue(agent);
    const manager = new CursorAgentManager(noopLogger);
    const scope = await manager.acquire(
      acquireOptions({ settings: { createNewAgentPerCall: true } })
    );
    expect(scope.callScoped).toBe(true);
    await scope.release();
    await scope.release();
    await manager.close();
    expect(agent.closeCalls).toHaveLength(1);
  });

  it('evicts failed model creation and stale resume promises so later calls retry', async () => {
    const manager = new CursorAgentManager(noopLogger);
    const modelScope = {};
    mockAgentCreate
      .mockRejectedValueOnce(new Error('create failed'))
      .mockResolvedValueOnce(fakeAgent('agent-created'));
    await expect(manager.acquire(acquireOptions({ modelScope }))).rejects.toThrow('create failed');
    await expect(manager.acquire(acquireOptions({ modelScope }))).resolves.toMatchObject({
      agent: expect.objectContaining({ agentId: 'agent-created' }),
    });
    expect(mockAgentCreate).toHaveBeenCalledTimes(2);

    mockAgentResume
      .mockRejectedValueOnce(new AgentNotFoundError('missing'))
      .mockResolvedValueOnce(fakeAgent('agent-resumed'));
    const resumeOptions = acquireOptions({ callOptions: { agentId: 'agent-resumed' } });
    await expect(manager.acquire(resumeOptions)).rejects.toThrow('missing');
    await expect(manager.acquire(resumeOptions)).resolves.toMatchObject({
      agent: expect.objectContaining({ agentId: 'agent-resumed' }),
    });
    expect(mockAgentResume).toHaveBeenCalledTimes(2);
  });

  it('waits for pending creation, closes owned agents, and is idempotent', async () => {
    const gate = deferred<FakeSDKAgent>();
    const agent = fakeAgent();
    mockAgentCreate.mockReturnValue(gate.promise);
    const manager = new CursorAgentManager(noopLogger);
    const acquisition = manager.acquire(acquireOptions());
    const closing = manager.close();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    gate.resolve(agent);
    await acquisition;
    await closing;
    await manager.close();
    expect(agent.closeCalls).toHaveLength(1);
  });
});

describe('CursorAgentManager send mutex', () => {
  beforeEach(() => resetCursorSdkMock());

  it('serializes sends for the same agent ID', async () => {
    const manager = new CursorAgentManager(noopLogger);
    const agent = fakeAgent('shared-agent');
    const gate = deferred();
    const order: string[] = [];
    const first = manager.serialize(agent, undefined, async () => {
      order.push('first:start');
      await gate.promise;
      order.push('first:end');
    });
    await Promise.resolve();
    const second = manager.serialize(agent, undefined, async () => {
      order.push('second:start');
      order.push('second:end');
    });
    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('allows distinct agents to run in parallel', async () => {
    const manager = new CursorAgentManager(noopLogger);
    const gate = deferred();
    const order: string[] = [];
    const first = manager.serialize(fakeAgent('agent-a'), undefined, async () => {
      order.push('a');
      await gate.promise;
    });
    const second = manager.serialize(fakeAgent('agent-b'), undefined, async () => {
      order.push('b');
      await gate.promise;
    });
    await Promise.resolve();
    expect(order).toEqual(['a', 'b']);
    gate.resolve();
    await Promise.all([first, second]);
  });

  it('dequeues an aborted waiter without invoking its task', async () => {
    const manager = new CursorAgentManager(noopLogger);
    const agent = fakeAgent('shared-agent');
    const gate = deferred();
    const first = manager.serialize(agent, undefined, async () => gate.promise);
    await Promise.resolve();
    const controller = new AbortController();
    const reason = new Error('queued abort');
    const task = vi.fn(async () => undefined);
    const second = manager.serialize(agent, controller.signal, task);
    controller.abort(reason);
    await expect(second).rejects.toBe(reason);
    expect(task).not.toHaveBeenCalled();
    gate.resolve();
    await first;
  });

  it('rejects already-aborted signals before taking the mutex', async () => {
    const manager = new CursorAgentManager(noopLogger);
    const controller = new AbortController();
    const reason = new Error('already aborted');
    controller.abort(reason);
    const task = vi.fn(async () => undefined);
    await expect(manager.serialize(fakeAgent(), controller.signal, task)).rejects.toBe(reason);
    expect(task).not.toHaveBeenCalled();
  });
});
