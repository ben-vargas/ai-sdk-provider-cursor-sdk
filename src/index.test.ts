import type { LanguageModelV3, ProviderV3 } from '@ai-sdk/provider';
import * as publicApi from './index.js';
import {
  createCursor,
  cursor,
  type CursorModelId,
  type CursorErrorMetadata,
  type CursorPromptHistoryMode,
  type CursorProvider,
  type CursorProviderMetadata,
  type CursorProviderOptions,
  type CursorProviderSettings,
  type CursorSettings,
  type CursorSystemMessageMode,
  type Logger,
  type NormalizedEvent,
} from './index.js';

type PublicTypeSurface = {
  CursorProvider: CursorProvider;
  CursorProviderSettings: CursorProviderSettings;
  CursorModelId: CursorModelId;
  CursorPromptHistoryMode: CursorPromptHistoryMode;
  CursorProviderMetadata: CursorProviderMetadata;
  CursorProviderOptions: CursorProviderOptions;
  CursorSettings: CursorSettings;
  CursorSystemMessageMode: CursorSystemMessageMode;
  Logger: Logger;
  CursorErrorMetadata: CursorErrorMetadata;
  NormalizedEvent: NormalizedEvent;
};

describe('public API', () => {
  it('exports exactly the documented runtime surface', () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      'CursorLanguageModel',
      'createCursor',
      'cursor',
      'isAgentBusyError',
      'isAuthenticationError',
      'isStaleAgentError',
    ]);
  });

  it('instantiates a typed v3 provider with a fake key', async () => {
    const settings = { mode: 'plan' } satisfies CursorSettings;
    const provider: CursorProvider = createCursor({ apiKey: 'fake-cursor-key' });
    const providerV3: ProviderV3 = provider;
    const model: LanguageModelV3 = provider('auto', settings);

    expect(providerV3.specificationVersion).toBe('v3');
    expect(model.specificationVersion).toBe('v3');
    expect(model.provider).toBe('cursor-sdk');
    expect(cursor.specificationVersion).toBe('v3');

    await provider.close();
  });

  it('exposes the documented public types', () => {
    const allTypes: PublicTypeSurface | undefined = undefined;
    const event: NormalizedEvent = {
      kind: 'raw',
      value: { future: true },
      conditional: true,
    };
    const metadata: CursorErrorMetadata = { operation: 'agent.send' };
    expect(event.kind).toBe('raw');
    expect(metadata.operation).toBe('agent.send');
    expect(allTypes).toBeUndefined();
  });
});
