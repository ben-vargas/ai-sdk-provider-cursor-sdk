import type { LanguageModelV3FunctionTool } from '@ai-sdk/provider';
import { createCursor } from '../src/index.js';

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error('Set CURSOR_API_KEY before running this example.');
  process.exitCode = 1;
} else {
  const provider = createCursor({ apiKey, logger: false });
  const tool: LanguageModelV3FunctionTool = {
    type: 'function',
    name: 'application_tool',
    inputSchema: { type: 'object', properties: {} },
  };
  try {
    const result = await provider(process.env.CURSOR_MODEL ?? 'auto', {
      mode: 'plan',
      createNewAgentPerCall: true,
      promptHistoryMode: 'flatten',
      systemMessageMode: 'prefix',
    }).doGenerate({
      prompt: [
        { role: 'system', content: 'This becomes a lossy text prefix.' },
        { role: 'user', content: [{ type: 'text', text: 'Earlier turn.' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer.' }] },
        { role: 'user', content: [{ type: 'text', text: 'Reply with plain text.' }] },
      ],
      temperature: 0.2,
      topP: 0.9,
      topK: 20,
      presencePenalty: 0.1,
      frequencyPenalty: 0.1,
      seed: 7,
      stopSequences: ['STOP'],
      maxOutputTokens: 32,
      tools: [tool],
      toolChoice: { type: 'required' },
      responseFormat: { type: 'json' },
      headers: { 'x-example': 'limitations' },
    });

    console.log('Generated text:', result.content);
    console.log('Warnings:');
    console.dir(result.warnings, { depth: null });
  } finally {
    await provider.close();
  }
}
