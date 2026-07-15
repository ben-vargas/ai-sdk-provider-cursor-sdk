import type { LanguageModelV3CallOptions, SharedV3Warning } from '@ai-sdk/provider';
import type { CursorSettings } from './settings.js';

function unsupported(feature: string, details: string): SharedV3Warning {
  return { type: 'unsupported', feature, details };
}

export function hasCallerHeaders(headers: LanguageModelV3CallOptions['headers']): boolean {
  return Object.entries(headers ?? {}).some(
    ([name, value]) =>
      value !== undefined &&
      !(name.toLowerCase() === 'user-agent' && /^ai\/\d+(?:\.\d+)*(?:[-+][\w.-]+)?$/.test(value))
  );
}

export function generateAllWarnings(
  options: LanguageModelV3CallOptions,
  _settings: CursorSettings
): SharedV3Warning[] {
  const warnings: SharedV3Warning[] = [];
  const unsupportedSettings: Array<[string, unknown]> = [
    ['temperature', options.temperature],
    ['topP', options.topP],
    ['topK', options.topK],
    ['presencePenalty', options.presencePenalty],
    ['frequencyPenalty', options.frequencyPenalty],
    ['seed', options.seed],
  ];
  for (const [feature, value] of unsupportedSettings) {
    if (value !== undefined) {
      warnings.push(
        unsupported(feature, `Cursor SDK does not support ${feature}; it will be ignored.`)
      );
    }
  }
  if (options.stopSequences && options.stopSequences.length > 0) {
    warnings.push(
      unsupported('stopSequences', 'Cursor SDK does not support stopSequences; it will be ignored.')
    );
  }
  if (options.maxOutputTokens !== undefined) {
    warnings.push(
      unsupported(
        'maxOutputTokens',
        'Cursor SDK does not accept an output token cap; it will be ignored.'
      )
    );
  }
  if (options.tools && options.tools.length > 0) {
    warnings.push(
      unsupported(
        'tools',
        'Cursor executes its own tools; AI SDK tools cannot be bridged at the provider layer and will be ignored. To add Cursor-executed tools, use the customTools setting (local agents) or mcpServers.'
      )
    );
  }
  if (options.toolChoice) {
    warnings.push(
      unsupported(
        'toolChoice',
        `Cursor SDK does not support toolChoice '${options.toolChoice.type}'; only automatic tool selection is available.`
      )
    );
  }
  if (options.responseFormat?.type === 'json') {
    warnings.push(
      unsupported(
        'responseFormat',
        'Cursor SDK has no schema-constrained output; the JSON responseFormat is ignored and the call is treated as plain text. Validate client-side.'
      )
    );
  }
  if (hasCallerHeaders(options.headers)) {
    warnings.push({
      type: 'other',
      message: 'The headers option has no effect: the Cursor SDK owns its transport.',
    });
  }
  return warnings;
}
