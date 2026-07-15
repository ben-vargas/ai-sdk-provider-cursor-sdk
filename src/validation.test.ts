import { NoSuchModelError } from '@ai-sdk/provider';
import {
  parseCursorProviderOptions,
  validateCursorModelId,
  validateCursorSettings,
} from './validation.js';

describe('validation', () => {
  it('accepts known aliases and arbitrary non-empty model IDs', () => {
    expect(validateCursorModelId('auto')).toBe('auto');
    expect(validateCursorModelId('composer-2.5')).toBe('composer-2.5');
    expect(validateCursorModelId('account-specific-model')).toBe('account-specific-model');
  });

  it.each(['', '   ', undefined, 123])('throws NoSuchModelError for model id %#', (modelId) => {
    let thrown: unknown;
    try {
      validateCursorModelId(modelId as never);
    } catch (error) {
      thrown = error;
    }
    expect(NoSuchModelError.isInstance(thrown)).toBe(true);
    expect(thrown).toMatchObject({ modelType: 'languageModel', modelId });
  });

  it('returns parsed settings and aggregates validation issues into a plain Error', () => {
    expect(validateCursorSettings({ mode: 'plan' })).toEqual({ mode: 'plan' });
    expect(() =>
      validateCursorSettings({ agentId: '', createNewAgentPerCall: true } as never)
    ).toThrow(
      /Invalid Cursor settings: agentId, agent, and createNewAgentPerCall are mutually exclusive, agentId: agentId cannot be empty/
    );
  });

  it('uses the supplied validation label', () => {
    expect(() => validateCursorSettings({ unknown: true } as never, 'defaults')).toThrow(
      /^Invalid defaults:/
    );
  });

  it('parses absent call options as an empty object and rejects unknown keys', () => {
    expect(parseCursorProviderOptions(undefined)).toEqual({});
    expect(parseCursorProviderOptions(null)).toEqual({});
    expect(() => parseCursorProviderOptions({ unexpected: true })).toThrow(
      /^Invalid providerOptions\.cursor:/
    );
  });
});
