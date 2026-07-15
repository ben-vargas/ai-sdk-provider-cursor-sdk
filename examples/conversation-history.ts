/**
 * Demonstrates native multi-turn continuity by reusing one Cursor model instance.
 * Use fresh single-user prompts on the same model instead of replaying an AI SDK transcript.
 *
 * Prerequisite: set CURSOR_API_KEY. CURSOR_MODEL optionally overrides composer-2.5.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText } from 'ai';
import { createCursor } from '../src/index.js';

async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log('Skipping conversation example: set CURSOR_API_KEY to run it.');
    return;
  }

  const workspace = mkdtempSync(join(tmpdir(), 'cursor-conversation-example-'));
  const provider = createCursor({ apiKey, logger: false });
  try {
    const model = provider(process.env.CURSOR_MODEL ?? 'composer-2.5', {
      mode: 'plan',
      local: { cwd: workspace },
    });

    const first = await generateText({
      model,
      prompt: 'Remember that the release codename is violet harbor. Confirm briefly.',
    });
    const second = await generateText({
      model,
      prompt: 'What release codename did I give you? Reply with only the codename.',
    });

    const firstAgentId = first.finalStep.providerMetadata?.cursor?.agentId;
    const secondAgentId = second.finalStep.providerMetadata?.cursor?.agentId;
    assert.equal(typeof firstAgentId, 'string');
    assert.equal(secondAgentId, firstAgentId, 'The same model instance should reuse its agent.');
    assert.match(second.text, /violet harbor/i, 'The second turn should retain native context.');

    console.log('First turn:', first.text);
    console.log('Second turn:', second.text);
    console.log('Stable agentId:', secondAgentId);
  } finally {
    await provider.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
