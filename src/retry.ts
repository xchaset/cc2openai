import { RetryConfig } from './types';

export class RetryableError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public attempt: number
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

function isRetryable(error: unknown, retryableStatusCodes: number[]): boolean {
  if (error instanceof RetryableError) {
    return retryableStatusCodes.includes(error.statusCode);
  }
  if (error instanceof Error) {
    const networkErrors = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'];
    for (const code of networkErrors) {
      if (error.message.includes(code)) {
        return true;
      }
    }
  }
  return false;
}

function calculateDelay(attempt: number, config: RetryConfig): number {
  const delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1);
  return Math.min(delay, config.maxDelay);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryable(error, config.retryableStatusCodes)) {
        throw error;
      }

      if (attempt >= config.maxRetries) {
        break;
      }

      const delay = calculateDelay(attempt, config);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error(`Max retries exceeded: ${lastError instanceof Error ? lastError.message : 'Unknown error'}`);
}

export function wrapRetryable<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  config: RetryConfig
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    return withRetry(() => fn(...args), config);
  };
}
