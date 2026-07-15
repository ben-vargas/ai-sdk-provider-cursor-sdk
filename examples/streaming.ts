import { streamText } from 'ai';
import { createCursor } from '../src/index.js';

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error('Set CURSOR_API_KEY before running this example.');
  process.exitCode = 1;
} else {
  const provider = createCursor({ apiKey });
  try {
    const result = streamText({
      model: provider(process.env.CURSOR_MODEL ?? 'auto', {
        local: { cwd: process.cwd() },
      }),
      prompt: 'Find the repository entry point and explain it briefly.',
    });

    for await (const chunk of result.textStream) process.stdout.write(chunk);
    process.stdout.write('\n');
    console.log('Finish reason:', await result.finishReason);
  } finally {
    await provider.close();
  }
}
