import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';
import { generateAllWarnings, hasCallerHeaders } from './warnings.js';

function options(overrides: Partial<LanguageModelV3CallOptions> = {}): LanguageModelV3CallOptions {
  return {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    ...overrides,
  };
}

describe('generateAllWarnings', () => {
  it.each([
    ['temperature', 0.2],
    ['topP', 0.9],
    ['topK', 20],
    ['presencePenalty', 0.1],
    ['frequencyPenalty', 0.3],
    ['seed', 42],
  ] as const)('warns for unsupported %s', (feature, value) => {
    expect(generateAllWarnings(options({ [feature]: value }), {})).toEqual([
      {
        type: 'unsupported',
        feature,
        details: `Cursor SDK does not support ${feature}; it will be ignored.`,
      },
    ]);
  });

  it('warns once for each remaining unsupported generation control', () => {
    const warnings = generateAllWarnings(
      options({
        stopSequences: ['STOP'],
        maxOutputTokens: 100,
        tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object' } }],
        toolChoice: { type: 'required' },
        responseFormat: { type: 'json', schema: { type: 'object' } },
      }),
      {}
    );

    expect(warnings.map((warning) => ('feature' in warning ? warning.feature : undefined))).toEqual(
      ['stopSequences', 'maxOutputTokens', 'tools', 'toolChoice', 'responseFormat']
    );
    expect(warnings).toContainEqual({
      type: 'unsupported',
      feature: 'stopSequences',
      details: 'Cursor SDK does not support stopSequences; it will be ignored.',
    });
    expect(warnings).toContainEqual({
      type: 'unsupported',
      feature: 'maxOutputTokens',
      details: 'Cursor SDK does not accept an output token cap; it will be ignored.',
    });
    expect(warnings).toContainEqual({
      type: 'unsupported',
      feature: 'tools',
      details:
        'Cursor executes its own tools; AI SDK tools cannot be bridged at the provider layer and will be ignored. To add Cursor-executed tools, use the customTools setting (local agents) or mcpServers.',
    });
  });

  it.each(['none', 'required'] as const)('warns for toolChoice %s', (type) => {
    expect(generateAllWarnings(options({ toolChoice: { type } }), {})).toContainEqual({
      type: 'unsupported',
      feature: 'toolChoice',
      details: `Cursor SDK does not support toolChoice '${type}'; only automatic tool selection is available.`,
    });
  });

  it('warns for a named tool choice', () => {
    expect(
      generateAllWarnings(options({ toolChoice: { type: 'tool', toolName: 'lookup' } }), {})
    ).toContainEqual({
      type: 'unsupported',
      feature: 'toolChoice',
      details:
        "Cursor SDK does not support toolChoice 'tool'; only automatic tool selection is available.",
    });
  });

  it('warns for schema-less JSON response format with the full diagnostic', () => {
    expect(generateAllWarnings(options({ responseFormat: { type: 'json' } }), {})).toEqual([
      {
        type: 'unsupported',
        feature: 'responseFormat',
        details:
          'Cursor SDK has no schema-constrained output; the JSON responseFormat is ignored and the call is treated as plain text. Validate client-side.',
      },
    ]);
  });

  it('warns for automatic tool choice because V3 preserves explicit user intent', () => {
    expect(generateAllWarnings(options({ toolChoice: { type: 'auto' } }), {})).toEqual([
      {
        type: 'unsupported',
        feature: 'toolChoice',
        details:
          "Cursor SDK does not support toolChoice 'auto'; only automatic tool selection is available.",
      },
    ]);
  });

  it('ignores empty stop sequences and empty tools', () => {
    expect(generateAllWarnings(options({ stopSequences: [], tools: [] }), {})).toEqual([]);
  });

  it('warns only for caller-supplied headers', () => {
    expect(hasCallerHeaders(undefined)).toBe(false);
    expect(hasCallerHeaders({ 'user-agent': 'ai/6.0.3' })).toBe(false);
    expect(hasCallerHeaders({ 'User-Agent': 'ai/6.0.3-beta.1' })).toBe(false);
    expect(hasCallerHeaders({ authorization: undefined })).toBe(false);
    expect(hasCallerHeaders({ 'user-agent': 'custom-agent' })).toBe(true);
    expect(hasCallerHeaders({ 'x-request-id': 'request-1' })).toBe(true);
    expect(hasCallerHeaders({ 'user-agent': 'ai/6.0.3', 'x-request-id': 'request-1' })).toBe(true);

    expect(generateAllWarnings(options({ headers: { 'user-agent': 'ai/6.0.3' } }), {})).toEqual([]);

    expect(generateAllWarnings(options({ headers: { 'x-request-id': 'request-1' } }), {})).toEqual([
      {
        type: 'other',
        message: 'The headers option has no effect: the Cursor SDK owns its transport.',
      },
    ]);
  });
});
