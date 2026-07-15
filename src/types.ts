import type { TokenUsage } from '@cursor/sdk';

export type CursorModelId = 'auto' | 'composer-2.5' | (string & {});

export type CursorPromptHistoryMode = 'reject' | 'ignore' | 'flatten';

export type CursorSystemMessageMode = 'reject' | 'ignore' | 'prefix';

export interface CursorProviderMetadata {
  agentId: string;
  runId: string;
  requestId?: string;
  model?: string;
  modelParams?: Array<{ id: string; value: string }>;
  status: 'finished' | 'error' | 'cancelled';
  durationMs?: number;
  result?: string;
  usage?: TokenUsage;
  git?: {
    branches: Array<{ repoUrl: string; branch?: string; prUrl?: string }>;
  };
}

export type { Logger } from './logger.js';
export type { CursorProviderOptions, CursorSettings } from './settings.js';
