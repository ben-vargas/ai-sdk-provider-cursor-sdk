/**
 * Demonstrates how Cursor terminal usage maps into AI SDK v6 usage totals and cache details.
 * Use mapped usage for portable accounting and Cursor metadata for provider-specific diagnostics.
 *
 * Prerequisite: set CURSOR_API_KEY. CURSOR_MODEL optionally overrides composer-2.5.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText } from 'ai';
import { createCursor } from '../src/index.js';

async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log('Skipping usage example: set CURSOR_API_KEY to run it.');
    return;
  }

  const workspace = mkdtempSync(join(tmpdir(), 'cursor-usage-example-'));
  const provider = createCursor({ apiKey });
  try {
    const result = await generateText({
      model: provider(process.env.CURSOR_MODEL ?? 'composer-2.5', {
        mode: 'plan',
        local: { cwd: workspace },
      }),
      prompt: 'Explain token caching in one concise sentence.',
    });

    const metadata = result.providerMetadata?.cursor;
    console.log('AI SDK mapped usage:', {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
      noCacheTokens: result.usage.inputTokenDetails.noCacheTokens,
      cacheReadTokens: result.usage.inputTokenDetails.cacheReadTokens,
      cacheWriteTokens: result.usage.inputTokenDetails.cacheWriteTokens,
    });
    console.log('Cursor terminal metadata and raw usage:', {
      agentId: metadata?.agentId,
      runId: metadata?.runId,
      requestId: metadata?.requestId,
      status: metadata?.status,
      model: metadata?.model,
      durationMs: metadata?.durationMs,
      usage: metadata?.usage,
    });
  } finally {
    await provider.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
