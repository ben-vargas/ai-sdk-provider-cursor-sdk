/**
 * Demonstrates aborting an in-flight Cursor stream while preserving the caller's exact abort reason.
 * Use this pattern when a request should stop as soon as your application cancels it.
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
    console.log('Skipping abort example: set CURSOR_API_KEY to run it.');
    return;
  }

  const workspace = mkdtempSync(join(tmpdir(), 'cursor-abort-example-'));
  const provider = createCursor({ apiKey, logger: false });
  const controller = new AbortController();
  const reason = new DOMException('Cancelled by the abort example', 'AbortError');
  let sawTextDelta = false;
  let rejectedWithOriginalReason = false;
  const fallback = setTimeout(() => controller.abort(reason), 30_000);

  try {
    const result = streamText({
      model: provider(process.env.CURSOR_MODEL ?? 'composer-2.5', {
        mode: 'plan',
        local: { cwd: workspace },
      }),
      prompt:
        'Write a detailed, ten-section guide to designing a reliable background job system. Start immediately and make every section substantial.',
      abortSignal: controller.signal,
    });

    try {
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          sawTextDelta = true;
          process.stdout.write(part.text);
          controller.abort(reason);
        }
      }
      throw new Error('The stream completed instead of rejecting after abort.');
    } catch (error) {
      assert.equal(error, reason, 'The provider must reject with the original abort reason.');
      rejectedWithOriginalReason = true;
    }

    console.log('\nAbort verification:', {
      trigger: sawTextDelta ? 'first text delta' : '30-second fallback',
      rejectedWithOriginalReason,
    });
  } finally {
    clearTimeout(fallback);
    await provider.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
