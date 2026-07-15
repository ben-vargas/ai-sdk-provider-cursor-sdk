import { generateText } from 'ai';
import { createCursor, type Logger } from '../src/index.js';

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error('Set CURSOR_API_KEY before running this example.');
  process.exitCode = 1;
} else {
  const logger: Logger = {
    debug: (message, ...details) => console.error('[debug]', message, ...details),
    info: (message, ...details) => console.error('[info]', message, ...details),
    warn: (message, ...details) => console.error('[warn]', message, ...details),
    error: (message, ...details) => console.error('[error]', message, ...details),
  };
  const provider = createCursor({ apiKey, logger });
  try {
    const result = await generateText({
      model: provider(process.env.CURSOR_MODEL ?? 'auto', {
        mode: 'plan',
        local: { cwd: process.cwd() },
        verbose: true,
        onRunCreated: (run) => logger.info('Cursor run created', run.id, run.requestId),
        onRunResult: (run) => logger.info('Cursor run settled', run.id, run.status),
      }),
      prompt: 'Reply with a one-line package description.',
    });
    console.log(result.text);
  } finally {
    await provider.close();
  }
}
