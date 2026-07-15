import { generateText } from 'ai';
import { createCursor } from '../src/index.js';

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error('Set CURSOR_API_KEY before running this example.');
  process.exitCode = 1;
} else {
  const provider = createCursor({ apiKey });
  try {
    const result = await generateText({
      model: provider(process.env.CURSOR_MODEL ?? 'auto', {
        local: { cwd: process.cwd() },
      }),
      prompt: 'Summarize this repository in three concise bullets.',
    });

    console.log(result.text);
    console.log('Finish reason:', result.finishReason);
    console.log('Usage:', result.usage);
    console.log('Cursor metadata:', result.providerMetadata?.cursor);
  } finally {
    await provider.close();
  }
}
