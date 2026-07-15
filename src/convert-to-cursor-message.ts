import {
  UnsupportedFunctionalityError,
  type LanguageModelV4FilePart,
  type LanguageModelV4Message,
  type LanguageModelV4Prompt,
  type LanguageModelV4ToolResultOutput,
  type SharedV4Warning,
} from '@ai-sdk/provider';
import { convertToBase64 } from '@ai-sdk/provider-utils';
import type { SDKImage, SDKUserMessage } from '@cursor/sdk';
import type { CursorPromptHistoryMode, CursorSystemMessageMode } from './types.js';

export interface CursorPromptPolicy {
  promptHistoryMode: CursorPromptHistoryMode;
  systemMessageMode: CursorSystemMessageMode;
  isSessionContinuation: boolean;
}

export interface ConvertedCursorMessage {
  message: SDKUserMessage;
  warnings: SharedV4Warning[];
}

type UserMessage = Extract<LanguageModelV4Message, { role: 'user' }>;

const HISTORY_ERROR =
  "Cursor agents manage conversation state server-side and cannot ingest an arbitrary message history. Resume the same model instance or pass providerOptions.cursor.agentId to continue a session, or opt into promptHistoryMode: 'ignore' | 'flatten' (both lossy).";

function unsupported(feature: string, details: string): SharedV4Warning {
  return { type: 'unsupported', feature, details };
}

function compatibility(feature: string, details: string): SharedV4Warning {
  return { type: 'compatibility', feature, details };
}

function emptyPromptError(): UnsupportedFunctionalityError {
  return new UnsupportedFunctionalityError({
    functionality: 'prompt.empty',
    message: 'Prompt must contain at least one user message with text or image content.',
  });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function serializeToolCallInput(input: unknown): string {
  const serialized = safeStringify(input);
  return serialized.length > 1000 ? `${serialized.slice(0, 1000)}...[truncated]` : serialized;
}

function serializeToolResult(output: LanguageModelV4ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;
    case 'json':
    case 'error-json':
      return safeStringify(output.value);
    case 'execution-denied':
      return '[execution denied]';
    case 'content':
      return output.value
        .map((part) => {
          switch (part.type) {
            case 'text':
              return part.text;
            case 'custom':
              return '[custom omitted]';
            case 'file':
              return '[file omitted]';
          }
        })
        .join('\n');
  }
}

function isImage(mediaType: string): boolean {
  const normalized = mediaType.trim().toLowerCase();
  return normalized === 'image' || normalized === 'image/*' || normalized.startsWith('image/');
}

function unwrapDataUrl(data: string): string {
  const match = data.match(/^data:[^,]*;base64,(.*)$/is);
  return match?.[1] ?? data;
}

function mapImagePart(
  part: LanguageModelV4FilePart,
  warnings: SharedV4Warning[]
): SDKImage | undefined {
  if (!isImage(part.mediaType)) {
    warnings.push(
      unsupported(
        'prompt.user.file',
        `Unsupported file part (${part.mediaType}) was ignored; Cursor accepts only image attachments.`
      )
    );
    return undefined;
  }

  switch (part.data.type) {
    case 'data':
      return {
        data: convertToBase64(
          typeof part.data.data === 'string' ? unwrapDataUrl(part.data.data) : part.data.data
        ),
        mimeType: part.mediaType,
      };
    case 'url':
      return { url: part.data.url.toString() };
    case 'reference':
      warnings.push(
        unsupported(
          'prompt.user.file.reference',
          'Provider file references are not supported; supply inline data or a URL.'
        )
      );
      return undefined;
    case 'text':
      warnings.push(
        unsupported(
          'prompt.user.file.text',
          'Text-backed image files are not supported; supply inline data or a URL.'
        )
      );
      return undefined;
  }
}

function convertUserMessage(message: UserMessage): ConvertedCursorMessage {
  const text: string[] = [];
  const images: SDKImage[] = [];
  const warnings: SharedV4Warning[] = [];
  for (const part of message.content) {
    switch (part.type) {
      case 'text':
        if (part.text.length > 0) text.push(part.text);
        break;
      case 'file': {
        const image = mapImagePart(part, warnings);
        if (image) images.push(image);
        break;
      }
      default: {
        const partType = String((part as { type?: unknown }).type ?? 'unknown');
        warnings.push({
          type: 'other',
          message: `Unsupported user part '${partType}' was skipped.`,
        });
      }
    }
  }
  return {
    message: {
      text: text.join('\n\n'),
      ...(images.length > 0 ? { images } : {}),
    },
    warnings,
  };
}

