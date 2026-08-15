import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { extractJsonValue } from './extract-json-from-stdout.mjs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const root = resolve(import.meta.dirname, '..');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'cursor-provider-smoke-'));
const npmEnvironment = {
  ...process.env,
  // Keep all npm writes inside the disposable consumer, including installs.
  npm_config_cache: join(temporaryDirectory, 'npm-cache'),
  npm_config_logs_dir: join(temporaryDirectory, 'npm-logs'),
  npm_config_update_notifier: 'false',
};
let tarball;

try {
  const packed = extractJsonValue(
    execFileSync(npm, ['pack', '--json', '--ignore-scripts'], {
      cwd: root,
      encoding: 'utf8',
      env: npmEnvironment,
    })
  );
  const packedEntry = Array.isArray(packed) ? packed[0] : packed;
  assert.ok(
    packedEntry && typeof packedEntry === 'object' && 'filename' in packedEntry,
    'npm pack --json did not report a tarball filename'
  );
  tarball = resolve(root, String(packedEntry.filename));
  writeFileSync(
    join(temporaryDirectory, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        ai: '^7.0.16',
        'ai-sdk-provider-cursor-sdk': `file:${tarball}`,
        zod: '^4.1.12',
      },
    })
  );
  execFileSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: temporaryDirectory,
    env: npmEnvironment,
    stdio: 'inherit',
  });

  writeFileSync(
    join(temporaryDirectory, 'index.ts'),
    `
      import { generateText } from 'ai';
      import { createCursor, type CursorProviderOptions } from 'ai-sdk-provider-cursor-sdk';
      const options: CursorProviderOptions = { mode: 'agent' };
      const model = createCursor()('auto');
      const pending = generateText({ model, prompt: 'type-only smoke' });
      void options;
      void model;
      void pending;
    `
  );
  writeFileSync(
    join(temporaryDirectory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['index.ts'],
    })
  );
  execFileSync(
    process.execPath,
    [resolve(root, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
    {
      cwd: temporaryDirectory,
      env: npmEnvironment,
      stdio: 'inherit',
    }
  );

  const probe = `
    import assert from 'node:assert/strict';
    import { generateText } from 'ai';
    import { createCursor, isAuthenticationError } from 'ai-sdk-provider-cursor-sdk';
    const model = createCursor()('auto');
    assert.equal(model.specificationVersion, 'v4');
    try {
      await generateText({ model, prompt: 'smoke' });
      throw new Error('Expected a missing-key failure.');
    } catch (error) {
      assert.equal(isAuthenticationError(error), true);
    }
  `;
  const probeEnvironment = { ...npmEnvironment };
  delete probeEnvironment.CURSOR_API_KEY;
  execFileSync(process.execPath, ['--input-type=module', '--eval', probe], {
    cwd: temporaryDirectory,
    env: probeEnvironment,
    stdio: 'inherit',
  });

  assert.equal(
    JSON.parse(readFileSync(join(temporaryDirectory, 'package.json'), 'utf8')).type,
    'module'
  );
  console.log('Packed consumer smoke passed.');
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
  if (tarball) rmSync(tarball, { force: true });
}
