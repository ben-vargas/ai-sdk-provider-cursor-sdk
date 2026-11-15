/**
 * Demonstrates the smallest useful AI SDK v6 generateText call with Cursor result metadata.
 * Start here when learning the provider's text, finish-reason, usage, and terminal-run contracts.
 *
 * Prerequisite: set CURSOR_API_KEY. CURSOR_MODEL optionally overrides grok-4.7.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText } from 'ai';
import { createCursor } from '../src/index.js';

async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log('Skipping basic usage example: set CURSOR_API_KEY to run it.');
    return;
  }

  const workspace = mkdtempSync(join(tmpdir(), 'cursor-basic-example-'));
  const provider = createCursor({ apiKey });
  try {
    const result = await generateText({
      model: provider(process.env.CURSOR_MODEL ?? 'grok-4.7', {
        mode: 'plan',
        local: { cwd: workspace },
      }),
      prompt: 'Explain in two concise bullets when an application should stream an LLM response.',
    });

    const metadata = result.providerMetadata?.cursor;
    // Cursor can return several text blocks in one step, such as a note before a tool call.
    // `result.text` joins them with no separator, so join the blocks explicitly for display.
    const text = result.content
      .flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
      .join('\n\n');
    console.log('Text:\n', text);
    console.log('Finish reason:', result.finishReason);
    console.log('Mapped AI SDK usage:', {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
      ...result.usage.inputTokenDetails,
    });
    console.log('Cursor terminal metadata:', {
      agentId: metadata?.agentId,
      runId: metadata?.runId,
      status: metadata?.status,
      requestId: metadata?.requestId,
      model: metadata?.model,
      durationMs: metadata?.durationMs,
      result: metadata?.result,
      usage: metadata?.usage,
    });
  } finally {
    await provider.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
