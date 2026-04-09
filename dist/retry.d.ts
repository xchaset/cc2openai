import { RetryConfig } from './types';
export declare class RetryableError extends Error {
    statusCode: number;
    attempt: number;
    constructor(message: string, statusCode: number, attempt: number);
}
export declare function withRetry<T>(fn: () => Promise<T>, config: RetryConfig): Promise<T>;
export declare function wrapRetryable<T extends unknown[], R>(fn: (...args: T) => Promise<R>, config: RetryConfig): (...args: T) => Promise<R>;
