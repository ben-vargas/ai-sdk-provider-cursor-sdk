import { AISDKError, APICallError, LoadAPIKeyError } from '@ai-sdk/provider';
import {
  AgentBusyError,
  AgentNotFoundError,
  AuthenticationError,
  ConfigurationError,
  CursorSdkError,
  IntegrationNotConnectedError,
  NetworkError,
  RateLimitError,
  UnknownAgentError,
  UnsupportedRunOperationError,
} from '@cursor/sdk';
import {
  CursorStreamConsistencyError,
  createRunError,
  isAgentBusyError,
  isAuthenticationError,
  isStaleAgentError,
  mapCursorError,
  type CursorErrorContext,
} from './errors.js';

function context(overrides: Partial<CursorErrorContext> = {}): CursorErrorContext {
  return {
    operation: 'agent.send',
    modelId: 'composer-2.5',
    agentId: 'agent-1',
    requestId: 'request-context',
    promptExcerpt: 'hello world',
    ...overrides,
  };
}

describe('mapCursorError', () => {
  it('passes AI SDK and AbortError instances through unchanged', () => {
    const aiError = new LoadAPIKeyError({ message: 'missing' });
    const abort = new DOMException('stop', 'AbortError');
    expect(mapCursorError(aiError, context())).toBe(aiError);
    expect(mapCursorError(abort, context())).toBe(abort);
  });

  it('maps stream consistency errors to retryable APICallError', () => {
    const source = new CursorStreamConsistencyError('protocol drift');
    const mapped = mapCursorError(source, context());
    expect(APICallError.isInstance(mapped)).toBe(true);
    expect(mapped).toMatchObject({
      message: 'protocol drift',
      url: 'cursor-sdk://agent.send',
      requestBodyValues: {
        modelId: 'composer-2.5',
        agentId: 'agent-1',
        promptExcerpt: 'hello world',
      },
      isRetryable: true,
      cause: source,
      data: {
        requestId: 'request-context',
        operation: 'agent.send',
        promptExcerpt: 'hello world',
      },
    });
  });

  it('maps runtime authentication with preserved metadata and helper recognition', () => {
    const source = new AuthenticationError('invalid', {
      code: 'invalid_api_key',
      status: 401,
      requestId: 'request-sdk',
      endpoint: '/auth',
      operation: 'api-key.exchange',
    });
    const mapped = mapCursorError(source, context());
    expect(mapped).toMatchObject({
      message:
        'Cursor API key is invalid or missing. Set the apiKey option or the CURSOR_API_KEY environment variable (create a key at cursor.com/dashboard).',
      statusCode: 401,
      isRetryable: false,
      data: {
        code: 'invalid_api_key',
        status: 401,
        requestId: 'request-sdk',
        endpoint: '/auth',
        operation: 'api-key.exchange',
      },
    });
    expect(isAuthenticationError(mapped)).toBe(true);
    expect(isAuthenticationError(new LoadAPIKeyError({ message: 'missing' }))).toBe(true);
  });

  it.each([
    [
      new RateLimitError('limited', { code: 'rate_limit', status: 429 }),
      'limited',
      429,
      'rate_limit',
    ],
    [
      new NetworkError('unavailable', { code: 'network', status: 503 }),
      'unavailable',
      503,
      'network',
    ],
  ] as const)('maps %s as retryable with metadata', (source, message, status, code) => {
    expect(mapCursorError(source, context())).toMatchObject({
      message,
      statusCode: status,
      isRetryable: true,
      data: { code, status },
    });
  });

  it('maps agent busy as non-retryable and exposes a predicate', () => {
    const mapped = mapCursorError(new AgentBusyError('busy', { status: 409 }), context());
    expect(mapped).toMatchObject({
      isRetryable: false,
      data: { code: 'agent_busy', status: 409 },
    });
    expect(isAgentBusyError(mapped)).toBe(true);
  });

  it('maps stale agent IDs with recovery guidance and exposes a predicate', () => {
    const mapped = mapCursorError(
      new AgentNotFoundError('missing', { status: 404 }),
      context({ agentId: 'agent-stale' })
    );
    expect(mapped).toMatchObject({
      message: expect.stringContaining("Cursor agent 'agent-stale' was not found"),
      isRetryable: false,
      data: { code: 'agent_not_found' },
    });
    expect(isStaleAgentError(mapped)).toBe(true);
  });

  it('adds integration provider and help URL to message and data', () => {
    const mapped = mapCursorError(
      new IntegrationNotConnectedError('integration missing', {
        provider: 'github',
        helpUrl: 'https://cursor.test/connect',
        code: 'integration_not_connected',
      }),
      context()
    );
    expect(mapped).toMatchObject({
      message:
        'integration missing (github). Reconnect the integration at https://cursor.test/connect.',
      isRetryable: false,
      data: {
        code: 'integration_not_connected',
        provider: 'github',
        helpUrl: 'https://cursor.test/connect',
      },
    });
  });

  it.each([
    new UnsupportedRunOperationError('wait', 'not available'),
    new ConfigurationError('bad config', { status: 400 }),
  ])('maps %s as non-retryable', (source) => {
    expect(mapCursorError(source, context())).toMatchObject({ isRetryable: false });
  });

  it('trusts retryability for other Cursor SDK errors', () => {
    expect(
      mapCursorError(new UnknownAgentError('unknown', { isRetryable: true }), context())
    ).toMatchObject({ isRetryable: true });
    expect(
      mapCursorError(new CursorSdkError('generic', { isRetryable: false }), context())
    ).toMatchObject({ isRetryable: false });
  });

  it('maps unknown errors non-retryably and preserves the cause', () => {
    const source = new Error('unexpected');
    const mapped = mapCursorError(source, context({ agentId: undefined }));
    expect(mapped).toMatchObject({
      message: 'unexpected',
      isRetryable: false,
      cause: source,
      requestBodyValues: { modelId: 'composer-2.5', promptExcerpt: 'hello world' },
    });
  });

  it('maps non-Error thrown values', () => {
    expect(mapCursorError('broken', context())).toMatchObject({
      message: 'Cursor SDK call failed: broken',
      isRetryable: false,
    });
  });
});

