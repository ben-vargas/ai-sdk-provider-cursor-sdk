import type { InteractionUpdate } from '@cursor/sdk';
import { CursorStreamConsistencyError } from './errors.js';
import {
  CursorEventNormalizer,
  type JsonValue,
  type NormalizedEvent,
} from './normalized-events.js';
import { redactSensitiveData } from './redact.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function json(value: unknown, fallback: JsonValue): JsonValue {
  const redacted = redactSensitiveData(value);
  return redacted === undefined ? fallback : redacted;
}

function requiredString(record: Record<string, unknown>, key: string, type: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new CursorStreamConsistencyError(
      `Malformed Cursor '${type}' update: '${key}' must be a non-empty string.`
    );
  }
  return value;
}

function requiredDeltaText(record: Record<string, unknown>, key: string, type: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new CursorStreamConsistencyError(
      `Malformed Cursor '${type}' update: '${key}' must be a string.`
    );
  }
  return value;
}

function requiredFiniteNumber(record: Record<string, unknown>, key: string, type: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CursorStreamConsistencyError(
      `Malformed Cursor '${type}' update: '${key}' must be a finite number.`
    );
  }
  return value;
}

function optionalFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  type: string
): number | undefined {
  return record[key] === undefined ? undefined : requiredFiniteNumber(record, key, type);
}

function toolDetails(record: Record<string, unknown>): {
  toolName: string;
  input: JsonValue;
  result: JsonValue;
  isError: boolean;
} {
  const toolCall = record.toolCall;
  if (!isRecord(toolCall)) {
    throw new CursorStreamConsistencyError(
      `Malformed Cursor '${String(record.type)}' update: 'toolCall' must be an object.`
    );
  }
  const toolName = requiredString(toolCall, 'type', String(record.type));
  const input = json(toolCall.args, {});
  const resultEnvelope = isRecord(toolCall.result) ? toolCall.result : undefined;
  const result = json(toolCall.result, { status: 'completed' });
  const isError =
    resultEnvelope?.status === 'error' ||
    (isRecord(result) && 'error' in result && Boolean(result.error));
  return { toolName, input, result, isError };
}

export function normalizeCursorUpdate(
  normalizer: CursorEventNormalizer,
  update: InteractionUpdate | unknown
): NormalizedEvent[] {
  const raw = redactSensitiveData(update);
  if (!raw || !isRecord(update)) {
    throw new CursorStreamConsistencyError('Cursor emitted a non-object interaction update.');
  }
  const type = requiredString(update, 'type', 'interaction');
  const events: NormalizedEvent[] = [{ kind: 'raw', value: raw, conditional: true }];

  switch (type) {
    case 'text-delta':
      events.push(...normalizer.emitDelta('text', requiredDeltaText(update, 'text', type)));
      break;
    case 'thinking-delta':
      events.push(...normalizer.emitDelta('reasoning', requiredDeltaText(update, 'text', type)));
      break;
    case 'thinking-completed': {
      if (typeof update.thinkingDurationMs !== 'number') {
        throw new CursorStreamConsistencyError(
          "Malformed Cursor 'thinking-completed' update: 'thinkingDurationMs' must be a number."
        );
      }
      events.push(...normalizer.completeThinking(update.thinkingDurationMs));
      break;
    }
    case 'tool-call-started': {
      const details = toolDetails(update);
      events.push(
        ...normalizer.startTool({
          callId: requiredString(update, 'callId', type),
          toolName: details.toolName,
          input: details.input,
          modelCallId: requiredString(update, 'modelCallId', type),
        })
      );
      break;
    }
    case 'partial-tool-call':
      events.push(
        ...normalizer.partialTool({
          callId: requiredString(update, 'callId', type),
          snapshot: json(update.toolCall, {}),
          modelCallId: requiredString(update, 'modelCallId', type),
        })
      );
      break;
    case 'tool-call-completed': {
      const details = toolDetails(update);
      events.push(
        ...normalizer.completeTool({
          callId: requiredString(update, 'callId', type),
          toolName: details.toolName,
          input: details.input,
          result: details.result,
          isError: details.isError,
          modelCallId: requiredString(update, 'modelCallId', type),
        })
      );
      break;
    }
    case 'shell-output-delta':
      events.push(...normalizer.shellOutput(json(update.event, {})));
      break;
    case 'turn-ended': {
      if (update.usage === undefined) {
        events.push(...normalizer.closeActive());
      } else if (isRecord(update.usage)) {
        events.push(
          ...normalizer.usage({
            inputTokens: requiredFiniteNumber(update.usage, 'inputTokens', type),
            outputTokens: requiredFiniteNumber(update.usage, 'outputTokens', type),
            cacheReadTokens: requiredFiniteNumber(update.usage, 'cacheReadTokens', type),
            cacheWriteTokens: requiredFiniteNumber(update.usage, 'cacheWriteTokens', type),
            reasoningTokens: optionalFiniteNumber(update.usage, 'reasoningTokens', type),
            raw: json(update.usage, {}),
          })
        );
      } else {
        throw new CursorStreamConsistencyError(
          "Malformed Cursor 'turn-ended' update: 'usage' must be an object."
        );
      }
      break;
    }
    case 'token-delta':
    case 'step-started':
    case 'step-completed':
    case 'summary':
    case 'summary-started':
    case 'summary-completed':
    case 'user-message-appended':
      break;
    default:
      if (/tool|call|complete|finish|permission|usage|result/i.test(type)) {
        throw new CursorStreamConsistencyError(
          `Unknown Cursor update '${type}' may affect completion, tool identity, permissions, usage, or results.`
        );
      }
      events.push(...normalizer.unknownEvent(type));
      break;
  }

  return events;
}
