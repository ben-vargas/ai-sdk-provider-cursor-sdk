import {
  LoadAPIKeyError,
  NoSuchModelError,
  type LanguageModelV4CallOptions,
} from '@ai-sdk/provider';
import { CursorLanguageModel } from './cursor-language-model.js';
import { createCursor, cursor } from './cursor-provider.js';
import { FakeSDKAgent, loadDeltaFixture } from './__tests__/fixtures/fake-cursor-sdk.js';
import { mockAgentCreate, resetCursorSdkMock } from './__tests__/fixtures/mock-cursor-sdk.js';

const prompt: LanguageModelV4CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
};

describe('createCursor', () => {
  const originalApiKey = process.env.CURSOR_API_KEY;

  beforeEach(() => {
    resetCursorSdkMock();
    delete process.env.CURSOR_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = originalApiKey;
  });

  it('creates callable, languageModel, and chat V4 model factories', () => {
    const provider = createCursor({ apiKey: 'key', logger: false });
    expect(provider.specificationVersion).toBe('v4');
    expect(provider('auto')).toBeInstanceOf(CursorLanguageModel);
    expect(provider('account-model')).toMatchObject({
      specificationVersion: 'v4',
      provider: 'cursor-sdk',
      modelId: 'account-model',
      supportedUrls: { 'image/*': [expect.any(RegExp)] },
    });
    expect(provider.languageModel('auto').modelId).toBe('auto');
    expect(provider.chat('composer-2.5').modelId).toBe('composer-2.5');
    expect(cursor.specificationVersion).toBe('v4');
    expect('files' in provider).toBe(false);
    expect('skills' in provider).toBe(false);
  });

  it('rejects constructor invocation and blank language model IDs', () => {
    const provider = createCursor({ apiKey: 'key', logger: false });
    const ProviderConstructor = provider as unknown as new (id: string) => unknown;
    expect(() => new ProviderConstructor('auto')).toThrow(/cannot be called with the new keyword/);
    let thrown: unknown;
    try {
      provider('   ');
    } catch (error) {
      thrown = error;
    }
    expect(NoSuchModelError.isInstance(thrown)).toBe(true);
    expect(thrown).toMatchObject({ modelType: 'languageModel', modelId: '   ' });
  });

  it.each([
    ['embeddingModel', 'embed', 'embeddingModel'],
    ['imageModel', 'image', 'imageModel'],
  ] as const)('throws NoSuchModelError from %s', (method, modelId, modelType) => {
    const provider = createCursor({ logger: false });
    let thrown: unknown;
    try {
      provider[method](modelId);
    } catch (error) {
      thrown = error;
    }
    expect(NoSuchModelError.isInstance(thrown)).toBe(true);
    expect(thrown).toMatchObject({ modelId, modelType });
  });

  it('does not expose the removed V3 textEmbeddingModel alias', () => {
    const provider = createCursor({ logger: false });
    expect('textEmbeddingModel' in provider).toBe(false);
  });

  it('resolves API keys in model, provider, then environment precedence', async () => {
    process.env.CURSOR_API_KEY = 'environment-key';
    const cases = [
      {
        providerKey: 'provider-key',
        modelKey: 'model-key',
        expected: 'model-key',
      },
      { providerKey: 'provider-key', modelKey: undefined, expected: 'provider-key' },
      { providerKey: undefined, modelKey: undefined, expected: 'environment-key' },
    ];

    for (const item of cases) {
      resetCursorSdkMock();
      const agent = new FakeSDKAgent(loadDeltaFixture('text-only'));
      mockAgentCreate.mockResolvedValue(agent);
      const provider = createCursor({ apiKey: item.providerKey, logger: false });
      await provider('auto', item.modelKey ? { apiKey: item.modelKey } : {}).doGenerate(prompt);
      expect(mockAgentCreate).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: item.expected })
      );
      await provider.close();
    }
  });

  it('constructs models lazily and throws LoadAPIKeyError before SDK acquisition', async () => {
    const provider = createCursor({ logger: false });
    const model = provider('auto');
    expect(mockAgentCreate).not.toHaveBeenCalled();
    let thrown: unknown;
    try {
      await model.doGenerate(prompt);
    } catch (error) {
      thrown = error;
    }
    expect(LoadAPIKeyError.isInstance(thrown)).toBe(true);
    expect(String((thrown as Error).message)).toContain('CURSOR_API_KEY');
    expect(mockAgentCreate).not.toHaveBeenCalled();
  });

  it('shallow-merges provider defaults under model settings', async () => {
    const agent = new FakeSDKAgent(loadDeltaFixture('text-only'));
    mockAgentCreate.mockResolvedValue(agent);
    const provider = createCursor({
      apiKey: 'key',
      logger: false,
      defaultSettings: {
        mode: 'plan',
        local: { cwd: '/default', autoReview: true },
        modelParams: [{ id: 'fast', value: 'false' }],
      },
    });
    await provider('auto', { local: { cwd: '/model' } }).doGenerate(prompt);
    expect(mockAgentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'plan',
        local: { cwd: '/model' },
        model: { id: 'auto', params: [{ id: 'fast', value: 'false' }] },
      })
    );
    await provider.close();
  });

  it('closes provider-owned agents once through close/dispose aliases', async () => {
    const agent = new FakeSDKAgent(loadDeltaFixture('text-only'));
    mockAgentCreate.mockResolvedValue(agent);
    const provider = createCursor({ apiKey: 'key', logger: false });
    await provider('auto').doGenerate(prompt);
    expect(provider.dispose).toBe(provider.close);
    await provider.close();
    await provider.dispose();
    expect(agent.closeCalls).toHaveLength(1);
  });

  it('never closes caller-injected agents', async () => {
    const agent = new FakeSDKAgent(loadDeltaFixture('text-only'));
    const provider = createCursor({ apiKey: 'key', logger: false });
    await provider('auto', { agent }).doGenerate(prompt);
    await provider.close();
    expect(agent.closeCalls).toHaveLength(0);
  });

  it('strictly validates default and model settings', () => {
    expect(() =>
      createCursor({ defaultSettings: { agentId: '', createNewAgentPerCall: true } })
    ).toThrow(/^Invalid Cursor provider default settings:/);
    const provider = createCursor({ logger: false });
    expect(() => provider('auto', { unknown: true } as never)).toThrow(/^Invalid Cursor settings:/);
  });
});
