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
        mode: 'plan',
        local: { cwd: process.cwd() },
      }),
      prompt: 'Reply with one sentence describing this package.',
    });

    const metadata = result.providerMetadata?.cursor;
    console.log('AI SDK usage:', result.usage);
    console.log('Raw Cursor usage:', metadata?.usage);
    console.log('Run metadata:', metadata);
  } finally {
    await provider.close();
  }
}
