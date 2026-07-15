import { generateText } from 'ai';
import { createCursor } from '../src/index.js';

const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9xkAAAAASUVORK5CYII=';

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error('Set CURSOR_API_KEY before running this example.');
  process.exitCode = 1;
} else {
  const provider = createCursor({ apiKey });
  const model = provider(process.env.CURSOR_MODEL ?? 'auto', {
    mode: 'plan',
    createNewAgentPerCall: true,
  });
  try {
    const inline = await generateText({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this one-pixel image briefly.' },
            {
              type: 'file',
              mediaType: 'image/png',
              data: { type: 'data', data: ONE_PIXEL_PNG },
            },
          ],
        },
      ],
    });
    console.log('Inline image:', inline.text);

    const imageUrl = process.env.CURSOR_IMAGE_URL;
    if (imageUrl) {
      const remote = await generateText({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe the remote image briefly.' },
              {
                type: 'file',
                mediaType: 'image',
                data: { type: 'url', url: new URL(imageUrl) },
              },
            ],
          },
        ],
      });
      console.log('URL image:', remote.text);
    } else {
      console.log('Set CURSOR_IMAGE_URL to also exercise native URL image input.');
    }
  } finally {
    await provider.close();
  }
}
