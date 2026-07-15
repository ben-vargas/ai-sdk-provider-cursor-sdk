import assert from 'node:assert/strict';
import { generateText, streamText } from 'ai';
import { createCursor } from '../src/index.js';

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error('Set CURSOR_API_KEY before running this manual integration test.');
  process.exitCode = 1;
} else {
  const provider = createCursor({ apiKey, logger: false });
  try {
    const model = provider(process.env.CURSOR_MODEL ?? 'auto', {
      mode: 'plan',
      local: { cwd: process.cwd() },
    });
    const first = await generateText({
      model,
      prompt: 'Reply with a short sentence containing cursor-sdk-integration-ok.',
    });
    assert.match(first.text, /cursor-sdk-integration-ok/i);

    const streamed = streamText({ model, prompt: 'Reply with the single word stream.' });
    let text = '';
    for await (const chunk of streamed.textStream) text += chunk;
    assert.ok(text.trim().length > 0);

    const agentId = (await streamed.providerMetadata)?.cursor?.agentId;
    assert.equal(typeof agentId, 'string');
    const resumed = await generateText({
      model: provider(process.env.CURSOR_MODEL ?? 'auto', { mode: 'plan' }),
      prompt: 'What special integration phrase appeared earlier?',
      providerOptions: { cursor: { agentId } },
    });
    assert.match(resumed.text, /cursor-sdk-integration-ok/i);
    console.log('Manual integration test passed.');
  } finally {
    await provider.close();
  }
}
