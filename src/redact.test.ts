import { redactSensitiveData } from './redact.js';

describe('redactSensitiveData', () => {
  it.each([
    'authorization',
    'proxyAuthorization',
    'apiKey',
    'cursorApiKey',
    'accessToken',
    'refreshToken',
    'idToken',
    'authToken',
    'bearerToken',
    'password',
    'passwd',
    'secret',
    'clientSecret',
    'credential',
    'credentials',
    'privateKey',
    'cookie',
    'setCookie',
    'token',
  ])('redacts the sensitive key alternative %s', (key) => {
    expect(redactSensitiveData({ [key]: 'secret' })).toEqual({ [key]: '[REDACTED]' });
  });

  it('handles top-level primitive values without fabricating objects', () => {
    expect(redactSensitiveData(null)).toBeNull();
    expect(redactSensitiveData(true)).toBe(true);
    expect(redactSensitiveData(42)).toBe(42);
    expect(redactSensitiveData(1n)).toBe('1');
    expect(redactSensitiveData('Bearer secret')).toBe('Bearer [REDACTED]');
    expect(redactSensitiveData(undefined)).toBeUndefined();
  });

  it('redacts direct credential keys across naming conventions', () => {
    expect(
      redactSensitiveData({
        apiKey: 'one',
        cursor_api_key: 'two',
        'access-token': 'three',
        password: 'four',
        clientSecret: 'five',
        safe: 'visible',
      })
    ).toEqual({
      apiKey: '[REDACTED]',
      cursor_api_key: '[REDACTED]',
      'access-token': '[REDACTED]',
      password: '[REDACTED]',
      clientSecret: '[REDACTED]',
      safe: 'visible',
    });
  });

  it('redacts every value in headers and environment collections', () => {
    expect(
      redactSensitiveData({
        headers: { Authorization: 'Bearer token', 'X-Safe': 'also-hidden' },
        envVars: { TOKEN: 'secret', MODE: 'test' },
        env: [
          { name: 'SAFE_NAME', value: 'still-hidden' },
          { name: 'API_KEY', value: 'secret' },
        ],
      })
    ).toEqual({
      headers: { Authorization: '[REDACTED]', 'X-Safe': '[REDACTED]' },
      envVars: { TOKEN: '[REDACTED]', MODE: '[REDACTED]' },
      env: [
        { name: 'SAFE_NAME', value: '[REDACTED]' },
        { name: 'API_KEY', value: '[REDACTED]' },
      ],
    });
  });

  it('scrubs credentials embedded in strings and URLs', () => {
    const result = redactSensitiveData({
      command:
        'Authorization: Bearer abc API_KEY=xyz password="secret value" https://user:pass@example.test/path',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('abc');
    expect(serialized).not.toContain('xyz');
    expect(serialized).not.toContain('secret value');
    expect(serialized).not.toContain('user:pass');
    expect(serialized).toContain('[REDACTED]');
  });

  it('handles arrays, bigints, unsupported values, and cycles as JSON-safe data', () => {
    const cyclic: Record<string, unknown> = { value: 1n, ignored: undefined };
    cyclic.self = cyclic;
    cyclic.items = [1, undefined, () => undefined];
    expect(redactSensitiveData(cyclic)).toEqual({
      value: '1',
      self: '[Circular]',
      items: [1, null, null],
    });
  });

  it('does not mutate the input', () => {
    const input = { nested: { apiKey: 'secret' } };
    expect(redactSensitiveData(input)).toEqual({ nested: { apiKey: '[REDACTED]' } });
    expect(input).toEqual({ nested: { apiKey: 'secret' } });
  });
});
