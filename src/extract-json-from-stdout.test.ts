import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { extractJsonValue } = (await import(
  new URL('../../scripts/extract-json-from-stdout.mjs', import.meta.url).href
)) as { extractJsonValue: (text: string) => unknown };

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '__tests__/fixtures/npm-pack-json-with-notice.txt'),
  'utf8'
);

describe('extractJsonValue', () => {
  it('parses npm pack --json when notices precede the array', () => {
    expect(extractJsonValue(fixture)).toEqual([
      {
        id: 'ai-sdk-provider-cursor-sdk@1.0.0',
        name: 'ai-sdk-provider-cursor-sdk',
        filename: 'ai-sdk-provider-cursor-sdk-1.0.0.tgz',
        filename_escaped: 'file-with-"quotes"-and-{braces}.tgz',
      },
    ]);
  });

  it('parses an object payload after a warning line', () => {
    expect(
      extractJsonValue('npm warn Unknown env config "cache"\n{"filename":"pkg.tgz"}\n')
    ).toEqual({ filename: 'pkg.tgz' });
  });

  it('throws when stdout has no JSON value', () => {
    expect(() => extractJsonValue('npm notice nothing packed\n')).toThrow(SyntaxError);
  });
});
