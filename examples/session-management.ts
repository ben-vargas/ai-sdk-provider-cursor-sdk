/**
 * Demonstrates advanced cross-instance local resume with an explicit JsonlLocalAgentStore.
 * Ordinary multi-turn work should reuse one model instance (see conversation-history.ts). The
 * default local store is not reliable for cross-instance resume in the validated environment;
 * persistence requires an explicitly shared store and compatible workspace routing.
 *
 * Prerequisite: set CURSOR_API_KEY. CURSOR_MODEL optionally overrides composer-2.5.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlLocalAgentStore } from '@cursor/sdk';
import { generateText } from 'ai';
import { createCursor } from '../src/index.js';

async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log('Skipping session persistence example: set CURSOR_API_KEY to run it.');
    return;
  }

  const root = mkdtempSync(join(tmpdir(), 'cursor-session-example-'));
  const workspace = join(root, 'workspace');
  const storeDirectory = join(root, 'agent-store');
  const modelId = process.env.CURSOR_MODEL ?? 'composer-2.5';
  mkdirSync(workspace, { recursive: true });

  try {
    const providerA = createCursor({ apiKey, logger: false });
    let agentId: string;
    try {
      const modelA = providerA(modelId, {
        mode: 'plan',
        local: {
          cwd: workspace,
          store: new JsonlLocalAgentStore(storeDirectory),
        },
      });
      const first = await generateText({
        model: modelA,
        prompt: 'Remember the persistence marker amber lighthouse. Confirm briefly.',
      });
      const id = first.providerMetadata?.cursor?.agentId;
      if (typeof id !== 'string') throw new Error('Cursor did not return an agentId.');
      agentId = id;
      console.log('Provider A agentId:', agentId);
    } finally {
      await providerA.close();
    }

    const providerB = createCursor({ apiKey, logger: false });
    try {
      const modelB = providerB(modelId, {
        agentId,
        mode: 'plan',
        sdkAgentOptions: {
          local: {
            cwd: workspace,
            store: new JsonlLocalAgentStore(storeDirectory),
          },
        },
      });
      const resumed = await generateText({
        model: modelB,
        prompt: 'What persistence marker did I ask you to remember? Reply with only the marker.',
      });
      const resumedAgentId = resumed.providerMetadata?.cursor?.agentId;
      assert.equal(resumedAgentId, agentId);
      assert.match(resumed.text, /amber lighthouse/i);
      console.log('Provider B resumed response:', resumed.text);
      console.log('Stable explicit-store agentId:', resumedAgentId);
    } finally {
      await providerB.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
