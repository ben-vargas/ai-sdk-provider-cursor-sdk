import { readFileSync } from 'node:fs';
import type {
  AgentUsage,
  GetUsageOptions,
  InteractionUpdate,
  ModelSelection,
  Run,
  RunOperation,
  RunResult,
  RunStatus,
  SDKAgent,
  SDKUserMessage,
  SendOptions,
} from '@cursor/sdk';

export interface DeltaFixture {
  description: string;
  sendResolvesAfterEvents?: number;
  events: Array<{ update: InteractionUpdate }>;
  result: RunResult;
}

export function loadDeltaFixture(name: string): DeltaFixture {
  return JSON.parse(
    readFileSync(new URL(`./deltas/${name}.json`, import.meta.url), 'utf8')
  ) as DeltaFixture;
}

export function loadResultFixture(name: string): RunResult {
  return JSON.parse(
    readFileSync(new URL(`./results/${name}.json`, import.meta.url), 'utf8')
  ) as RunResult;
}

function cancelledResult(result: RunResult): RunResult {
  return {
    id: result.id,
    requestId: result.requestId,
    status: 'cancelled',
    model: result.model,
    durationMs: result.durationMs,
    usage: result.usage,
  };
}

export class FakeRun implements Run {
  readonly id: string;
  readonly requestId?: string;
  readonly agentId: string;
  readonly createdAt = 1_700_000_000_000;
  readonly cancelCalls: unknown[] = [];
  private currentResult: RunResult;
  private readonly completion: Promise<void>;
  private readonly supported = new Set<RunOperation>(['stream', 'wait', 'cancel', 'conversation']);

  constructor(args: {
    agentId: string;
    result: RunResult;
    completion?: Promise<void>;
    unsupported?: RunOperation[];
  }) {
    this.agentId = args.agentId;
    this.currentResult = structuredClone(args.result);
    this.id = this.currentResult.id;
    this.requestId = this.currentResult.requestId;
    this.completion = args.completion ?? Promise.resolve();
    for (const operation of args.unsupported ?? []) this.supported.delete(operation);
  }

  get status(): RunStatus {
    return this.currentResult.status;
  }

  get result(): string | undefined {
    return this.currentResult.result;
  }

  get error(): RunResult['error'] {
    return this.currentResult.error;
  }

  get model(): ModelSelection | undefined {
    return this.currentResult.model;
  }

  get durationMs(): number | undefined {
    return this.currentResult.durationMs;
  }

  get usage(): RunResult['usage'] {
    return this.currentResult.usage;
  }

  get git(): RunResult['git'] {
    return this.currentResult.git;
  }

  supports(operation: RunOperation): boolean {
    return this.supported.has(operation);
  }

  unsupportedReason(operation: RunOperation): string | undefined {
    return this.supports(operation) ? undefined : `${operation} disabled by fixture`;
  }

  async *stream(): AsyncGenerator<never, void> {
    yield* [];
  }

  conversation(): Promise<never[]> {
    return Promise.resolve([]);
  }

  async wait(): Promise<RunResult> {
    await this.completion;
    return structuredClone(this.currentResult);
  }

  async cancel(): Promise<void> {
    this.cancelCalls.push(undefined);
    this.currentResult = cancelledResult(this.currentResult);
  }

  onDidChangeStatus(_listener: (status: RunStatus) => void): () => void {
    return () => undefined;
  }
}

export interface FakeSDKAgentOptions {
  sendRejects?: unknown;
  delayMs?: number;
  unsupportedRunOperations?: RunOperation[];
  onSend?: (message: string | SDKUserMessage, options?: SendOptions) => void | Promise<void>;
}

export class FakeSDKAgent implements SDKAgent {
  readonly sent: Array<{ message: string | SDKUserMessage; options?: SendOptions }> = [];
  readonly closeCalls: unknown[] = [];
  readonly reloadCalls: unknown[] = [];
  readonly agentId: string;
  model: ModelSelection | undefined;
  lastRun?: FakeRun;

  constructor(
    readonly fixture: DeltaFixture,
    private readonly options: FakeSDKAgentOptions = {},
    agentId = 'agent-fixture'
  ) {
    this.agentId = agentId;
    this.model = fixture.result.model;
  }

  async send(message: string | SDKUserMessage, options?: SendOptions): Promise<Run> {
    this.sent.push({ message, options });
    await this.options.onSend?.(message, options);
    if (this.options.sendRejects !== undefined) throw this.options.sendRejects;
    this.model = options?.model ?? this.model;

    const split = Math.min(
      this.fixture.events.length,
      Math.max(0, this.fixture.sendResolvesAfterEvents ?? 0)
    );
    const emit = async (events: DeltaFixture['events']): Promise<void> => {
      for (const event of events) await options?.onDelta?.(event);
    };
    await emit(this.fixture.events.slice(0, split));
    const completion = emit(this.fixture.events.slice(split));
    const result = structuredClone(this.fixture.result);
    result.model ??= this.model;
    const run = new FakeRun({
      agentId: this.agentId,
      result,
      completion,
      unsupported: this.options.unsupportedRunOperations,
    });
    this.lastRun = run;
    if (this.options.delayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    }
    return run;
  }

  close(): void {
    this.closeCalls.push(undefined);
  }

  reload(): Promise<void> {
    this.reloadCalls.push(undefined);
    return Promise.resolve();
  }

  [Symbol.asyncDispose](): Promise<void> {
    this.close();
    return Promise.resolve();
  }

  listArtifacts(): Promise<never[]> {
    return Promise.resolve([]);
  }

  downloadArtifact(_path: string): Promise<Buffer> {
    return Promise.resolve(Buffer.alloc(0));
  }

  getUsage(_options?: GetUsageOptions): Promise<AgentUsage> {
    const usage = this.fixture.result.usage;
    return Promise.resolve({
      usage: usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      },
      runs: [],
    });
  }
}
