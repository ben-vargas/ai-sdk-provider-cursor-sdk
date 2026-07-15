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
        mode: 'plan',
        local: { cwd: process.cwd() },
      }),
      prompt: 'Reply with a short repository description.',
      includeRawChunks: true,
    });

    for await (const part of result.fullStream) {
      if (part.type === 'raw') console.dir(part.rawValue, { depth: null });
      if (part.type === 'text-delta') process.stdout.write(part.text);
    }
    process.stdout.write('\n');
  } finally {
    await provider.close();
  }
}
