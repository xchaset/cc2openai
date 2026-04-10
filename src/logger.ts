import pino from 'pino';
import crypto from 'crypto';

const isDevelopment = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDevelopment
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l' } }
    : undefined
});

// 生成唯一请求 ID
export function generateRequestId(): string {
  return crypto.randomBytes(8).toString('hex');
}

// 截断大字符串，避免日志爆炸
export function truncate(obj: unknown, maxLen = 2000): unknown {
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
  if (!str || str.length <= maxLen) return obj;
  return str.slice(0, maxLen) + `... [truncated, total ${str.length} chars]`;
}

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