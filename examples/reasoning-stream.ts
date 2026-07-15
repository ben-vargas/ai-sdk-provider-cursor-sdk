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
      model: provider(process.env.CURSOR_REASONING_MODEL ?? 'composer-2.5', {
        local: { cwd: process.cwd() },
      }),
      prompt: 'Reason briefly about the main architectural tradeoff, then give the answer.',
    });

    for await (const part of result.fullStream) {
      if (part.type === 'reasoning-start') process.stdout.write('[reasoning] ');
      if (part.type === 'reasoning-delta') process.stdout.write(part.text);
      if (part.type === 'reasoning-end') process.stdout.write('\n[answer] ');
      if (part.type === 'text-delta') process.stdout.write(part.text);
    }
    process.stdout.write('\n');
  } finally {
    await provider.close();
  }
}
