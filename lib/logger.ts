export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

export type Logger = {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
};

/**
 * Minimal structured logger. Every line is prefixed with the logger's scope so
 * logs carry consistent context, and an optional structured payload is passed
 * through to the underlying `console` method.
 */
export function createLogger(scope: string): Logger {
  function write(level: LogLevel, message: string, context?: LogContext) {
    const line = `[${scope}] ${message}`;

    if (context && Object.keys(context).length > 0) {
      console[level](line, context);
    } else {
      console[level](line);
    }
  }

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}
