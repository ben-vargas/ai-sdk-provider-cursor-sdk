import type { CursorProvider } from '../../cursor-provider.js';
import { generateText, streamText } from 'ai';

const apiKey = process.env.CURSOR_API_KEY;
const reasoningModel = process.env.CURSOR_REASONING_MODEL;
const integrationEnabled = process.env.CURSOR_INTEGRATION === '1';

async function createLiveProvider(): Promise<CursorProvider> {
  vi.doUnmock('@cursor/sdk');
  const { createCursor } = await import('../../cursor-provider.js');
  return createCursor({ apiKey, logger: false });
}

describe.skipIf(!integrationEnabled || !apiKey)('cursor-sdk live', () => {
  it('A-1/A-2/A-14 basic generateText returns terminal-consistent text and sane usage', async () => {
    const provider = await createLiveProvider();
    try {
      const result = await generateText({
        model: provider('auto', { mode: 'plan', createNewAgentPerCall: true }),
        prompt: 'Reply with exactly: cursor-sdk-live-ok',
      });
      expect(result.text.trim().length).toBeGreaterThan(0);
      expect(result.finishReason).toBe('stop');
      expect(result.usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(result.providerMetadata?.cursor).toMatchObject({ status: 'finished' });
      const terminalText = result.providerMetadata?.cursor?.result;
      if (typeof terminalText === 'string') expect(result.text).toBe(terminalText);
    } finally {
      await provider.close();
    }
  }, 120_000);

  it('A-1/A-2 streamText preserves all streamed text through completion', async () => {
    const provider = await createLiveProvider();
    try {
      const result = streamText({
        model: provider('auto', { mode: 'plan', createNewAgentPerCall: true }),
        prompt: 'Reply briefly with the word stream.',
      });
      let streamed = '';
      for await (const part of result.textStream) streamed += part;
      expect(streamed.trim().length).toBeGreaterThan(0);
      await expect(result.text).resolves.toBe(streamed);
    } finally {
      await provider.close();
    }
  }, 120_000);

  // Valid 32x32 RGB red PNG. The old 1px fixture had a bad IDAT CRC and zlib checksum.
  it('A-10 sends inline image input through the live provider', async () => {
    const provider = await createLiveProvider();
    try {
      const model = provider('auto', { mode: 'plan', createNewAgentPerCall: true });
      const result = await model.doGenerate({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What color is this image? Reply with the color name.' },
              {
                type: 'file',
                mediaType: 'image/png',
                data: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==',
              },
            ],
          },
        ],
      });
      expect(result.content.some((part) => part.type === 'text' && /red/i.test(part.text))).toBe(
        true
      );
    } finally {
      await provider.close();
    }
  }, 120_000);

  it('A-4/A-5 reports internally consistent live usage', async () => {
    const provider = await createLiveProvider();
    try {
      const result = await provider('auto', {
        mode: 'plan',
        createNewAgentPerCall: true,
      }).doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Reply with usage.' }] }],
      });
      const raw = result.usage.raw;
      if (raw) {
        expect(raw.totalTokens).toBe(
          Number(raw.inputTokens) +
            Number(raw.outputTokens) +
            Number(raw.cacheReadTokens) +
            Number(raw.cacheWriteTokens)
        );
      }
    } finally {
      await provider.close();
    }
  }, 120_000);

  it.skipIf(!reasoningModel)(
    'A-3 streams reasoning from a configured reasoning-capable model',
    async () => {
      const provider = await createLiveProvider();
      try {
        const result = await provider(reasoningModel!, {
          mode: 'plan',
          createNewAgentPerCall: true,
        }).doGenerate({
          prompt: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Briefly reason, then answer: what is 17 + 25?' }],
            },
          ],
        });
        expect(
          result.content.some((part) => part.type === 'reasoning' && part.text.trim().length > 0)
        ).toBe(true);
      } finally {
        await provider.close();
      }
    },
    120_000
  );

  it('A-7 resumes a session from providerMetadata.cursor.agentId', async () => {
    const provider = await createLiveProvider();
    try {
      const first = await provider('auto', { mode: 'plan' }).doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Remember number 731.' }] }],
      });
      const agentId = first.providerMetadata?.cursor?.agentId;
      expect(typeof agentId).toBe('string');
      const second = await provider('auto', { mode: 'plan' }).doGenerate({
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'What number did I give you?' }] },
        ],
        providerOptions: { cursor: { agentId } },
      });
      expect(second.content.some((part) => part.type === 'text' && part.text.includes('731'))).toBe(
        true
      );
    } finally {
      await provider.close();
    }
  }, 180_000);

  it('A-11 aborts a live run with the original signal reason', async () => {
    const provider = await createLiveProvider();
    const controller = new AbortController();
    const reason = new DOMException('live abort', 'AbortError');
    const timeout = setTimeout(() => controller.abort(reason), 250);
    try {
      await expect(
        generateText({
          model: provider('auto', { mode: 'plan', createNewAgentPerCall: true }),
          prompt: 'Think carefully for a while before answering.',
          abortSignal: controller.signal,
        })
      ).rejects.toBe(reason);
    } finally {
      clearTimeout(timeout);
      await provider.close();
    }
  }, 120_000);
});
