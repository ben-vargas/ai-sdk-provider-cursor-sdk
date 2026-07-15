import { Cursor } from '@cursor/sdk';

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error('Set CURSOR_API_KEY before running this example.');
  process.exitCode = 1;
} else {
  const models = await Cursor.models.list({ apiKey });
  for (const model of models) {
    console.log(`\n${model.id}: ${model.displayName}`);
    if (model.aliases?.length) console.log('  aliases:', model.aliases.join(', '));
    if (model.parameters?.length) console.dir(model.parameters, { depth: null });
    if (model.variants?.length) console.dir(model.variants, { depth: null });
  }
}
