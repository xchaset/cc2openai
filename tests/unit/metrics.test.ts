import { metrics } from '../../src/metrics';

describe('RequestMetrics', () => {
  beforeEach(() => {
    metrics.reset();
  });

  it('should record successful request', () => {
    metrics.recordRequest('/v1/messages', true, 100);

    const m = metrics.getMetrics();
    expect(m.totalRequests).toBe(1);
    expect(m.successfulRequests).toBe(1);
    expect(m.failedRequests).toBe(0);
  });

  it('should record failed request', () => {
    metrics.recordRequest('/v1/messages', false, 50);

    const m = metrics.getMetrics();
    expect(m.totalRequests).toBe(1);
    expect(m.successfulRequests).toBe(0);
    expect(m.failedRequests).toBe(1);
  });

  it('should calculate average response time', () => {
    metrics.recordRequest('/v1/messages', true, 100);
    metrics.recordRequest('/v1/messages', true, 200);

    const m = metrics.getMetrics();
    expect(m.averageResponseTime).toBe(150);
  });

  it('should track requests by endpoint', () => {
    metrics.recordRequest('/v1/messages', true, 100);
    metrics.recordRequest('/v1/chat/completions', true, 50);

    const m = metrics.getMetrics();
    expect(m.requestsByEndpoint['/v1/messages']).toBe(1);
    expect(m.requestsByEndpoint['/v1/chat/completions']).toBe(1);
  });

  it('should generate prometheus metrics', () => {
    metrics.recordRequest('/v1/messages', true, 100);

    const prometheus = metrics.getPrometheusMetrics();
    expect(prometheus).toContain('cc2openai_total_requests 1');
    expect(prometheus).toContain('cc2openai_successful_requests 1');
  });
});
