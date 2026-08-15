import { Agent, type AgentOptions, type LocalAgentOptions, type SDKAgent } from '@cursor/sdk';
import type { Logger } from './logger.js';
import type { CursorLocalSettings, CursorProviderOptions, CursorSettings } from './settings.js';

/**
 * `@cursor/sdk` 1.0.24+ accepts only a string `cwd`. Provider settings still
 * allow `string[]` so existing callers keep working; extra entries become
 * additional `dirs` workspace roots.
 */
export function toSdkLocalOptions(local: CursorLocalSettings): LocalAgentOptions {
  const { cwd, dirs, ...rest } = local;
  if (!Array.isArray(cwd)) {
    return {
      ...rest,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(dirs !== undefined ? { dirs } : {}),
    };
  }
  const [primary, ...additional] = cwd;
  // Documented order (docs/configuration.md): the legacy array's extra entries stay adjacent to
  // their `cwd`, and explicit `dirs` merge after them.
  const mergedDirs = [...additional, ...(dirs ?? [])];
  return {
    ...rest,
    ...(primary !== undefined ? { cwd: primary } : {}),
    ...(mergedDirs.length > 0 ? { dirs: mergedDirs } : dirs !== undefined ? { dirs } : {}),
  };
}

export interface AcquireAgentOptions {
  modelScope: object;
  modelId: string;
  apiKey: string;
  settings: CursorSettings;
  callOptions: CursorProviderOptions;
}

export interface CursorAgentCallScope {
  readonly agent: SDKAgent;
  readonly callScoped: boolean;
  invalidate(): void;
  release(): Promise<void>;
}

interface MutexWaiter {
  resolve(): void;
  reject(error: unknown): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface MutexState {
  locked: boolean;
  waiters: MutexWaiter[];
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
}

/**
 * Resume-handle cache identity: canonical JSON of `agentId` plus every option
 * actually forwarded to `Agent.resume`, except `apiKey`.
 *
 * The SDK does not persist `tools` / `disallowedTools` / `mcpServers` /
 * `agents` / `sdkAgentOptions` across resume, so two acquires that share an
 * agent ID but differ in those fields must not reuse one handle. Same agent ID
 * + same restrictions still hit the cache.
 *
 * `apiKey` is omitted so the key is not a secret and equivalent auth does not
 * fragment the cache; the live handle already used the first resume's key.
 * Object keys are sorted so insertion order cannot miss; array order is kept
 * because it is forwarded as-is. Non-JSON values (functions) are dropped.
 */
function resumeCacheKey(agentId: string, resumeOptions: Partial<AgentOptions>): string {
  const forwarded = { ...resumeOptions };
  delete forwarded.apiKey;
  return stableStringify({ agentId, ...forwarded });
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item) ?? null);
  }
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const next = canonicalize(source[key]);
    if (next !== undefined) result[key] = next;
  }
  return result;
}

export class CursorAgentManager {
  private resumedAgents = new Map<string, Promise<SDKAgent>>();
  private modelAgents = new WeakMap<object, Promise<SDKAgent>>();
  private readonly ownedAgents = new Set<SDKAgent>();
  private readonly pendingAgents = new Set<Promise<SDKAgent>>();
  private readonly mutexes = new Map<string, MutexState>();

  constructor(private readonly logger: Logger) {}

  hasCachedModelAgent(modelScope: object): boolean {
    return this.modelAgents.has(modelScope);
  }

  async acquire(options: AcquireAgentOptions): Promise<CursorAgentCallScope> {
    const resumeId = options.callOptions.agentId ?? options.settings.agentId;
    if (resumeId) {
      const cacheKey = resumeCacheKey(resumeId, this.resumeOptions(resumeId, options));
      const agentPromise = this.resumeAgent(cacheKey, resumeId, options);
      const agent = await agentPromise;
      return this.scope(agent, false, () => {
        if (this.resumedAgents.get(cacheKey) === agentPromise) {
          this.resumedAgents.delete(cacheKey);
        }
      });
    }
    if (options.settings.agent) return this.scope(options.settings.agent, false);
    if (options.settings.createNewAgentPerCall) {
      const agent = await this.createAgent(options);
      return this.scope(agent, true);
    }

    let agentPromise = this.modelAgents.get(options.modelScope);
    if (!agentPromise) {
      agentPromise = this.createAgent(options);
      this.modelAgents.set(options.modelScope, agentPromise);
      void agentPromise.catch(() => {
        if (this.modelAgents.get(options.modelScope) === agentPromise) {
          this.modelAgents.delete(options.modelScope);
        }
      });
    }
    const agent = await agentPromise;
    return this.scope(agent, false, () => {
      if (this.modelAgents.get(options.modelScope) === agentPromise) {
        this.modelAgents.delete(options.modelScope);
      }
    });
  }

  async serialize<T>(
    agent: SDKAgent,
    signal: AbortSignal | undefined,
    task: () => Promise<T>
  ): Promise<T> {
    const release = await this.acquireMutex(agent, signal);
    try {
      if (signal?.aborted) throw abortReason(signal);
      return await task();
    } finally {
      release();
    }
  }

