import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, JsonlLocalAgentStore } from '@cursor/sdk';
import { generateText } from 'ai';
import { createCursor } from '../dist/index.js';

// Opt-in real calls. A server feature/access rejection must fail, never count as a pass.
const option = process.argv[2];
if (!process.env.CURSOR_API_KEY || !['system-prompt', 'cloud'].includes(option)) {
  throw new Error('Set CURSOR_API_KEY and run npm run smoke:sdk-options -- system-prompt|cloud');
}
const modelId = process.env.CURSOR_MODEL ?? 'composer-2.5';
const workspace = mkdtempSync(join(tmpdir(), 'cursor-sdk-options-'));
const storeDirectory = join(workspace, 'store');
const providers = [];
let cloudAgentId;
function provider() {
  const value = createCursor({ apiKey: process.env.CURSOR_API_KEY, logger: false });
  providers.push(value);
  return value;
}
function callOptions() {
  return { abortSignal: AbortSignal.timeout(120_000), maxRetries: 0 };
}
try {
  if (option === 'system-prompt') {
    const firstMarker = `HARNESS_FIRST_${randomUUID()}`;
    const secondMarker = `HARNESS_RESUMED_${randomUUID()}`;
    const firstProvider = provider();
    const first = await generateText({
      ...callOptions(),
      model: firstProvider(modelId, {
        tools: [],
        local: {
          cwd: workspace,
          store: new JsonlLocalAgentStore(storeDirectory),
          settingSources: [],
        },
        systemPrompt: `Reply to every user message with exactly ${firstMarker}. Do not use tools.`,
      }),
      prompt: 'What is your required response?',
    });
    assert.equal(first.text.trim(), firstMarker);
    const agentId = first.providerMetadata?.cursor?.agentId;
    assert.equal(typeof agentId, 'string');
    await firstProvider.close();
    const second = await generateText({
      ...callOptions(),
      model: provider()(modelId, {
        agentId,
        tools: [],
        sdkAgentOptions: {
          local: {
            cwd: workspace,
            store: new JsonlLocalAgentStore(storeDirectory),
            settingSources: [],
          },
        },
        systemPrompt: `Reply to every user message with exactly ${secondMarker}. Do not use tools.`,
      }),
      prompt: 'What is your required response now?',
    });
    assert.equal(second.text.trim(), secondMarker);
    assert.equal(second.providerMetadata?.cursor?.agentId, agentId);
    console.log('Live systemPrompt create and cross-provider resume passed.');
  } else {
    const result = await generateText({
      ...callOptions(),
      model: provider()(modelId, {
        cloud: { agentServeAgent: `cursor-sdk-smoke-${randomUUID()}`, autoCreatePR: false },
        onRunCreated: (run) => {
          cloudAgentId = run.agentId;
        },
      }),
      prompt:
        'Reply with exactly CURSOR_CLOUD_131_OK. Do not edit files, run commands, or create a pull request.',
    });
    assert.equal(result.text.trim(), 'CURSOR_CLOUD_131_OK');
    assert.equal(result.providerMetadata?.cursor?.status, 'finished');
    assert.match(result.providerMetadata?.cursor?.agentId, /^bc-/);
    console.log(
      'Live agentServeAgent cloud creation and generation passed (option acceptance; no seeded skill).'
    );
  }
} catch (error) {
  console.error(`${option} failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  for (const value of providers) await value.close();
  if (cloudAgentId) await Agent.archive(cloudAgentId, { apiKey: process.env.CURSOR_API_KEY });
  rmSync(workspace, { recursive: true, force: true });
}
