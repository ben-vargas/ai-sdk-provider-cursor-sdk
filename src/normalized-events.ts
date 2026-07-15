import { CursorStreamConsistencyError } from './errors.js';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export interface NormalizedCompatibilityWarning {
  kind: 'compatibility-warning';
  feature: string;
  message: string;
}

export interface NormalizedUsageInput {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  raw?: JsonValue;
}

type CursorToolMetadata = { modelCallId: string } & { [key: string]: JsonValue };

export type NormalizedEvent =
  | {
      kind: 'text-start' | 'text-end' | 'reasoning-start';
      id: string;
    }
  | {
      kind: 'reasoning-end';
      id: string;
      metadata?: { [key: string]: JsonValue };
    }
  | { kind: 'text-delta' | 'reasoning-delta'; id: string; delta: string }
  | {
      kind: 'tool-input-start';
      toolCallId: string;
      toolName: string;
      metadata: CursorToolMetadata;
    }
  | {
      kind: 'tool-call';
      toolCallId: string;
      toolName: string;
      input: JsonValue;
      metadata: CursorToolMetadata;
    }
  | {
      kind: 'tool-result';
      toolCallId: string;
      toolName: string;
      result: JsonValue;
      preliminary: boolean;
      isError: boolean;
      metadata: CursorToolMetadata;
    }
  | { kind: 'turn-usage'; usage: NormalizedUsageInput }
  | { kind: 'raw'; value: JsonValue; conditional: boolean }
  | NormalizedCompatibilityWarning;

interface TrackedTool {
  toolName: string;
  modelCallId: string;
  input: JsonValue;
  started: boolean;
  callEmitted: boolean;
  finalEmitted: boolean;
}

export class CursorEventNormalizer {
  private active?: { type: 'text' | 'reasoning'; id: string };
  private readonly tools = new Map<string, TrackedTool>();
  private textCounter = 0;
  private reasoningCounter = 0;
  private readonly warnedFeatures = new Set<string>();

  constructor(private readonly preliminaryToolResults: boolean) {}

