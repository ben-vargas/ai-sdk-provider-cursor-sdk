import { generateText } from 'ai';
import { createCursor } from '../src/index.js';

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error('Set CURSOR_API_KEY before running this example.');
  process.exitCode = 1;
} else {
  const provider = createCursor({ apiKey });
  try {
    const model = provider(process.env.CURSOR_MODEL ?? 'auto', {
      mode: 'plan',
      local: { cwd: process.cwd() },
    });
    await generateText({ model, prompt: 'Remember the phrase cobalt orchard.' });
    const reused = await generateText({ model, prompt: 'What phrase did I ask you to remember?' });
    console.log('Same model instance:', reused.text);

    const agentId = reused.providerMetadata?.cursor?.agentId;
    if (typeof agentId !== 'string') throw new Error('Cursor did not return an agentId.');

    const resumed = await generateText({
      model: provider(process.env.CURSOR_MODEL ?? 'auto', { mode: 'plan' }),
      prompt: 'Repeat the remembered phrase one last time.',
      providerOptions: { cursor: { agentId } },
    });
    console.log('Explicit resume:', resumed.text);
    console.log('agentId:', agentId);
  } finally {
    await provider.close();
  }
}
