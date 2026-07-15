/**
 * Demonstrates AI SDK v6 streaming, including delta count, terminal usage, and Cursor metadata.
 * Use this when rendering output incrementally while retaining the final run contract.
 *
 * Prerequisite: set CURSOR_API_KEY. CURSOR_MODEL optionally overrides composer-2.5.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamText } from 'ai';
import { createCursor } from '../src/index.js';

async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log('Skipping streaming example: set CURSOR_API_KEY to run it.');
    return;
  }

  const workspace = mkdtempSync(join(tmpdir(), 'cursor-streaming-example-'));
  const provider = createCursor({ apiKey });
  let textDeltaCount = 0;

  try {
    const result = streamText({
      model: provider(process.env.CURSOR_MODEL ?? 'composer-2.5', {
        mode: 'plan',
        local: { cwd: workspace },
      }),
      prompt:
        'Give three concise, numbered recommendations for making a command-line interface accessible.',
    });

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        textDeltaCount += 1;
        process.stdout.write(part.text);
      }
    }
    process.stdout.write('\n');

    const finishReason = await result.finishReason;
    assert.ok(textDeltaCount > 1, 'Expected multiple text deltas from the live stream.');
    assert.equal(finishReason, 'stop');
    console.log('Text delta count:', textDeltaCount);
    console.log('Finish reason:', finishReason);
    console.log('Usage:', await result.usage);
    console.log('Cursor metadata:', (await result.providerMetadata)?.cursor);
  } finally {
    await provider.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
