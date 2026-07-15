/**
 * Demonstrates AI SDK v7 raw-chunk diagnostics with provider-side credential redaction.
 * Raw Cursor events are unstable diagnostic data, not an application schema; summarize event types
 * instead of persisting or coupling code to entire payloads.
 *
 * Prerequisite: set CURSOR_API_KEY. CURSOR_MODEL optionally overrides composer-2.5.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamText } from 'ai';
import { createCursor } from '../src/index.js';

function rawEventType(value: unknown): string {
  if (value && typeof value === 'object' && 'type' in value) {
    const type = Reflect.get(value, 'type');
    if (typeof type === 'string') return type;
  }
  return Array.isArray(value) ? 'array' : typeof value;
}

async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log('Skipping raw chunks example: set CURSOR_API_KEY to run it.');
    return;
  }

  const workspace = mkdtempSync(join(tmpdir(), 'cursor-raw-chunks-example-'));
  const provider = createCursor({ apiKey });
  const eventCounts = new Map<string, number>();
  let text = '';

  try {
    const result = streamText({
      model: provider(process.env.CURSOR_MODEL ?? 'composer-2.5', {
        mode: 'plan',
        local: { cwd: workspace },
      }),
      prompt: 'Explain in two short sentences why diagnostic event payloads need redaction.',
      include: { rawChunks: true },
    });

    for await (const part of result.fullStream) {
      if (part.type === 'raw') {
        const type = rawEventType(part.rawValue);
        eventCounts.set(type, (eventCounts.get(type) ?? 0) + 1);
      } else if (part.type === 'text-delta') {
        text += part.text;
      }
    }

    console.log('Assistant response:', text);
    console.log('Redacted raw event counts:', Object.fromEntries(eventCounts));
    console.log('Warnings:', await result.warnings);
    console.log('Cursor metadata:', (await result.finalStep).providerMetadata?.cursor);
  } finally {
    await provider.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
