import { generateText } from 'ai';
import {
  createCursor,
  isAgentBusyError,
  isAuthenticationError,
  isStaleAgentError,
} from '../src/index.js';

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error('Set CURSOR_API_KEY before running this example.');
  process.exitCode = 1;
} else {
  const provider = createCursor({ apiKey, logger: false });
  try {
    const result = await generateText({
      model: provider(process.env.CURSOR_MODEL ?? 'auto', {
        mode: 'plan',
        createNewAgentPerCall: true,
      }),
      prompt: 'Reply with the word healthy.',
    });
    console.log(result.text);
  } catch (error) {
    if (isAuthenticationError(error)) console.error('Authentication failed. Check the API key.');
    else if (isStaleAgentError(error)) console.error('The saved agent ID is stale.');
    else if (isAgentBusyError(error)) console.error('The cloud agent has an active run.');
    else console.error('Cursor call failed:', error);

    if (error && typeof error === 'object' && 'data' in error) {
      console.error('Mapped Cursor metadata:', error.data);
    }
    process.exitCode = 1;
  } finally {
    await provider.close();
  }
}
