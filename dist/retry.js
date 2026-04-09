"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RetryableError = void 0;
exports.withRetry = withRetry;
exports.wrapRetryable = wrapRetryable;
class RetryableError extends Error {
    constructor(message, statusCode, attempt) {
        super(message);
        this.statusCode = statusCode;
        this.attempt = attempt;
        this.name = 'RetryableError';
    }
}
exports.RetryableError = RetryableError;
function isRetryable(error, retryableStatusCodes) {
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
function calculateDelay(attempt, config) {
    const delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1);
    return Math.min(delay, config.maxDelay);
}
async function withRetry(fn, config) {
    let lastError;
    let attempt = 0;
    while (attempt < config.maxRetries) {
        attempt++;
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            if (!isRetryable(error, config.retryableStatusCodes)) {
                throw error;
            }
            if (attempt >= config.maxRetries) {
                throw new Error(`Max retries exceeded: ${lastError instanceof Error ? lastError.message : 'Unknown error'}`);
            }
            const delay = calculateDelay(attempt, config);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}
function wrapRetryable(fn, config) {
    return async (...args) => {
        return withRetry(() => fn(...args), config);
    };
}
