import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  SharedV3Warning,
} from '@ai-sdk/provider';
import { loadApiKey } from '@ai-sdk/provider-utils';
import {
  AgentNotFoundError,
  UnsupportedRunOperationError,
  type InteractionUpdate,
  type Run,
  type SendOptions,
} from '@cursor/sdk';
import { CursorAgentManager, type CursorAgentCallScope } from './cursor-agent-manager.js';
import { convertToCursorMessage } from './convert-to-cursor-message.js';
import { mapCursorError, type CursorErrorContext } from './errors.js';
import { getLogger, type Logger } from './logger.js';
import { CursorV3StreamEmitter } from './map-v3-events.js';
import { reduceCursorStream } from './reduce-stream.js';
import type { CursorProviderOptions, CursorSettings } from './settings.js';
import type { CursorModelId } from './types.js';
import {
  parseCursorProviderOptions,
  validateCursorModelId,
  validateCursorSettings,
} from './validation.js';
import { generateAllWarnings } from './warnings.js';

export interface CursorLanguageModelOptions {
  id: CursorModelId;
  settings: CursorSettings;
  agentManager: CursorAgentManager;
  logger: Logger;
}

interface DeltaQueueEntry {
  update: InteractionUpdate;
  acknowledge(): void;
  reject(error: unknown): void;
}

class AsyncDeltaQueue {
  private readonly entries: DeltaQueueEntry[] = [];
  private readonly readers: Array<{
    resolve(entry: DeltaQueueEntry | undefined): void;
    reject(error: unknown): void;
  }> = [];
  private closed = false;
  private failed = false;
  private failure?: unknown;

  push(update: InteractionUpdate): Promise<void> {
    if (this.failed) return Promise.reject(this.failure);
    if (this.closed) return Promise.reject(new Error('Cursor delta queue is closed.'));
    return new Promise<void>((resolve, reject) => {
      const entry = { update, acknowledge: resolve, reject };
      const reader = this.readers.shift();
      if (reader) reader.resolve(entry);
      else this.entries.push(entry);
    });
  }

