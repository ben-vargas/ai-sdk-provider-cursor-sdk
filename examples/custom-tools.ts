/**
 * Demonstrates a local in-process Cursor custom tool and its provider-executed dynamic tool parts.
 * Use this for callbacks Cursor's own tool loop should invoke; AI SDK application tools are separate
 * and are not bridged by this provider. Live-smoke custom tools for your target runtime before release.
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
    console.log('Skipping custom tools example: set CURSOR_API_KEY to run it.');
    return;
  }

  const workspace = mkdtempSync(join(tmpdir(), 'cursor-custom-tool-example-'));
  const invocations: Array<{ args: Record<string, unknown>; toolCallId?: string }> = [];
  const provider = createCursor({ apiKey, logger: false });
  try {
    const result = await generateText({
      model: provider(process.env.CURSOR_MODEL ?? 'composer-2.5', {
        mode: 'agent',
        local: { cwd: workspace, sandboxOptions: { enabled: true } },
        customTools: {
          estimate_release_days: {
            description:
              'Estimate whole working days from remaining task count and daily velocity.',
            inputSchema: {
              type: 'object',
              properties: {
                remainingTasks: { type: 'number' },
                tasksPerDay: { type: 'number' },
              },
              required: ['remainingTasks', 'tasksPerDay'],
              additionalProperties: false,
            },
            execute(args, context) {
              invocations.push({ args, toolCallId: context.toolCallId });
              const remainingTasks = Number(args.remainingTasks);
              const tasksPerDay = Number(args.tasksPerDay);
              return {
                estimatedWorkingDays: Math.ceil(remainingTasks / tasksPerDay),
                basis: { remainingTasks, tasksPerDay },
              };
            },
          },
        },
      }),
      prompt:
        'Call estimate_release_days with 11 remaining tasks and a velocity of 4 tasks per day. Then report the estimate and its basis.',
    });

    assert.ok(invocations.length > 0, 'Cursor did not invoke the custom callback.');
    const callbackCallId = invocations[0]?.toolCallId;
    const toolCall =
      result.dynamicToolCalls.find((part) => part.toolCallId === callbackCallId) ??
      result.dynamicToolCalls.find((part) => part.providerExecuted === true);
    const toolResult =
      result.dynamicToolResults.find((part) => part.toolCallId === toolCall?.toolCallId) ??
      result.dynamicToolResults.find((part) => part.providerExecuted === true);
    assert.equal(toolCall?.providerExecuted, true);
    assert.equal(toolCall?.dynamic, true);
    assert.equal(toolResult?.providerExecuted, true);
    assert.equal(toolResult?.dynamic, true);

    console.log('Callback invocation:', invocations[0]);
    console.log('Provider-executed tool parts:', {
      call: toolCall && {
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        providerExecuted: toolCall.providerExecuted,
        dynamic: toolCall.dynamic,
      },
      result: toolResult && {
        toolName: toolResult.toolName,
        toolCallId: toolResult.toolCallId,
        providerExecuted: toolResult.providerExecuted,
        dynamic: toolResult.dynamic,
      },
    });
    console.log('Assistant response:\n', result.text);
    console.log('Cursor metadata:', result.providerMetadata?.cursor);
  } finally {
    await provider.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
