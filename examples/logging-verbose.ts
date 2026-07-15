/**
 * Demonstrates verbose provider logging plus ordered Cursor run lifecycle callbacks.
 * Use this to correlate diagnostic logs and callback IDs with final provider metadata.
 *
 * Prerequisite: set CURSOR_API_KEY. CURSOR_MODEL optionally overrides composer-2.5.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText } from 'ai';
import { createCursor, type Logger } from '../src/index.js';

async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log('Skipping logging example: set CURSOR_API_KEY to run it.');
    return;
  }

  const workspace = mkdtempSync(join(tmpdir(), 'cursor-logging-example-'));
  const lifecycle: Array<Record<string, unknown>> = [];
  let order = 0;
  const logger: Logger = {
    debug: (message, ...details) => console.error('[debug]', message, ...details),
    info: (message, ...details) => console.error('[info]', message, ...details),
    warn: (message, ...details) => console.error('[warn]', message, ...details),
    error: (message, ...details) => console.error('[error]', message, ...details),
  };
  const provider = createCursor({ apiKey, logger });

  try {
    const result = await generateText({
      model: provider(process.env.CURSOR_MODEL ?? 'composer-2.5', {
        mode: 'plan',
        local: { cwd: workspace },
        verbose: true,
        onRunCreated: (run) => {
          lifecycle.push({
            order: ++order,
            event: 'onRunCreated',
            runId: run.id,
            requestId: run.requestId,
            status: run.status,
          });
        },
        onRunResult: (run) => {
          lifecycle.push({
            order: ++order,
            event: 'onRunResult',
            runId: run.id,
            requestId: run.requestId,
            status: run.status,
          });
        },
      }),
      prompt: 'Give one concise recommendation for making request logs easy to correlate.',
    });

    const metadata = result.finalStep.providerMetadata?.cursor;
    console.log('Assistant response:', result.text);
    console.log('Lifecycle callback order:', lifecycle);
    console.log('Final correlation fields:', {
      runId: metadata?.runId,
      requestId: metadata?.requestId,
      status: metadata?.status,
      agentId: metadata?.agentId,
    });
  } finally {
    await provider.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
