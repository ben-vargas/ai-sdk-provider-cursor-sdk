import { getLogger, noopLogger } from './logger.js';

describe('getLogger', () => {
  it('returns a no-op logger when disabled', () => {
    expect(getLogger(false)).toBe(noopLogger);
    expect(() => {
      noopLogger.debug('debug');
      noopLogger.info('info');
      noopLogger.warn('warn');
      noopLogger.error('error');
    }).not.toThrow();
  });

  it('suppresses debug/info but preserves warning/error on a quiet custom logger', () => {
    const custom = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const logger = getLogger(custom, false);
    logger.debug('debug');
    logger.info('info');
    logger.warn('warn', 1);
    logger.error('error', 2);
    expect(custom.debug).not.toHaveBeenCalled();
    expect(custom.info).not.toHaveBeenCalled();
    expect(custom.warn).toHaveBeenCalledWith('warn', 1);
    expect(custom.error).toHaveBeenCalledWith('error', 2);
  });

  it('returns a verbose custom logger unchanged', () => {
    const custom = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    expect(getLogger(custom, true)).toBe(custom);
  });

  it('uses the console with verbosity-aware debug/info methods', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const quiet = getLogger(undefined, false);
    quiet.debug('quiet debug');
    quiet.info('quiet info');
    quiet.warn('quiet warn');
    quiet.error('quiet error');
    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('quiet warn');
    expect(error).toHaveBeenCalledWith('quiet error');

    const verbose = getLogger(undefined, true);
    verbose.debug('verbose debug');
    verbose.info('verbose info');
    expect(debug).toHaveBeenCalledWith('verbose debug');
    expect(info).toHaveBeenCalledWith('verbose info');
  });
});
