/**
 * Demonstrates observing Cursor's provider-executed dynamic tools against a read-only fixture.
 * Tool payloads are redacted and unstable, so applications should rely on IDs/flags and structural
 * summaries rather than fixed input or output fields.
 *
 * Prerequisite: set CURSOR_API_KEY. CURSOR_MODEL optionally overrides composer-2.5.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamText } from 'ai';
import { createCursor } from '../src/index.js';

function structuralSummary(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { kind: 'array', length: value.length };
  if (value && typeof value === 'object') {
    return { kind: 'object', keys: Object.keys(value).sort().slice(0, 10) };
  }
  return { kind: value === null ? 'null' : typeof value };
}

async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log('Skipping tool visibility example: set CURSOR_API_KEY to run it.');
    return;
  }

  const workspace = mkdtempSync(join(tmpdir(), 'cursor-tool-visibility-example-'));
  const sourceDirectory = join(workspace, 'src');
  mkdirSync(sourceDirectory, { recursive: true });
  const packagePath = join(workspace, 'package.json');
  const sourcePath = join(sourceDirectory, 'feature.ts');
  writeFileSync(packagePath, '{"name":"read-only-fixture","type":"module"}\n');
  writeFileSync(sourcePath, 'export function featureFlag(): string { return "stable"; }\n');
  const originalFiles = [readFileSync(packagePath, 'utf8'), readFileSync(sourcePath, 'utf8')];

  const provider = createCursor({ apiKey, logger: false });
  const calls = new Map<string, { providerExecuted?: boolean; dynamic?: boolean }>();
  const results = new Map<string, { providerExecuted?: boolean; dynamic?: boolean }>();
  let assistantText = '';

  try {
    const result = streamText({
      model: provider(process.env.CURSOR_MODEL ?? 'composer-2.5', {
        mode: 'plan',
        local: { cwd: workspace, sandboxOptions: { enabled: true } },
      }),
      prompt:
        'Read package.json and src/feature.ts without changing anything. Report the package name, exported function name, and returned string.',
    });

    for await (const part of result.fullStream) {
      if (part.type === 'tool-call') {
        calls.set(part.toolCallId, {
          providerExecuted: part.providerExecuted,
          dynamic: part.dynamic,
        });
        console.log('Tool call:', {
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          providerExecuted: part.providerExecuted,
          dynamic: part.dynamic,
          input: structuralSummary(part.input),
        });
      } else if (part.type === 'tool-result') {
        results.set(part.toolCallId, {
          providerExecuted: part.providerExecuted,
          dynamic: part.dynamic,
        });
        console.log('Tool result:', {
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          providerExecuted: part.providerExecuted,
          dynamic: part.dynamic,
          output: structuralSummary(part.output),
        });
      } else if (part.type === 'text-delta') {
        assistantText += part.text;
      }
    }

    const pairedCallId = [...calls.keys()].find((id) => results.has(id));
    assert.ok(pairedCallId, 'Expected at least one tool call/result pair.');
    assert.equal(calls.get(pairedCallId)?.providerExecuted, true);
    assert.equal(calls.get(pairedCallId)?.dynamic, true);
    assert.equal(results.get(pairedCallId)?.providerExecuted, true);
    assert.equal(results.get(pairedCallId)?.dynamic, true);
    assert.ok(assistantText.trim().length > 0, 'Expected final assistant text.');
    assert.deepEqual(
      [readFileSync(packagePath, 'utf8'), readFileSync(sourcePath, 'utf8')],
      originalFiles,
      'The read-only fixture files changed.'
    );

    console.log('Assistant response:\n', assistantText);
    console.log('Cursor metadata:', (await result.providerMetadata)?.cursor);
  } finally {
    await provider.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
