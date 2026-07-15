import { NoSuchModelError } from '@ai-sdk/provider';
import { z } from 'zod';
import {
  cursorProviderOptionsSchema,
  cursorSettingsSchema,
  type CursorProviderOptions,
  type CursorSettings,
} from './settings.js';
import type { CursorModelId } from './types.js';

function validationError(label: string, error: z.ZodError): Error {
  const details = error.issues
    .map((issue) => `${issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}${issue.message}`)
    .join(', ');
  return new Error(`Invalid ${label}: ${details}`);
}

export function validateCursorModelId(modelId: CursorModelId): CursorModelId {
  if (typeof modelId !== 'string' || modelId.trim().length === 0) {
    throw new NoSuchModelError({ modelId, modelType: 'languageModel' });
  }
  return modelId;
}

export function validateCursorSettings(
  settings: CursorSettings,
  label = 'Cursor settings'
): CursorSettings {
  const parsed = cursorSettingsSchema.safeParse(settings);
  if (!parsed.success) throw validationError(label, parsed.error);
  return parsed.data;
}

export function parseCursorProviderOptions(value: unknown): CursorProviderOptions {
  const parsed = cursorProviderOptionsSchema.safeParse(value ?? {});
  if (!parsed.success) throw validationError('providerOptions.cursor', parsed.error);
  return parsed.data;
}
