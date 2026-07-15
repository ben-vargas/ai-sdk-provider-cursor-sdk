import { generateText } from 'ai';
import { createCursor } from '../src/index.js';

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error('Set CURSOR_API_KEY before running this example.');
  process.exitCode = 1;
} else {
  const repository = process.env.CURSOR_CLOUD_REPO;
  const provider = createCursor({ apiKey });
  try {
    const result = await generateText({
      model: provider(process.env.CURSOR_MODEL ?? 'auto', {
        mode: 'plan',
        createNewAgentPerCall: true,
        cloud: {
          ...(repository
            ? {
                repos: [
                  {
                    url: repository,
                    startingRef: process.env.CURSOR_CLOUD_REF ?? 'main',
                  },
                ],
              }
            : {}),
          autoCreatePR: process.env.CURSOR_CLOUD_AUTO_PR === '1',
        },
      }),
      prompt: repository
        ? 'Summarize the repository without changing files.'
        : 'Reply with a brief confirmation that the cloud agent is running.',
    });

    console.log(result.text);
    console.log('Cloud metadata:', result.providerMetadata?.cursor);
  } finally {
    await provider.close();
  }
}
