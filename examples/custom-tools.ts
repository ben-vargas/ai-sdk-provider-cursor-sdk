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
        local: { cwd: process.cwd(), sandboxOptions: { enabled: true } },
        customTools: {
          repository_label: {
            description: 'Return a deterministic label for the current repository.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            execute() {
              return { repository: 'ai-sdk-provider-cursor-sdk', kind: 'provider' };
            },
          },
        },
      }),
      prompt: 'Call repository_label and report its exact result.',
    });

    console.log(result.text);
  } finally {
    await provider.close();
  }
}
