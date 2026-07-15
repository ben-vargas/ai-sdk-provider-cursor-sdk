import { Agent, type AgentOptions, type SDKAgent } from '@cursor/sdk';
import type { Logger } from './logger.js';
import type { CursorProviderOptions, CursorSettings } from './settings.js';

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
      const agentPromise = this.resumeAgent(resumeId, options);
      const agent = await agentPromise;
      return this.scope(agent, false, () => {
        if (this.resumedAgents.get(resumeId) === agentPromise) {
          this.resumedAgents.delete(resumeId);
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

  private resumeAgent(agentId: string, options: AcquireAgentOptions): Promise<SDKAgent> {
    let agentPromise = this.resumedAgents.get(agentId);
    if (!agentPromise) {
      const resumeOptions = this.resumeOptions(agentId, options);
      agentPromise = this.track(
        Agent.resume(agentId, resumeOptions).then((agent) => this.own(agent))
      );
      this.resumedAgents.set(agentId, agentPromise);
      void agentPromise.catch(() => {
        if (this.resumedAgents.get(agentId) === agentPromise) {
          this.resumedAgents.delete(agentId);
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
    let local = settings.local ? { ...settings.local } : undefined;
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
      ...(settings.sdkAgentOptions ?? {}),
    };
  }

  private resumeOptions(agentId: string, options: AcquireAgentOptions): Partial<AgentOptions> {
    const { settings } = options;
    return {
      apiKey: options.apiKey,
      ...(settings.mcpServers ? { mcpServers: settings.mcpServers } : {}),
      ...(settings.agents ? { agents: settings.agents } : {}),
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