  emitDelta(type: 'text' | 'reasoning', delta: string): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];
    if (this.active?.type !== type) {
      events.push(...this.closeActive());
      const id = type === 'text' ? `txt-${++this.textCounter}` : `rsn-${++this.reasoningCounter}`;
      this.active = { type, id };
      events.push({ kind: `${type}-start`, id });
    }
    events.push({ kind: `${type}-delta`, id: this.active.id, delta });
    return events;
  }

  closeActive(reasoningMetadata?: { [key: string]: JsonValue }): NormalizedEvent[] {
    if (!this.active) return [];
    const { type, id } = this.active;
    this.active = undefined;
    if (type === 'reasoning') {
      return [{ kind: 'reasoning-end', id, metadata: reasoningMetadata }];
    }
    return [{ kind: 'text-end', id }];
  }

  completeThinking(thinkingDurationMs: number): NormalizedEvent[] {
    if (this.active?.type !== 'reasoning') return [];
    return this.closeActive({
      thinkingDurationMs,
    });
  }

  startTool(args: {
    callId: string;
    toolName: string;
    input: JsonValue;
    modelCallId: string;
  }): NormalizedEvent[] {
    const existing = this.tools.get(args.callId);
    if (existing && !existing.finalEmitted) {
      throw new CursorStreamConsistencyError(
        `Cursor tool call '${args.callId}' started more than once before completion.`
      );
    }
    const tool: TrackedTool = {
      toolName: args.toolName,
      modelCallId: args.modelCallId,
      input: args.input,
      started: true,
      callEmitted: false,
      finalEmitted: false,
    };
    this.tools.set(args.callId, tool);
    const metadata = { modelCallId: args.modelCallId };
    const events: NormalizedEvent[] = [
      ...this.closeActive(),
      {
        kind: 'tool-input-start',
        toolCallId: args.callId,
        toolName: args.toolName,
        metadata,
      },
    ];
    if (this.preliminaryToolResults) {
      events.push(this.toolCallEvent(args.callId, tool));
      tool.callEmitted = true;
    }
    return events;
  }

  partialTool(args: {
    callId: string;
    snapshot: JsonValue;
    modelCallId: string;
  }): NormalizedEvent[] {
    if (!this.preliminaryToolResults) return [];
    const tool = this.tools.get(args.callId);
    if (!tool || tool.finalEmitted) {
      return this.warnOnce(
        'partial-tool-events',
        `Cursor partial tool update '${args.callId}' could not be correlated to an active tool call and was dropped.`
      );
    }
    return [
      {
        kind: 'tool-result',
        toolCallId: args.callId,
        toolName: tool.toolName,
        result: args.snapshot,
        preliminary: true,
        isError: false,
        metadata: { modelCallId: tool.modelCallId || args.modelCallId },
      },
    ];
  }

  completeTool(args: {
    callId: string;
    toolName: string;
    input: JsonValue;
    result: JsonValue;
    isError: boolean;
    modelCallId: string;
  }): NormalizedEvent[] {
    let tool = this.tools.get(args.callId);
    const events: NormalizedEvent[] = [...this.closeActive()];
    if (!tool) {
      tool = {
        toolName: args.toolName,
        modelCallId: args.modelCallId,
        input: args.input,
        started: true,
        callEmitted: false,
        finalEmitted: false,
      };
      this.tools.set(args.callId, tool);
      events.push({
        kind: 'tool-input-start',
        toolCallId: args.callId,
        toolName: args.toolName,
        metadata: { modelCallId: args.modelCallId },
      });
      events.push(
        ...this.warnOnce(
          'tool-events',
          'Cursor emitted a completed tool call without a corresponding started event; a minimal call was synthesized.'
        )
      );
    }
    if (tool.finalEmitted) return events;
    tool.toolName = args.toolName;
    tool.modelCallId = args.modelCallId;
    tool.input = args.input;
    if (!tool.callEmitted) {
      events.push(this.toolCallEvent(args.callId, tool));
      tool.callEmitted = true;
    }
    events.push({
      kind: 'tool-result',
      toolCallId: args.callId,
      toolName: tool.toolName,
      result: args.result,
      preliminary: false,
      isError: args.isError,
      metadata: { modelCallId: tool.modelCallId },
    });
    tool.finalEmitted = true;
    return events;
  }

  shellOutput(event: JsonValue): NormalizedEvent[] {
    if (!this.preliminaryToolResults) return [];
    const candidates = [...this.tools.entries()].filter(
      ([, tool]) => tool.toolName === 'shell' && tool.callEmitted && !tool.finalEmitted
    );
    if (candidates.length !== 1) return [];
    const [toolCallId, tool] = candidates[0] as [string, TrackedTool];
    return [
      {
        kind: 'tool-result',
        toolCallId,
        toolName: tool.toolName,
        result: event,
        preliminary: true,
        isError: false,
        metadata: { modelCallId: tool.modelCallId },
      },
    ];
  }

  usage(usage: NormalizedUsageInput): NormalizedEvent[] {
    return [...this.closeActive(), { kind: 'turn-usage', usage }];
  }

  unknownEvent(type: string): NormalizedEvent[] {
    return this.warnOnce(
      `unknown-event:${type}`,
      `Unknown optional Cursor update '${type}' was preserved as redacted raw data.`
    );
  }

  fallbackText(text: string): NormalizedEvent[] {
    return [
      ...this.emitDelta('text', text),
      ...this.closeActive(),
      ...this.warnOnce(
        'text-delta-fallback',
        'Cursor returned terminal assistant text without text deltas; the terminal result was emitted as a fallback.'
      ),
    ];
  }

  finish(status: 'finished' | 'error' | 'cancelled'): NormalizedEvent[] {
    const events = this.closeActive();
    for (const [toolCallId, tool] of this.tools) {
      if (tool.finalEmitted) continue;
      if (status === 'finished') {
        throw new CursorStreamConsistencyError(
          `Cursor run finished before tool call '${toolCallId}' emitted a final result.`
        );
      }
      if (!tool.callEmitted) {
        events.push(this.toolCallEvent(toolCallId, tool));
        tool.callEmitted = true;
      }
      events.push({
        kind: 'tool-result',
        toolCallId,
        toolName: tool.toolName,
        result: { status: 'aborted' },
        preliminary: false,
        isError: true,
        metadata: { modelCallId: tool.modelCallId },
      });
      tool.finalEmitted = true;
    }
    return events;
  }

  private toolCallEvent(toolCallId: string, tool: TrackedTool): NormalizedEvent {
    return {
      kind: 'tool-call',
      toolCallId,
      toolName: tool.toolName,
      input: tool.input,
      metadata: { modelCallId: tool.modelCallId },
    };
  }

  private warnOnce(feature: string, message: string): NormalizedEvent[] {
    if (this.warnedFeatures.has(feature)) return [];
    this.warnedFeatures.add(feature);
    return [{ kind: 'compatibility-warning', feature, message }];
  }
}
