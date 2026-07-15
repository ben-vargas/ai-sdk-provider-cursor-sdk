export { createCursor, cursor } from './cursor-provider.js';
export type { CursorProvider, CursorProviderSettings } from './cursor-provider.js';
export { CursorLanguageModel } from './cursor-language-model.js';

export type {
  CursorModelId,
  CursorPromptHistoryMode,
  CursorProviderMetadata,
  CursorProviderOptions,
  CursorSettings,
  CursorSystemMessageMode,
  Logger,
} from './types.js';

export { isAgentBusyError, isAuthenticationError, isStaleAgentError } from './errors.js';
export type { CursorErrorMetadata } from './errors.js';

export type { NormalizedEvent } from './normalized-events.js';
