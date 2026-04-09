import { withRetry, RetryableError } from '../../src/retry';

describe('withRetry', () => {
  it('should succeed on first try', async () => {
    const fn = jest.fn().mockResolvedValue('success');
    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10, maxDelay: 100, backoffMultiplier: 2, retryableStatusCodes: [502, 503, 504] });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable error', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new RetryableError('error', 502, 1))
      .mockRejectedValueOnce(new RetryableError('error', 503, 2))
      .mockResolvedValueOnce('success');

    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10, maxDelay: 100, backoffMultiplier: 2, retryableStatusCodes: [502, 503, 504] });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw after max retries', async () => {
    const fn = jest.fn().mockRejectedValue(new RetryableError('error', 502, 3));

    await expect(
      withRetry(fn, { maxRetries: 3, baseDelay: 10, maxDelay: 100, backoffMultiplier: 2, retryableStatusCodes: [502, 503, 504] })
    ).rejects.toThrow('Max retries exceeded');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should not retry on non-retryable error', async () => {
    const fn = jest.fn().mockRejectedValue(new RetryableError('error', 400, 1));

    await expect(
      withRetry(fn, { maxRetries: 3, baseDelay: 10, maxDelay: 100, backoffMultiplier: 2, retryableStatusCodes: [502, 503, 504] })
    ).rejects.toThrow('error');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
