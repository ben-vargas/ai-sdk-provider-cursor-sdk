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
        local: { cwd: process.cwd(), sandboxOptions: { enabled: true } },
      }),
      prompt: 'Use a read-only tool to list TypeScript files, then summarize the entry point.',
    });

    for await (const part of result.fullStream) {
      if (part.type === 'tool-call') {
        console.log('tool-call', part.toolName, part.toolCallId, part.input);
      } else if (part.type === 'tool-result') {
        console.log('tool-result', part.toolName, part.toolCallId, part.output);
      } else if (part.type === 'text-delta') {
        process.stdout.write(part.text);
      }
    }
    process.stdout.write('\n');
  } finally {
    await provider.close();
  }
}
