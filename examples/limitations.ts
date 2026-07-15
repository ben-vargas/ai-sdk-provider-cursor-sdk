/**
 * Demonstrates practical AI SDK compatibility warnings through public generateText calls.
 * Use this when migrating an integration that depends on sampling controls, system/history
 * policies, application tools, or schema-constrained output.
 *
 * Prerequisite: set CURSOR_API_KEY. CURSOR_MODEL optionally overrides composer-2.5.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Output, generateText, tool } from 'ai';
import { z } from 'zod';
import { createCursor } from '../src/index.js';

function printWarnings(feature: string, warnings: unknown): void {
  console.log(`\n${feature} warnings:`);
  console.dir(warnings, { depth: null });
}

async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log('Skipping limitations example: set CURSOR_API_KEY to run it.');
    return;
  }

  const workspace = mkdtempSync(join(tmpdir(), 'cursor-limitations-example-'));
  const provider = createCursor({ apiKey, logger: false });
  const modelId = process.env.CURSOR_MODEL ?? 'composer-2.5';
  const freshModel = (settings = {}) =>
    provider(modelId, {
      mode: 'plan',
      createNewAgentPerCall: true,
      local: { cwd: workspace },
      ...settings,
    });

  try {
    const sampling = await generateText({
      model: freshModel(),
      prompt: 'Reply with one short sentence about deterministic testing.',
      temperature: 0.2,
      topP: 0.9,
      seed: 7,
    });
    printWarnings('Sampling controls are ignored', sampling.warnings);

    const system = await generateText({
      model: freshModel({ systemMessageMode: 'prefix' }),
      system: 'Prefer concise responses.',
      prompt: 'Explain what happened to the system message.',
    });
    printWarnings('System-message prefixing is lossy', system.warnings);

    const history = await generateText({
      model: freshModel({ promptHistoryMode: 'flatten' }),
      messages: [
        { role: 'user', content: 'Earlier question.' },
        { role: 'assistant', content: 'Earlier answer.' },
        { role: 'user', content: 'Summarize this transcript in one sentence.' },
      ],
    });
    printWarnings('Flattened transcript history is lossy', history.warnings);

    let applicationToolExecuted = false;
    const applicationTools = await generateText({
      model: freshModel(),
      prompt: 'Reply with the word ready.',
      tools: {
        application_status: tool({
          description: 'Return application status.',
          inputSchema: z.object({}),
          execute: async () => {
            applicationToolExecuted = true;
            return { status: 'ready' };
          },
        }),
      },
    });
    assert.equal(applicationToolExecuted, false);
    printWarnings('AI SDK application tools are not bridged', applicationTools.warnings);

    const structured = await generateText({
      model: freshModel(),
      prompt: 'Return only this JSON object with no markdown: {"status":"ready"}',
      output: Output.object({ schema: z.object({ status: z.string() }) }),
    });
    printWarnings('Structured output is prompt-based, not guaranteed', structured.warnings);
    console.log('Client-validated output:', structured.output);
  } finally {
    await provider.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
