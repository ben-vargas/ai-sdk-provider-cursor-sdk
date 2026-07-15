/**
 * Lists the model catalog available to the current Cursor account.
 * Use account-specific discovery before selecting models or variants; composer-2.5 is this suite's
 * recommended default but model access is not uniform across accounts.
 *
 * Prerequisite: set CURSOR_API_KEY.
 */
import { AuthenticationError, Cursor } from '@cursor/sdk';

async function main(): Promise<void> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log('Skipping model discovery: set CURSOR_API_KEY to run it.');
    return;
  }

  try {
    const models = await Cursor.models.list({ apiKey });
    console.log(`Available models (${models.length}):`);
    for (const model of models) {
      const recommended = model.id === 'composer-2.5' ? ' [recommended default]' : '';
      console.log(`\n- ${model.id}${recommended}: ${model.displayName}`);
      if (model.aliases?.length) console.log(`  aliases: ${model.aliases.join(', ')}`);
      for (const parameter of model.parameters ?? []) {
        console.log(
          `  parameter ${parameter.id}: ${parameter.values.map((value) => value.value).join(', ')}`
        );
      }
      for (const variant of model.variants ?? []) {
        const values = variant.params.map((parameter) => `${parameter.id}=${parameter.value}`);
        console.log(
          `  variant ${variant.displayName}${variant.isDefault ? ' (default)' : ''}: ${values.join(', ')}`
        );
      }
    }

    if (!models.some((model) => model.id === 'composer-2.5')) {
      console.warn('composer-2.5 was not returned for this account; choose an available model ID.');
    }
  } catch (error) {
    if (error instanceof AuthenticationError) {
      console.error('Model discovery authentication failed. Check CURSOR_API_KEY and try again.');
      process.exitCode = 1;
      return;
    }
    console.error('Model discovery failed. Verify network access and Cursor account permissions.');
    throw error;
  }
}

await main();
