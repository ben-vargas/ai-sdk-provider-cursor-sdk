import { streamText } from 'ai';
import { createCursor } from '../src/index.js';

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error('Set CURSOR_API_KEY before running this example.');
  process.exitCode = 1;
} else {
  const provider = createCursor({ apiKey });
  const controller = new AbortController();
  const reason = new DOMException('Example timeout', 'AbortError');
  const timeout = setTimeout(() => controller.abort(reason), 1_000);
  try {
    const result = streamText({
      model: provider(process.env.CURSOR_MODEL ?? 'auto', {
        local: { cwd: process.cwd() },
      }),
      prompt: 'Perform a careful repository review before answering.',
      abortSignal: controller.signal,
    });
    for await (const chunk of result.textStream) process.stdout.write(chunk);
  } catch (error) {
    console.error('\nAborted with original reason:', error === reason, error);
  } finally {
    clearTimeout(timeout);
    await provider.close();
  }
}
