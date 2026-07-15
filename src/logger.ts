export interface Logger {
  debug(message: string, ...details: unknown[]): void;
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

const noop = (): void => undefined;

export const noopLogger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

function consoleLogger(verbose: boolean): Logger {
  const target = globalThis.console;
  return {
    debug: verbose ? target.debug.bind(target) : noop,
    info: verbose ? target.info.bind(target) : noop,
    warn: target.warn.bind(target),
    error: target.error.bind(target),
  };
}

export function getLogger(logger?: Logger | false, verbose = false): Logger {
  if (logger === false) return noopLogger;
  if (logger) {
    if (verbose) return logger;
    return {
      debug: noop,
      info: noop,
      warn: logger.warn.bind(logger),
      error: logger.error.bind(logger),
    };
  }
  return consoleLogger(verbose);
}
