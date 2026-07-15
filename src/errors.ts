import {
  AgentBusyError,
  AgentNotFoundError,
  AuthenticationError,
  ConfigurationError,
  CursorSdkError,
  IntegrationNotConnectedError,
  NetworkError,
  RateLimitError,
  UnsupportedRunOperationError,
  type RunResult,
} from '@cursor/sdk';
import { AISDKError, APICallError, LoadAPIKeyError } from '@ai-sdk/provider';

export interface CursorErrorMetadata {
  code?: string;
  status?: number;
  requestId?: string;
  endpoint?: string;
  operation?: string;
  promptExcerpt?: string;
  provider?: string;
  helpUrl?: string;
}

export interface CursorErrorContext {
  operation: string;
  modelId: string;
  agentId?: string;
  requestId?: string;
  promptExcerpt?: string;
}

export class CursorStreamConsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CursorStreamConsistencyError';
  }
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'AbortError';
}

function metadataFor(
  error: CursorSdkError | undefined,
  context: CursorErrorContext
): CursorErrorMetadata {
  return {
    code: error?.code,
    status: error?.status,
    requestId: error?.requestId ?? context.requestId,
    endpoint: error?.endpoint,
    operation: error?.operation ?? context.operation,
    promptExcerpt: context.promptExcerpt,
  };
}

function requestBody(context: CursorErrorContext): Record<string, unknown> {
  return {
    modelId: context.modelId,
    ...(context.agentId ? { agentId: context.agentId } : {}),
    ...(context.promptExcerpt ? { promptExcerpt: context.promptExcerpt } : {}),
  };
}

export function mapCursorError(error: unknown, context: CursorErrorContext): Error {
  if (AISDKError.isInstance(error) || isAbortError(error)) return error;

  if (error instanceof CursorStreamConsistencyError) {
    return new APICallError({
      message: error.message,
      url: `cursor-sdk://${context.operation}`,
      requestBodyValues: requestBody(context),
      cause: error,
      isRetryable: true,
      data: metadataFor(undefined, context),
    });
  }

  const sdkError = error instanceof CursorSdkError ? error : undefined;
  let message = error instanceof Error ? error.message : `Cursor SDK call failed: ${String(error)}`;
  let retryable = sdkError?.isRetryable ?? false;
  const data = metadataFor(sdkError, context);

  if (error instanceof AuthenticationError) {
    message =
      'Cursor API key is invalid or missing. Set the apiKey option or the CURSOR_API_KEY environment variable (create a key at cursor.com/dashboard).';
    retryable = false;
  } else if (error instanceof RateLimitError || error instanceof NetworkError) {
    retryable = true;
  } else if (error instanceof AgentBusyError) {
    message =
      'Cursor agent is busy with another run. Wait for that run to finish or cancel it before retrying.';
    retryable = false;
    data.code ??= 'agent_busy';
  } else if (error instanceof AgentNotFoundError) {
    message = `Cursor agent '${context.agentId ?? 'unknown'}' was not found (deleted, expired, or from a different store/machine). Start a new session or clear providerOptions.cursor.agentId.`;
    retryable = false;
    data.code = 'agent_not_found';
  } else if (error instanceof IntegrationNotConnectedError) {
    message = `${error.message} (${error.provider}). Reconnect the integration at ${error.helpUrl}.`;
    data.provider = error.provider;
    data.helpUrl = error.helpUrl;
    retryable = false;
  } else if (error instanceof UnsupportedRunOperationError) {
    retryable = false;
  } else if (error instanceof ConfigurationError) {
    retryable = false;
  }

  return new APICallError({
    message,
    url: `cursor-sdk://${context.operation}`,
    requestBodyValues: requestBody(context),
    statusCode: sdkError?.status,
    cause: error,
    isRetryable: retryable,
    data,
  });
}

export function createRunError(result: RunResult, context: CursorErrorContext): APICallError {
  const code = result.error?.code;
  return new APICallError({
    message: result.error?.message ?? 'Cursor run failed.',
    url: 'cursor-sdk://run.wait',
    requestBodyValues: requestBody(context),
    cause: result.error,
    isRetryable: /rate.?limit|overloaded|network|timeout/i.test(code ?? ''),
    data: {
      code,
      requestId: result.requestId ?? context.requestId,
      operation: 'run.wait',
      promptExcerpt: context.promptExcerpt,
    } satisfies CursorErrorMetadata,
  });
}

function errorData(error: unknown): CursorErrorMetadata | undefined {
  if (!APICallError.isInstance(error) || !error.data || typeof error.data !== 'object') {
    return undefined;
  }
  return error.data as CursorErrorMetadata;
}

export function isAuthenticationError(error: unknown): boolean {
  if (LoadAPIKeyError.isInstance(error)) return true;
  const data = errorData(error);
  return (
    data?.status === 401 ||
    ['authentication_error', 'invalid_api_key', 'unauthorized'].includes(data?.code ?? '')
  );
}

export function isAgentBusyError(error: unknown): boolean {
  return errorData(error)?.code === 'agent_busy';
}

export function isStaleAgentError(error: unknown): boolean {
  return errorData(error)?.code === 'agent_not_found';
}
