/**
 * Maintainer-only manual smoke for the provider's live AI SDK v7 result contract.
 * It verifies generation, streaming, same-model continuity, and abort propagation without using
 * the caller's repository. It never attempts default-store cross-instance resume.
 *
 * Prerequisite: set CURSOR_API_KEY. CURSOR_MODEL optionally overrides composer-2.5.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText, streamText } from 'ai';
import { createCursor } from '../src/index.js';

function assertTerminalMetadata(metadata: unknown): asserts metadata is {
  agentId: string;
  runId: string;
  requestId: string;
  model: string;
  status: 'finished';
  durationMs: number;
  result: string;
  usage: Record<string, unknown>;
} {
  assert.ok(metadata && typeof metadata === 'object');
  assert.equal(typeof Reflect.get(metadata, 'agentId'), 'string');
  assert.equal(typeof Reflect.get(metadata, 'runId'), 'string');
  assert.equal(typeof Reflect.get(metadata, 'requestId'), 'string');
  assert.equal(typeof Reflect.get(metadata, 'model'), 'string');
  assert.equal(Reflect.get(metadata, 'status'), 'finished');
  assert.equal(typeof Reflect.get(metadata, 'durationMs'), 'number');
  assert.equal(typeof Reflect.get(metadata, 'result'), 'string');
  assert.ok(Reflect.get(metadata, 'usage'));
}

async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log('Skipping manual integration smoke: set CURSOR_API_KEY to run it.');
    return;
  }

  const workspace = mkdtempSync(join(tmpdir(), 'cursor-contract-smoke-'));
  const provider = createCursor({ apiKey, logger: false });
  const selectedModel = process.env.CURSOR_MODEL ?? 'composer-2.5';
  try {
    const model = provider(selectedModel, { mode: 'plan', local: { cwd: workspace } });
    const first = await generateText({
      model,
      prompt:
        'Remember the marker cursor-sdk-integration-ok, then reply with one short sentence containing it.',
    });

    assert.match(first.text, /cursor-sdk-integration-ok/i);
    assert.equal(first.finishReason, 'stop');
    assert.equal(typeof first.usage.inputTokens, 'number');
    assert.equal(typeof first.usage.outputTokens, 'number');
    assert.equal(typeof first.usage.totalTokens, 'number');
    assert.equal(typeof first.usage.inputTokenDetails.noCacheTokens, 'number');
    assert.equal(typeof first.usage.inputTokenDetails.cacheReadTokens, 'number');
    assert.equal(typeof first.usage.inputTokenDetails.cacheWriteTokens, 'number');
    const firstMetadata = first.finalStep.providerMetadata?.cursor;
    assertTerminalMetadata(firstMetadata);

    const streamed = streamText({
      model,
      prompt:
        'In two short sentences, repeat the marker I gave you and explain that this is the second turn.',
    });
    let streamedText = '';
    let textDeltaCount = 0;
    for await (const part of streamed.fullStream) {
      if (part.type === 'text-delta') {
        streamedText += part.text;
        textDeltaCount += 1;
      }
    }

    assert.match(streamedText, /cursor-sdk-integration-ok/i);
    assert.ok(textDeltaCount > 1, 'Expected multiple streamed text deltas.');
    assert.equal(await streamed.finishReason, 'stop');
    const streamedStep = await streamed.finalStep;
    const streamedMetadata = streamedStep.providerMetadata?.cursor;
    assertTerminalMetadata(streamedMetadata);
    assert.equal(streamedMetadata.agentId, firstMetadata.agentId);

    const controller = new AbortController();
    const abortReason = new DOMException('manual smoke abort', 'AbortError');
    const fallback = setTimeout(() => controller.abort(abortReason), 30_000);
    try {
      const aborted = streamText({
        model: provider(selectedModel, { mode: 'plan', local: { cwd: workspace } }),
        prompt: 'Write a long, detailed technical essay with at least twelve substantial sections.',
        abortSignal: controller.signal,
      });
      try {
        for await (const part of aborted.fullStream) {
          if (part.type === 'text-delta') controller.abort(abortReason);
        }
        assert.fail('Aborted stream completed without rejecting.');
      } catch (error) {
        assert.equal(error, abortReason);
      }
    } finally {
      clearTimeout(fallback);
    }

    console.log('Manual live-contract smoke passed:', {
      model: selectedModel,
      agentId: firstMetadata.agentId,
      streamedTextDeltas: textDeltaCount,
      finishReason: await streamed.finishReason,
    });
  } finally {
    await provider.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
