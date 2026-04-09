import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDevelopment
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined
});

// Request logging helper
export function logRequest(req: { method: string; url: string }, res: { statusCode: number }, duration: number) {
  logger.info({
    req: { method: req.method, url: req.url },
    res: { statusCode: res.statusCode, duration }
  }, 'request completed');
}

// Error logging helper
export function logError(error: Error, context?: Record<string, unknown>) {
  logger.error({ error: error.message, stack: error.stack, ...context }, 'error occurred');
}