function flattenPrompt(
  prompt: LanguageModelV4Prompt,
  finalUserIndex: number
): { converted: ConvertedCursorMessage; hasUserContent: boolean } {
  const blocks: string[] = [];
  const images: SDKImage[] = [];
  const warnings: SharedV4Warning[] = [];
  let hasUserContent = false;

  for (const [messageIndex, message] of prompt.entries()) {
    if (message.role === 'system') continue;
    if (message.role === 'user') {
      const text: string[] = [];
      let omittedImage = false;
      for (const part of message.content) {
        if (part.type === 'text') {
          if (part.text.trim().length > 0) {
            text.push(part.text);
            hasUserContent = true;
          }
          continue;
        }
        if ((part as { type?: unknown }).type !== 'file') {
          const partType = String((part as { type?: unknown }).type ?? 'unknown');
          warnings.push({
            type: 'other',
            message: `Unsupported user part '${partType}' was skipped.`,
          });
          continue;
        }
        if (messageIndex === finalUserIndex) {
          const image = mapImagePart(part, warnings);
          if (image) {
            images.push(image);
            hasUserContent = true;
          }
        } else if (isImage(part.mediaType)) {
          omittedImage = true;
          hasUserContent = true;
          warnings.push(
            compatibility(
              'prompt.history.image',
              'An image from an earlier user turn was omitted while flattening prompt history.'
            )
          );
        } else {
          mapImagePart(part, warnings);
        }
      }
      const value = [...text, ...(omittedImage ? ['[image omitted]'] : [])].join('\n\n');
      if (value.length > 0) blocks.push(`Human: ${value}`);
      continue;
    }
    if (message.role === 'assistant') {
      const parts: string[] = [];
      for (const part of message.content) {
        switch (part.type) {
          case 'text':
            if (part.text.length > 0) parts.push(part.text);
            break;
          case 'tool-call':
            parts.push(`[Tool call: ${part.toolName}(${serializeToolCallInput(part.input)})]`);
            break;
          case 'tool-result':
            parts.push(`Tool Result (${part.toolName}): ${serializeToolResult(part.output)}`);
            break;
          case 'reasoning':
            warnings.push(
              unsupported(
                'prompt.assistant.reasoning',
                'Assistant reasoning cannot be represented in a Cursor user message and was omitted.'
              )
            );
            break;
          case 'reasoning-file':
            warnings.push(
              unsupported(
                'prompt.assistant.reasoning-file',
                'Assistant reasoning files cannot be represented in a Cursor user message and were omitted.'
              )
            );
            break;
          case 'custom':
            warnings.push(
              unsupported(
                'prompt.assistant.custom',
                'Assistant custom content cannot be represented in a Cursor user message and was omitted.'
              )
            );
            break;
          case 'file':
            warnings.push(
              unsupported(
                'prompt.assistant.file',
                'Assistant file content cannot be represented in flattened Cursor history and was omitted.'
              )
            );
            break;
        }
      }
      if (parts.length > 0) blocks.push(`Assistant: ${parts.join('\n')}`);
      continue;
    }
    for (const part of message.content) {
      if (part.type === 'tool-result') {
        blocks.push(`Tool Result (${part.toolName}): ${serializeToolResult(part.output)}`);
      }
    }
  }

  return {
    converted: {
      message: {
        text: blocks.join('\n\n'),
        ...(images.length > 0 ? { images } : {}),
      },
      warnings,
    },
    hasUserContent,
  };
}

function applySystemPolicy(
  message: SDKUserMessage,
  systemText: string,
  mode: CursorSystemMessageMode,
  warnings: SharedV4Warning[]
): void {
  if (!systemText) return;
  if (mode === 'reject') {
    throw new UnsupportedFunctionalityError({
      functionality: 'prompt.system',
      message:
        "Cursor root agents do not support system messages. Use systemMessageMode: 'ignore' or 'prefix' to opt into a lossy fallback.",
    });
  }
  if (mode === 'ignore') {
    warnings.push(
      unsupported(
        'prompt.system',
        'System messages are not supported by Cursor root agents and were ignored.'
      )
    );
    return;
  }
  warnings.push(
    compatibility(
      'prompt.system',
      'System messages were prefixed to the Cursor user message and do not retain system-role semantics.'
    )
  );
  message.text = `<system>\n${systemText}\n</system>\n\n${message.text}`;
}

export function convertToCursorMessage(
  prompt: LanguageModelV4Prompt,
  policy: CursorPromptPolicy
): ConvertedCursorMessage {
  const userMessages = prompt
    .map((message, index) => ({ message, index }))
    .filter(
      (entry): entry is { message: UserMessage; index: number } => entry.message.role === 'user'
    );
  const hasAssistantOrTool = prompt.some(
    (message) => message.role === 'assistant' || message.role === 'tool'
  );
  const hasHistory = hasAssistantOrTool || userMessages.length > 1;
  const systemText = prompt
    .filter((message) => message.role === 'system' && message.content.trim().length > 0)
    .map((message) => message.content)
    .join('\n\n');

  if (userMessages.length === 0) throw emptyPromptError();
  if (hasHistory && policy.promptHistoryMode === 'reject') {
    throw new UnsupportedFunctionalityError({
      functionality: 'prompt.history',
      message: policy.isSessionContinuation
        ? `${HISTORY_ERROR} This call already targets an existing Cursor session, so send only the latest user turn instead of replaying prior messages.`
        : HISTORY_ERROR,
    });
  }

  let converted: ConvertedCursorMessage;
  let hasUserContent: boolean;
  if (hasHistory && policy.promptHistoryMode === 'flatten') {
    const latest = userMessages.at(-1);
    if (!latest) throw emptyPromptError();
    const flattened = flattenPrompt(prompt, latest.index);
    converted = flattened.converted;
    hasUserContent = flattened.hasUserContent;
    converted.warnings.push(
      compatibility(
        'prompt.history',
        'History was flattened into a single Cursor user message; roles, tool calls and results were serialized as text.'
      )
    );
  } else {
    const latest = userMessages.at(-1);
    if (!latest) throw emptyPromptError();
    converted = convertUserMessage(latest.message);
    hasUserContent =
      converted.message.text.trim().length > 0 || Boolean(converted.message.images?.length);
    if (hasHistory && policy.promptHistoryMode === 'ignore') {
      converted.warnings.push({
        type: 'other',
        message:
          'promptHistoryMode "ignore": earlier prompt messages were not sent; the Cursor agent supplies conversation state.',
      });
    }
  }

  if (!hasUserContent) throw emptyPromptError();
  applySystemPolicy(converted.message, systemText, policy.systemMessageMode, converted.warnings);
  return converted;
}
