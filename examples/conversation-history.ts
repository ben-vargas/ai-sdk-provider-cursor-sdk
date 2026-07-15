import { generateText } from 'ai';
import { createCursor } from '../src/index.js';

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error('Set CURSOR_API_KEY before running this example.');
  process.exitCode = 1;
} else {
  const provider = createCursor({ apiKey, logger: false });
  const messages = [
    { role: 'user' as const, content: 'My project codename is Juniper.' },
    { role: 'assistant' as const, content: 'Understood.' },
    { role: 'user' as const, content: 'What codename appeared in this transcript?' },
  ];
  try {
    const ignored = await generateText({
      model: provider(process.env.CURSOR_MODEL ?? 'auto', {
        mode: 'plan',
        createNewAgentPerCall: true,
        promptHistoryMode: 'ignore',
      }),
      messages,
    });
    console.log('ignore:', ignored.text);
    console.log('ignore warnings:', ignored.warnings);

    const flattened = await generateText({
      model: provider(process.env.CURSOR_MODEL ?? 'auto', {
        mode: 'plan',
        createNewAgentPerCall: true,
        promptHistoryMode: 'flatten',
      }),
      messages,
    });
    console.log('flatten:', flattened.text);
    console.log('flatten warnings:', flattened.warnings);
  } finally {
    await provider.close();
  }
}
