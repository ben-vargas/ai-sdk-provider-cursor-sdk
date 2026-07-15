/**
 * Demonstrates actionable stale-session handling and recovery with the provider's error helpers.
 * Use this pattern when an application persists agent IDs and needs to start fresh after eviction.
 * Authentication and externally busy cloud-agent branches are documented alongside the live stale case.
 *
 * Prerequisite: set CURSOR_API_KEY. CURSOR_MODEL optionally overrides composer-2.5.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlLocalAgentStore } from '@cursor/sdk';
import { generateText } from 'ai';
import {
  createCursor,
  isAgentBusyError,
  isAuthenticationError,
  isStaleAgentError,
} from '../src/index.js';

function errorCode(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !('data' in error)) return undefined;
  const data = error.data;
  return data && typeof data === 'object' && 'code' in data ? data.code : undefined;
}

function recoveryAdvice(error: unknown): string {
  if (isStaleAgentError(error)) return 'Clear the saved agent ID and create a fresh session.';
  if (isAuthenticationError(error)) return 'Replace or reconfigure CURSOR_API_KEY before retrying.';
  if (isAgentBusyError(error)) {
    return 'Wait for or cancel the externally active cloud run before retrying.';
  }
  return 'Inspect the mapped error metadata before deciding whether to retry.';
}

async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log('Skipping error handling example: set CURSOR_API_KEY to run it.');
    return;
  }

  const root = mkdtempSync(join(tmpdir(), 'cursor-error-example-'));
  const workspace = join(root, 'workspace');
  const storeDirectory = join(root, 'store');
  mkdirSync(workspace, { recursive: true });
  const staleProvider = createCursor({ apiKey, logger: false });
  let staleVerified = false;

  try {
    try {
      await generateText({
        model: staleProvider(process.env.CURSOR_MODEL ?? 'composer-2.5', {
          agentId: 'known-missing-local-agent',
          mode: 'plan',
          sdkAgentOptions: {
            local: {
              cwd: workspace,
              store: new JsonlLocalAgentStore(storeDirectory),
            },
          },
        }),
        prompt: 'Continue this missing session.',
      });
      assert.fail('Resuming an ID from a new empty store should fail.');
    } catch (error) {
      assert.equal(isStaleAgentError(error), true);
      assert.equal(errorCode(error), 'agent_not_found');
      staleVerified = true;
      console.warn('Mapped stale-session code:', errorCode(error));
      console.warn('Recovery:', recoveryAdvice(error));
    }
  } finally {
    await staleProvider.close();
  }

  assert.equal(staleVerified, true);
  const recoveryProvider = createCursor({ apiKey, logger: false });
  try {
    const recovered = await generateText({
      model: recoveryProvider(process.env.CURSOR_MODEL ?? 'composer-2.5', {
        mode: 'plan',
        local: {
          cwd: workspace,
          store: new JsonlLocalAgentStore(storeDirectory),
        },
      }),
      prompt: 'Reply with a short confirmation that a fresh session started.',
    });
    console.log('Fresh-session recovery:', recovered.text);
    console.log('New agentId:', recovered.finalStep.providerMetadata?.cursor?.agentId);
  } finally {
    await recoveryProvider.close();
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
