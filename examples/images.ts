/**
 * Demonstrates live-validated inline image input using a meaningful bundled fixture.
 * Pass an optional local image path as the first CLI argument to inspect your own image instead.
 * Remote image URLs are intentionally excluded until that path is separately live-validated.
 *
 * Prerequisite: set CURSOR_API_KEY. CURSOR_MODEL optionally overrides composer-2.5.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateText } from 'ai';
import { createCursor } from '../src/index.js';

function imageMediaType(path: string): string {
  const types: Record<string, string> = {
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };
  const mediaType = types[extname(path).toLowerCase()];
  if (!mediaType) throw new Error(`Unsupported image extension: ${extname(path) || '(none)'}`);
  return mediaType;
}

async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log('Skipping image example: set CURSOR_API_KEY to run it.');
    return;
  }

  const bundledImage = fileURLToPath(new URL('./assets/shape-comparison.svg', import.meta.url));
  const imagePath = process.argv[2] ? resolve(process.argv[2]) : bundledImage;
  const workspace = mkdtempSync(join(tmpdir(), 'cursor-image-example-'));
  const provider = createCursor({ apiKey });
  try {
    const result = await generateText({
      model: provider(process.env.CURSOR_MODEL ?? 'composer-2.5', {
        mode: 'plan',
        local: { cwd: workspace },
      }),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Identify the largest shape in this image, name its color, and compare its size with the other shapes.',
            },
            {
              type: 'file',
              filename: imagePath,
              mediaType: imageMediaType(imagePath),
              data: readFileSync(imagePath),
            },
          ],
        },
      ],
    });

    console.log('Image:', imagePath);
    console.log('Description:\n', result.text);
    console.log('Finish reason:', result.finishReason);
    console.log('Usage:', result.usage);
    console.log('Cursor metadata:', result.providerMetadata?.cursor);
  } finally {
    await provider.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
