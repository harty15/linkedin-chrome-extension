import { LOG_PREFIX, type LogLevel } from '@/config/constants';

/**
 * Logger utility for consistent logging across the extension
 */
class Logger {
  private context: string;
  private enabled: boolean;

  constructor(context: string) {
    this.context = context;
    this.enabled = import.meta.env.DEV || import.meta.env.VITE_DEBUG === 'true';
  }

  private formatMessage(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!this.enabled && level === 'debug') return;

    const timestamp = new Date().toISOString();
    const prefix = `${LOG_PREFIX} [${this.context}] [${level.toUpperCase()}]`;

    switch (level) {
      case 'debug':
        console.debug(`${prefix} ${message}`, ...args);
        break;
      case 'info':
        console.info(`${prefix} ${message}`, ...args);
        break;
      case 'warn':
        console.warn(`${prefix} ${message}`, ...args);
        break;
      case 'error':
        console.error(`${prefix} ${message}`, ...args);
        break;
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.formatMessage('debug', message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.formatMessage('info', message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.formatMessage('warn', message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.formatMessage('error', message, ...args);
    
    // In production, send to error tracking service (e.g., Sentry)
    if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
      this.reportError(message, args);
    }
  }

  private reportError(message: string, args: unknown[]): void {
    // TODO: Implement Sentry or other error tracking
    // Sentry.captureMessage(message, { extra: { args, context: this.context } });
  }

  /**
   * Log with timing measurement
   */
  time(label: string): () => void {
    const start = performance.now();
    this.debug(`${label} started`);

    return () => {
      const duration = Math.round(performance.now() - start);
      this.debug(`${label} completed in ${duration}ms`);
    };
  }

  /**
   * Create a child logger with additional context
   */
  child(subContext: string): Logger {
    return new Logger(`${this.context}:${subContext}`);
  }
}

// Export factory function
export function createLogger(context: string): Logger {
  return new Logger(context);
}

// Export default loggers for common contexts
export const backgroundLogger = createLogger('background');
export const contentLogger = createLogger('content');
export const popupLogger = createLogger('popup');

