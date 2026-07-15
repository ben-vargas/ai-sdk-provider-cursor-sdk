/**
 * Demonstrates an explicitly opted-in, read-only Cursor cloud repository inspection.
 * Use this only after validating cloud access and repository permissions for your account.
 *
 * Prerequisites: set CURSOR_API_KEY, CURSOR_CLOUD_EXAMPLE=1, and CURSOR_CLOUD_REPO.
 * CURSOR_MODEL optionally overrides composer-2.5; CURSOR_CLOUD_REF defaults to main.
 */
import { generateText } from 'ai';
import { createCursor } from '../src/index.js';

async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  const repository = process.env.CURSOR_CLOUD_REPO;

  if (!apiKey) {
    console.log('Skipping cloud example: set CURSOR_API_KEY to run it.');
    return;
  }
  if (process.env.CURSOR_CLOUD_EXAMPLE !== '1') {
    console.log('Skipping cloud example: set CURSOR_CLOUD_EXAMPLE=1 to opt in.');
    return;
  }
  if (!repository) {
    console.log('Skipping cloud example: set CURSOR_CLOUD_REPO to a connected repository URL.');
    return;
  }

  const provider = createCursor({ apiKey });
  try {
    const result = await generateText({
      model: provider(process.env.CURSOR_MODEL ?? 'composer-2.5', {
        mode: 'plan',
        createNewAgentPerCall: true,
        cloud: {
          repos: [
            {
              url: repository,
              startingRef: process.env.CURSOR_CLOUD_REF ?? 'main',
            },
          ],
        },
      }),
      prompt:
        'Inspect the repository read-only. Identify its primary language, test command, and main entry point. Do not edit files, create branches, or open a pull request.',
    });

    const metadata = result.finalStep.providerMetadata?.cursor;
    console.log('Read-only repository report:\n', result.text);
    console.log('Cloud run metadata:', {
      agentId: metadata?.agentId,
      runId: metadata?.runId,
      requestId: metadata?.requestId,
      status: metadata?.status,
      model: metadata?.model,
      durationMs: metadata?.durationMs,
      git: metadata?.git,
    });
  } finally {
    await provider.close();
  }
}

await main();