  async close(): Promise<void> {
    const pending = [...this.pendingAgents];
    if (pending.length > 0) await Promise.allSettled(pending);
    const agents = [...this.ownedAgents];
    this.ownedAgents.clear();
    this.resumedAgents.clear();
    this.modelAgents = new WeakMap();
    for (const agent of agents) this.closeAgent(agent);
  }

  private resumeAgent(
    cacheKey: string,
    agentId: string,
    options: AcquireAgentOptions
  ): Promise<SDKAgent> {
    let agentPromise = this.resumedAgents.get(cacheKey);
    if (!agentPromise) {
      const resumeOptions = this.resumeOptions(agentId, options);
      agentPromise = this.track(
        Agent.resume(agentId, resumeOptions).then((agent) => this.own(agent))
      );
      this.resumedAgents.set(cacheKey, agentPromise);
      void agentPromise.catch(() => {
        if (this.resumedAgents.get(cacheKey) === agentPromise) {
          this.resumedAgents.delete(cacheKey);
        }
      });
    }
    return agentPromise;
  }

  private async createAgent(options: AcquireAgentOptions): Promise<SDKAgent> {
    return this.track(Agent.create(this.createOptions(options)).then((agent) => this.own(agent)));
  }

  private createOptions(options: AcquireAgentOptions): AgentOptions {
    const { settings, callOptions } = options;
    let local = settings.local ? toSdkLocalOptions(settings.local) : undefined;
    if (settings.customTools) local = { ...local, customTools: settings.customTools };
    const runtime = settings.cloud
      ? { cloud: settings.cloud }
      : { local: local ?? ({} as NonNullable<AgentOptions['local']>) };
    return {
      model: {
        id: options.modelId,
        params: callOptions.modelParams ?? settings.modelParams,
      },
      apiKey: options.apiKey,
      ...(settings.agentName ? { name: settings.agentName } : {}),
      mode: callOptions.mode ?? settings.mode ?? 'agent',
      ...runtime,
      ...(settings.mcpServers ? { mcpServers: settings.mcpServers } : {}),
      ...(settings.agents ? { agents: settings.agents } : {}),
      ...(settings.tools !== undefined ? { tools: settings.tools } : {}),
      ...(settings.disallowedTools !== undefined
        ? { disallowedTools: settings.disallowedTools }
        : {}),
      ...(settings.sdkAgentOptions ?? {}),
    };
  }

  private resumeOptions(agentId: string, options: AcquireAgentOptions): Partial<AgentOptions> {
    const { settings } = options;
    return {
      apiKey: options.apiKey,
      ...(settings.mcpServers ? { mcpServers: settings.mcpServers } : {}),
      ...(settings.agents ? { agents: settings.agents } : {}),
      ...(settings.tools !== undefined ? { tools: settings.tools } : {}),
      ...(settings.disallowedTools !== undefined
        ? { disallowedTools: settings.disallowedTools }
        : {}),
      ...(settings.sdkAgentOptions ?? {}),
    };
  }

  private own(agent: SDKAgent): SDKAgent {
    this.ownedAgents.add(agent);
    return agent;
  }

  private track(promise: Promise<SDKAgent>): Promise<SDKAgent> {
    this.pendingAgents.add(promise);
    void promise.finally(() => this.pendingAgents.delete(promise)).catch(() => undefined);
    return promise;
  }

  private scope(
    agent: SDKAgent,
    callScoped: boolean,
    invalidate: () => void = () => undefined
  ): CursorAgentCallScope {
    let released = false;
    return {
      agent,
      callScoped,
      invalidate,
      release: async () => {
        if (released) return;
        released = true;
        if (callScoped) {
          this.ownedAgents.delete(agent);
          this.closeAgent(agent);
        }
      },
    };
  }

  private closeAgent(agent: SDKAgent): void {
    try {
      agent.close();
    } catch (error) {
      this.logger.warn('Failed to close a Cursor SDK agent.', error);
    }
  }

  private async acquireMutex(agent: SDKAgent, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw abortReason(signal);
    const agentId = agent.agentId;
    let state = this.mutexes.get(agentId);
    if (!state) {
      state = { locked: false, waiters: [] };
      this.mutexes.set(agentId, state);
    }
    if (!state.locked) {
      state.locked = true;
      return () => this.releaseMutex(agentId, state);
    }

    await new Promise<void>((resolve, reject) => {
      const waiter: MutexWaiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = state.waiters.indexOf(waiter);
          if (index >= 0) state.waiters.splice(index, 1);
          reject(abortReason(signal));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      state.waiters.push(waiter);
    });
    return () => this.releaseMutex(agentId, state);
  }

  private releaseMutex(agentId: string, state: MutexState): void {
    while (state.waiters.length > 0) {
      const waiter = state.waiters.shift();
      if (!waiter) break;
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }
      if (waiter.signal?.aborted) {
        waiter.reject(abortReason(waiter.signal));
        continue;
      }
      waiter.resolve();
      return;
    }
    state.locked = false;
    this.mutexes.delete(agentId);
  }
}
