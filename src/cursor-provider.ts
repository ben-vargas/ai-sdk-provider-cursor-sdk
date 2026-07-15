import { NoSuchModelError, type LanguageModelV4, type ProviderV4 } from '@ai-sdk/provider';
import { CursorAgentManager } from './cursor-agent-manager.js';
import { CursorLanguageModel } from './cursor-language-model.js';
import { getLogger, type Logger } from './logger.js';
import { mergeCursorSettings, type CursorSettings } from './settings.js';
import type { CursorModelId } from './types.js';
import { validateCursorSettings } from './validation.js';

export interface CursorProviderSettings {
  apiKey?: string;
  defaultSettings?: CursorSettings;
  logger?: Logger | false;
}

export interface CursorProvider extends ProviderV4 {
  (modelId: CursorModelId, settings?: CursorSettings): LanguageModelV4;
  readonly specificationVersion: 'v4';
  languageModel(modelId: CursorModelId, settings?: CursorSettings): LanguageModelV4;
  chat(modelId: CursorModelId, settings?: CursorSettings): LanguageModelV4;
  embeddingModel(modelId: string): never;
  imageModel(modelId: string): never;
  close(): Promise<void>;
  dispose(): Promise<void>;
}

export function createCursor(options: CursorProviderSettings = {}): CursorProvider {
  const defaultSettings = validateCursorSettings(
    options.defaultSettings ?? {},
    'Cursor provider default settings'
  );
  const providerLogger = getLogger(options.logger, true);
  const agentManager = new CursorAgentManager(providerLogger);

  const createModel = (
    modelId: CursorModelId,
    modelSettings: CursorSettings = {}
  ): LanguageModelV4 => {
    const merged = mergeCursorSettings(defaultSettings, modelSettings);
    const settings = validateCursorSettings({
      ...merged,
      apiKey: merged.apiKey ?? options.apiKey,
    });
    return new CursorLanguageModel({
      id: modelId,
      settings,
      agentManager,
      logger: providerLogger,
    });
  };

  const provider = function cursorModel(
    modelId: CursorModelId,
    modelSettings?: CursorSettings
  ): LanguageModelV4 {
    if (new.target) {
      throw new Error('The Cursor model function cannot be called with the new keyword.');
    }
    return createModel(modelId, modelSettings);
  };

  const close = async (): Promise<void> => agentManager.close();
  provider.specificationVersion = 'v4' as const;
  provider.languageModel = createModel;
  provider.chat = createModel;
  provider.embeddingModel = (modelId: string): never => {
    throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' });
  };
  provider.imageModel = (modelId: string): never => {
    throw new NoSuchModelError({ modelId, modelType: 'imageModel' });
  };
  provider.close = close;
  provider.dispose = close;

  return provider as CursorProvider;
}

export const cursor: CursorProvider = createCursor();