  take(): Promise<DeltaQueueEntry | undefined> {
    if (this.entries.length > 0) return Promise.resolve(this.entries.shift());
    if (this.failed) return Promise.reject(this.failure);
    if (this.closed) return Promise.resolve(undefined);
    return new Promise<DeltaQueueEntry | undefined>((resolve, reject) => {
      this.readers.push({ resolve, reject });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const reader of this.readers.splice(0)) reader.resolve(undefined);
  }

  fail(error: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.failure = error;
    this.closed = true;
    for (const entry of this.entries.splice(0)) entry.reject(error);
    for (const reader of this.readers.splice(0)) reader.reject(error);
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onLateResolve?: (value: T) => void | Promise<void>
): Promise<T> {
  if (!signal) return promise;

  const handleLateResolution = (): void => {
    if (!onLateResolve) return;
    void promise.then(onLateResolve, () => undefined).catch(() => undefined);
  };

  if (signal.aborted) {
    handleLateResolution();
    return Promise.reject(abortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      handleLateResolution();
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

function waitForRun(run: Run, signal: AbortSignal): ReturnType<Run['wait']> {
  return raceWithAbort(run.wait(), signal);
}

export class CursorLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider = 'cursor-sdk';
  readonly supportedUrls = { 'image/*': [/^https?:\/\/.+$/] };
  readonly modelId: string;

  private readonly settings: CursorSettings;
  private readonly agentManager: CursorAgentManager;
  private readonly logger: Logger;
  private readonly modelScope = {};

  constructor(options: CursorLanguageModelOptions) {
    this.modelId = validateCursorModelId(options.id);
    this.settings = validateCursorSettings(options.settings);
    this.agentManager = options.agentManager;
    this.logger = getLogger(
      this.settings.logger === undefined ? options.logger : this.settings.logger,
      this.settings.verbose
    );
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const { stream } = await this.doStream(options);
    return reduceCursorStream(stream);
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const callOptions = this.callOptions(options);
    const warnings = generateAllWarnings(options, this.settings);
    const converted = convertToCursorMessage(options.prompt, {
      promptHistoryMode: this.settings.promptHistoryMode ?? 'reject',
      systemMessageMode: this.settings.systemMessageMode ?? 'reject',
      isSessionContinuation:
        Boolean(callOptions.agentId ?? this.settings.agentId ?? this.settings.agent) ||
        this.agentManager.hasCachedModelAgent(this.modelScope),
    });
    warnings.push(...converted.warnings);
    const apiKey = loadApiKey({
      apiKey: this.settings.apiKey,
      environmentVariableName: 'CURSOR_API_KEY',
      description: 'Cursor',
    });
    throwIfAborted(options.abortSignal);

    const context: CursorErrorContext = {
      operation: (callOptions.agentId ?? this.settings.agentId) ? 'agent.resume' : 'agent.create',
      modelId: this.modelId,
      agentId: callOptions.agentId ?? this.settings.agentId,
      promptExcerpt: converted.message.text.slice(0, 200),
    };

    let scope: CursorAgentCallScope | undefined;
    try {
      scope = await raceWithAbort(
        this.agentManager.acquire({
          modelScope: this.modelScope,
          modelId: this.modelId,
          apiKey,
          settings: this.settings,
          callOptions,
        }),
        options.abortSignal,
        async (lateScope) => lateScope.release()
      );
      throwIfAborted(options.abortSignal);
    } catch (error) {
      if (options.abortSignal?.aborted) {
        await scope?.release();
        throw abortReason(options.abortSignal);
      }
      throw mapCursorError(error, context);
    }

    if (!scope) throw new Error('Cursor agent acquisition did not return a scope.');

    const internalAbort = new AbortController();
    const forwardAbort = (): void => internalAbort.abort(options.abortSignal?.reason);
    if (options.abortSignal?.aborted) forwardAbort();
    else options.abortSignal?.addEventListener('abort', forwardAbort, { once: true });

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: (controller) => {
        const emitter = new CursorV3StreamEmitter(
          controller,
          Boolean(options.includeRawChunks),
          Boolean(this.settings.experimentalPreliminaryToolResults),
          (warning) => this.logCompatibilityWarning(warning)
        );
        emitter.emitStart(warnings);
        void this.agentManager
          .serialize(scope.agent, internalAbort.signal, async () => {
            await this.runStream({
              scope,
              callOptions,
              convertedMessage: converted.message,
              signal: internalAbort.signal,
              emitter,
              context,
            });
          })
          .then(() => emitter.close())
          .catch((error: unknown) => {
            if (internalAbort.signal.aborted) {
              emitter.error(abortReason(internalAbort.signal));
              return;
            }
            const mapped = mapCursorError(error, context);
            emitter.emitError(mapped);
            emitter.close();
          })
          .finally(async () => {
            options.abortSignal?.removeEventListener('abort', forwardAbort);
            await scope.release();
          });
      },
      cancel: (reason) => {
        if (!internalAbort.signal.aborted) internalAbort.abort(reason);
      },
    });

    return { stream };
  }

  private callOptions(options: LanguageModelV3CallOptions): CursorProviderOptions {
    return parseCursorProviderOptions(options.providerOptions?.cursor);
  }

  private async runStream(args: {
    scope: CursorAgentCallScope;
    callOptions: CursorProviderOptions;
    convertedMessage: Parameters<CursorAgentCallScope['agent']['send']>[0];
    signal: AbortSignal;
    emitter: CursorV3StreamEmitter;
    context: CursorErrorContext;
  }): Promise<void> {
    const queue = new AsyncDeltaQueue();
    let run: Run | undefined;
    let operation = 'agent.send';
    let cancelPromise: Promise<void> | undefined;
    const cancelRun = (): void => {
      if (!run || cancelPromise) return;
      cancelPromise = this.cancelRun(run);
    };
    const onAbort = (): void => cancelRun();
    args.signal.addEventListener('abort', onAbort, { once: true });

    const drainPromise = this.drainDeltas(queue, args.emitter);
    void drainPromise.catch(() => undefined);
    try {
      throwIfAborted(args.signal);
      const mode = args.callOptions.mode ?? this.settings.mode;
      const sendOptions: SendOptions = {
        model: {
          id: this.modelId,
          params: args.callOptions.modelParams ?? this.settings.modelParams,
        },
        ...(mode === undefined ? {} : { mode }),
        idempotencyKey: args.callOptions.idempotencyKey ?? this.settings.idempotencyKey,
        onDelta: async ({ update }) => {
          this.settings.onDeltaEvent?.(update);
          await queue.push(update);
        },
        ...(args.callOptions.localForce ? { local: { force: true } } : {}),
      };
      run = await raceWithAbort(
        args.scope.agent.send(args.convertedMessage, sendOptions),
        args.signal,
        async (lateRun) => this.cancelRun(lateRun)
      );
      args.context.agentId = run.agentId;
      args.context.requestId = run.requestId;
      this.settings.onRunCreated?.(run);
      args.emitter.emitResponseMetadata(run, this.modelId);
      if (args.signal.aborted) cancelRun();

      operation = 'run.wait';
      if (!run.supports('wait')) {
        throw new UnsupportedRunOperationError('wait', run.unsupportedReason('wait'));
      }
      const result = await waitForRun(run, args.signal);
      if (cancelPromise) await cancelPromise;
      await Promise.resolve();
      queue.close();
      await drainPromise;
      this.settings.onRunResult?.(result);
      throwIfAborted(args.signal);
      args.context.operation = operation;
      args.emitter.emitTerminal(result, run.agentId, args.context);
    } catch (error) {
      queue.fail(error);
      if (run && !args.signal.aborted) {
        await this.cancelRun(run);
      }
      args.context.operation = operation;
      if (error instanceof AgentNotFoundError) args.scope.invalidate();
      throw error;
    } finally {
      if (cancelPromise) await cancelPromise;
      args.signal.removeEventListener('abort', onAbort);
      queue.close();
    }
  }

  private async drainDeltas(queue: AsyncDeltaQueue, emitter: CursorV3StreamEmitter): Promise<void> {
    while (true) {
      const entry = await queue.take();
      if (!entry) return;
      try {
        emitter.emitUpdate(entry.update);
        entry.acknowledge();
      } catch (error) {
        entry.reject(error);
        queue.fail(error);
        throw error;
      }
    }
  }

  private async cancelRun(run: Run): Promise<void> {
    try {
      if (!run.supports('cancel')) {
        this.logger.warn(
          `Cursor run ${run.id} cannot be cancelled: ${run.unsupportedReason('cancel') ?? 'unsupported'}.`
        );
        return;
      }
      await run.cancel();
    } catch (error) {
      this.logger.warn(`Failed to cancel Cursor run ${run.id}.`, error);
    }
  }

  private logCompatibilityWarning(warning: SharedV3Warning): void {
    if (warning.type === 'compatibility') {
      this.logger.warn(warning.details ?? warning.feature);
    }
  }
}
