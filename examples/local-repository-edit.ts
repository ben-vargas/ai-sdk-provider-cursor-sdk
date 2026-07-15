/**
 * Demonstrates a complete agent-native repository task in a disposable JavaScript project.
 * Cursor diagnoses a failing test, edits the implementation, reruns the test, and exposes its
 * provider-executed dynamic tools without receiving access to the caller's repository.
 *
 * Prerequisite: set CURSOR_API_KEY. CURSOR_MODEL optionally overrides composer-2.5.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { streamText } from 'ai';
import { createCursor } from '../src/index.js';

function runTests(cwd: string): { status: number | null; output: string } {
  const run = spawnSync(process.execPath, ['--test'], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return {
    status: run.status,
    output: `${run.stdout}${run.stderr}`.trim(),
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log('Skipping repository edit example: set CURSOR_API_KEY to run it.');
    return;
  }

  const workspace = mkdtempSync(join(tmpdir(), 'cursor-repository-edit-example-'));
  const sourceDirectory = join(workspace, 'src');
  const testDirectory = join(workspace, 'test');
  mkdirSync(sourceDirectory, { recursive: true });
  mkdirSync(testDirectory, { recursive: true });
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify(
      { name: 'math-fixture', private: true, type: 'module', scripts: { test: 'node --test' } },
      null,
      2
    ) + '\n'
  );
  const sourcePath = join(sourceDirectory, 'math.js');
  writeFileSync(sourcePath, 'export function subtract(left, right) {\n  return left + right;\n}\n');
  writeFileSync(
    join(testDirectory, 'math.test.js'),
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { subtract } from '../src/math.js';\n\ntest('subtracts the right operand', () => {\n  assert.equal(subtract(9, 4), 5);\n});\n"
  );

  const beforeSource = readFileSync(sourcePath, 'utf8');
  const beforeTests = runTests(workspace);
  assert.notEqual(beforeTests.status, 0, 'The fixture test must fail before Cursor runs.');

  const provider = createCursor({ apiKey, logger: false });
  const toolCalls = new Map<
    string,
    { name: string; providerExecuted?: boolean; dynamic?: boolean }
  >();
  const toolResults = new Map<string, { providerExecuted?: boolean; dynamic?: boolean }>();
  let assistantText = '';

  try {
    const result = streamText({
      model: provider(process.env.CURSOR_MODEL ?? 'composer-2.5', {
        mode: 'agent',
        local: { cwd: workspace, sandboxOptions: { enabled: true } },
      }),
      prompt:
        'Run the test suite, diagnose the failing subtraction test, fix only src/math.js, and rerun the tests. Do not change the test or package.json.',
    });

    for await (const part of result.fullStream) {
      if (part.type === 'tool-call') {
        toolCalls.set(part.toolCallId, {
          name: part.toolName,
          providerExecuted: part.providerExecuted,
          dynamic: part.dynamic,
        });
      } else if (part.type === 'tool-result') {
        toolResults.set(part.toolCallId, {
          providerExecuted: part.providerExecuted,
          dynamic: part.dynamic,
        });
      } else if (part.type === 'text-delta') {
        assistantText += part.text;
      }
    }

    const afterSource = readFileSync(sourcePath, 'utf8');
    const afterTests = runTests(workspace);
    const pairedCallId = [...toolCalls.keys()].find((id) => toolResults.has(id));
    assert.ok(pairedCallId, 'Expected at least one Cursor tool call/result pair.');
    assert.equal(toolCalls.get(pairedCallId)?.providerExecuted, true);
    assert.equal(toolCalls.get(pairedCallId)?.dynamic, true);
    assert.equal(toolResults.get(pairedCallId)?.providerExecuted, true);
    assert.equal(toolResults.get(pairedCallId)?.dynamic, true);
    assert.notEqual(afterSource, beforeSource, 'Cursor did not edit the buggy source file.');
    assert.equal(afterTests.status, 0, `Tests still fail:\n${afterTests.output}`);

    console.log('Before source:\n', beforeSource);
    console.log('Before test result:', { status: beforeTests.status, output: beforeTests.output });
    console.log('After source:\n', afterSource);
    console.log('After test result:', { status: afterTests.status, output: afterTests.output });
    console.log(
      'Provider-executed tool activity:',
      [...toolCalls.entries()].map(([toolCallId, call]) => ({
        toolCallId,
        toolName: call.name,
        providerExecuted: call.providerExecuted,
        dynamic: call.dynamic,
        hasResult: toolResults.has(toolCallId),
      }))
    );
    console.log('Assistant response:\n', assistantText);
    console.log('Usage:', await result.usage);
    console.log('Cursor metadata:', (await result.providerMetadata)?.cursor);
  } finally {
    await provider.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
