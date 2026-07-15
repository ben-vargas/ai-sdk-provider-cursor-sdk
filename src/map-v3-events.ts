import type {
  JSONObject,
  LanguageModelV3StreamPart,
  SharedV3ProviderMetadata,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { InteractionUpdate, Run, RunResult } from '@cursor/sdk';
import { createRunError, type CursorErrorContext } from './errors.js';
import { mapCursorFinishReason } from './map-finish-reason.js';
import { CursorUsageAccumulator, mapCursorUsage } from './map-usage.js';
import { normalizeCursorUpdate } from './normalize-cursor-events.js';
import {
  CursorEventNormalizer,
  type JsonValue,
  type NormalizedEvent,
} from './normalized-events.js';
import type { CursorProviderMetadata } from './types.js';

function providerMetadata(value: { [key: string]: JsonValue }): SharedV3ProviderMetadata {
  return { cursor: value as JSONObject };
}

function nonNullJson(value: JsonValue): Exclude<JsonValue, null> {
  return value === null ? { value: null } : value;
}

/** Thin AI SDK V3 adapter over the generation-neutral Cursor event normalizer. */
export class CursorV3StreamEmitter {
  private readonly normalizer: CursorEventNormalizer;
  private readonly usage = new CursorUsageAccumulator();
  private readonly startedToolInputs = new Set<string>();
  private warnings?: SharedV3Warning[];
  private closed = false;
  private terminal = false;
  private streamedTextLength = 0;

  constructor(
    private readonly controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
    private readonly includeRawChunks: boolean,
    preliminaryToolResults: boolean,
    private readonly onCompatibilityWarning?: (warning: SharedV3Warning) => void
  ) {
    this.normalizer = new CursorEventNormalizer(preliminaryToolResults);
  }

  emitStart(warnings: SharedV3Warning[]): void {
    this.warnings = warnings;
    this.enqueue({ type: 'stream-start', warnings });
  }

  emitResponseMetadata(run: Run, requestedModelId: string): void {
    this.enqueue({
      type: 'response-metadata',
      id: run.id,
      modelId: run.model?.id ?? requestedModelId,
      timestamp: new Date(),
    });
  }

  emitUpdate(update: InteractionUpdate): void {
    this.emitNormalized(normalizeCursorUpdate(this.normalizer, update));
  }

  emitTerminal(result: RunResult, agentId: string, context: CursorErrorContext): void {
    if (this.terminal) return;
    this.terminal = true;
    this.emitNormalized(this.normalizer.finish(result.status));
    if (
      result.status === 'finished' &&
      this.streamedTextLength === 0 &&
      typeof result.result === 'string' &&
      result.result.length > 0
    ) {
      this.emitNormalized(this.normalizer.fallbackText(result.result));
    }

    const resolvedUsage = this.usage.resolve(result.usage);
    const metadata: CursorProviderMetadata = {
      agentId,
      runId: result.id,
      status: result.status,
      ...(result.requestId ? { requestId: result.requestId } : {}),
      ...(result.model?.id ? { model: result.model.id } : {}),
      ...(result.model?.params ? { modelParams: result.model.params } : {}),
      ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
      ...(result.result !== undefined ? { result: result.result } : {}),
      ...(resolvedUsage ? { usage: resolvedUsage } : {}),
      ...(result.git ? { git: result.git } : {}),
    };

    if (result.status === 'error') {
      this.enqueue({ type: 'error', error: createRunError(result, context) });
    }
    this.enqueue({
      type: 'finish',
      finishReason: mapCursorFinishReason(result),
      usage: mapCursorUsage(resolvedUsage),
      providerMetadata: providerMetadata(metadata as unknown as { [key: string]: JsonValue }),
    });
  }

  emitError(error: unknown): void {
    this.enqueue({ type: 'error', error });
  }

  emitNormalized(events: NormalizedEvent[]): void {
    for (const event of events) {
      switch (event.kind) {
        case 'text-start':
        case 'text-end':
        case 'reasoning-start':
          this.enqueue({ type: event.kind, id: event.id });
          break;
        case 'reasoning-end':
          this.enqueue({
            type: 'reasoning-end',
            id: event.id,
            ...(event.metadata ? { providerMetadata: providerMetadata(event.metadata) } : {}),
          });
          break;
        case 'text-delta':
          this.streamedTextLength += event.delta.length;
          this.enqueue({ type: 'text-delta', id: event.id, delta: event.delta });
          break;
        case 'reasoning-delta':
          this.enqueue({ type: 'reasoning-delta', id: event.id, delta: event.delta });
          break;
        case 'tool-input-start':
          if (!this.startedToolInputs.has(event.toolCallId)) {
            this.startedToolInputs.add(event.toolCallId);
            this.enqueue({
              type: 'tool-input-start',
              id: event.toolCallId,
              toolName: event.toolName,
              providerExecuted: true,
              dynamic: true,
              providerMetadata: providerMetadata(event.metadata),
            });
          }
          break;
        case 'tool-call': {
          if (!this.startedToolInputs.has(event.toolCallId)) {
            this.startedToolInputs.add(event.toolCallId);
            this.enqueue({
              type: 'tool-input-start',
              id: event.toolCallId,
              toolName: event.toolName,
              providerExecuted: true,
              dynamic: true,
              providerMetadata: providerMetadata(event.metadata),
            });
          }
          const input = JSON.stringify(event.input);
          this.enqueue({ type: 'tool-input-delta', id: event.toolCallId, delta: input });
          this.enqueue({ type: 'tool-input-end', id: event.toolCallId });
          this.enqueue({
            type: 'tool-call',
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input,
            providerExecuted: true,
            dynamic: true,
            providerMetadata: providerMetadata(event.metadata),
          });
          this.startedToolInputs.delete(event.toolCallId);
          break;
        }
        case 'tool-result':
          this.enqueue({
            type: 'tool-result',
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            result: nonNullJson(event.result),
            dynamic: true,
            ...(event.preliminary ? { preliminary: true } : {}),
            ...(event.isError ? { isError: true } : {}),
            providerMetadata: providerMetadata(event.metadata),
          });
          break;
        case 'turn-usage':
          this.usage.add(event.usage);
          break;
        case 'raw':
          if (!event.conditional || this.includeRawChunks) {
            this.enqueue({ type: 'raw', rawValue: event.value });
          }
          break;
        case 'compatibility-warning': {
          const warning: SharedV3Warning = {
            type: 'compatibility',
            feature: event.feature,
            details: event.message,
          };
          this.warnings?.push(warning);
          this.onCompatibilityWarning?.(warning);
          this.enqueue({
            type: 'raw',
            rawValue: {
              type: 'cursor-sdk-compatibility-warning',
              feature: event.feature,
              message: event.message,
            },
          });
          break;
        }
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller.close();
    } catch {
      // The consumer may already have cancelled the stream.
    }
  }

  error(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller.error(error);
    } catch {
      // The consumer may already have cancelled the stream.
    }
  }

  private enqueue(part: LanguageModelV3StreamPart): void {
    if (this.closed) return;
    try {
      this.controller.enqueue(part);
    } catch {
      this.closed = true;
    }
  }
}