describe('createRunError', () => {
  it.each([
    ['rate_limit', true],
    ['overloaded', true],
    ['network_timeout', true],
    ['policy_denied', false],
    [undefined, false],
  ] as const)('maps run error code %s retryability to %s', (code, isRetryable) => {
    const mapped = createRunError(
      {
        id: 'run-1',
        requestId: 'request-result',
        status: 'error',
        error: { message: 'run failed', ...(code ? { code } : {}) },
      },
      context()
    );
    expect(mapped).toMatchObject({
      message: 'run failed',
      url: 'cursor-sdk://run.wait',
      isRetryable,
      data: {
        code,
        requestId: 'request-result',
        operation: 'run.wait',
        promptExcerpt: 'hello world',
      },
    });
  });
});

describe('error predicates', () => {
  it.each([
    [{ status: 401 }, true],
    [{ code: 'authentication_error' }, true],
    [{ code: 'unauthorized' }, true],
  ] as const)('recognizes isolated authentication metadata %j', (data, expected) => {
    const error = new APICallError({
      message: 'auth',
      url: 'cursor-sdk://agent.send',
      requestBodyValues: {},
      isRetryable: false,
      data,
    });
    expect(isAuthenticationError(error)).toBe(expected);
  });

  it('returns false for unrelated values and status/code combinations', () => {
    expect(isAuthenticationError(new Error('no'))).toBe(false);
    expect(isAgentBusyError(new Error('no'))).toBe(false);
    expect(isStaleAgentError(new Error('no'))).toBe(false);
    const unrelated = new AISDKError({ name: 'unrelated', message: 'unrelated' });
    expect(isAuthenticationError(unrelated)).toBe(false);
  });
});
