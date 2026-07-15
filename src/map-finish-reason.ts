import type { LanguageModelV4FinishReason } from '@ai-sdk/provider';
import type { RunResult } from '@cursor/sdk';

export function mapCursorFinishReason(result: RunResult): LanguageModelV4FinishReason {
  switch (result.status) {
    case 'finished':
      return { unified: 'stop', raw: 'finished' };
    case 'error':
      return { unified: 'error', raw: result.error?.code ?? 'error' };
    case 'cancelled':
      return { unified: 'other', raw: 'cancelled' };
  }
}
