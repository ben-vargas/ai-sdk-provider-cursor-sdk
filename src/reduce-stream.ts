import {
  APICallError,
  type LanguageModelV4Content,
  type LanguageModelV4GenerateResult,
  type LanguageModelV4ResponseMetadata,
  type LanguageModelV4StreamPart,
  type SharedV4ProviderMetadata,
  type SharedV4Warning,
} from '@ai-sdk/provider';

export async function reduceCursorStream(
  stream: ReadableStream<LanguageModelV4StreamPart>
): Promise<LanguageModelV4GenerateResult> {
  const content: LanguageModelV4Content[] = [];
  const contentIndexes = new Map<string, number>();
  const toolResultIndexes = new Map<string, number>();
  let warnings: SharedV4Warning[] = [];
  let finishReason: LanguageModelV4GenerateResult['finishReason'] | undefined;
  let usage: LanguageModelV4GenerateResult['usage'] | undefined;
  let providerMetadata: SharedV4ProviderMetadata | undefined;
  let response: LanguageModelV4ResponseMetadata | undefined;

  for await (const part of stream) {
    switch (part.type) {
      case 'stream-start':
        warnings = part.warnings;
        break;
      case 'response-metadata':
        response = { id: part.id, timestamp: part.timestamp, modelId: part.modelId };
        break;
      case 'text-start':
        contentIndexes.set(part.id, content.length);
        content.push({ type: 'text', text: '', providerMetadata: part.providerMetadata });
        break;
      case 'text-delta': {
        const index = contentIndexes.get(part.id);
        const existing = index === undefined ? undefined : content[index];
        if (index !== undefined && existing?.type === 'text') {
          content[index] = { ...existing, text: existing.text + part.delta };
        }
        break;
      }
      case 'text-end':
      case 'reasoning-end': {
        if (!part.providerMetadata) break;
        const index = contentIndexes.get(part.id);
        const existing = index === undefined ? undefined : content[index];
        if (index !== undefined && (existing?.type === 'text' || existing?.type === 'reasoning')) {
          content[index] = {
            ...existing,
            providerMetadata: { ...existing.providerMetadata, ...part.providerMetadata },
          };
        }
        break;
      }
      case 'reasoning-start':
        contentIndexes.set(part.id, content.length);
        content.push({ type: 'reasoning', text: '', providerMetadata: part.providerMetadata });
        break;
      case 'reasoning-delta': {
        const index = contentIndexes.get(part.id);
        const existing = index === undefined ? undefined : content[index];
        if (index !== undefined && existing?.type === 'reasoning') {
          content[index] = { ...existing, text: existing.text + part.delta };
        }
        break;
      }
      case 'tool-call':
      case 'tool-approval-request':
      case 'file':
      case 'source':
      case 'custom':
        content.push(part);
        break;
      case 'tool-result': {
        const previousIndex = toolResultIndexes.get(part.toolCallId);
        const previous = previousIndex === undefined ? undefined : content[previousIndex];
        if (previousIndex === undefined) {
          toolResultIndexes.set(part.toolCallId, content.length);
          content.push(part);
        } else if (previous?.type === 'tool-result' && previous.preliminary === true) {
          content[previousIndex] = part;
        }
        break;
      }
      case 'finish':
        finishReason = part.finishReason;
        usage = part.usage;
        providerMetadata = part.providerMetadata;
        break;
      case 'error':
        throw part.error;
      default:
        break;
    }
  }

  if (!finishReason || !usage) {
    throw new APICallError({
      message: 'Cursor run ended without a terminal result.',
      url: 'cursor-sdk://agent.send',
      requestBodyValues: undefined,
      isRetryable: true,
    });
  }

  return {
    content,
    finishReason,
    usage,
    warnings,
    providerMetadata,
    response,
  };
}
