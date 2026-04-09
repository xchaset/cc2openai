interface Metrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  requestsByEndpoint: Record<string, number>;
  responseTimes: number[];
}

class RequestMetrics {
  private metrics: Metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    requestsByEndpoint: {},
    responseTimes: []
  };

  private static readonly MAX_RESPONSE_TIMES = 10000;

  recordRequest(endpoint: string, success: boolean, responseTime: number): void {
    this.metrics.totalRequests++;
    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    this.metrics.requestsByEndpoint[endpoint] =
      (this.metrics.requestsByEndpoint[endpoint] || 0) + 1;

    this.metrics.responseTimes.push(responseTime);
    // Prevent unbounded memory growth
    if (this.metrics.responseTimes.length > RequestMetrics.MAX_RESPONSE_TIMES) {
      this.metrics.responseTimes = this.metrics.responseTimes.slice(-RequestMetrics.MAX_RESPONSE_TIMES);
    }
  }

  getMetrics() {
    const avgResponseTime = this.metrics.responseTimes.length > 0
      ? this.metrics.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.responseTimes.length
      : 0;

    return {
      totalRequests: this.metrics.totalRequests,
      successfulRequests: this.metrics.successfulRequests,
      failedRequests: this.metrics.failedRequests,
      averageResponseTime: Math.round(avgResponseTime * 100) / 100,
      requestsByEndpoint: { ...this.metrics.requestsByEndpoint }
    };
  }

  getPrometheusMetrics(): string {
    const m = this.getMetrics();
    return `# HELP cc2openai_total_requests Total requests
# TYPE cc2openai_total_requests counter
cc2openai_total_requests ${m.totalRequests}

# HELP cc2openai_successful_requests Successful requests
# TYPE cc2openai_successful_requests counter
cc2openai_successful_requests ${m.successfulRequests}

# HELP cc2openai_failed_requests Failed requests
# TYPE cc2openai_failed_requests counter
cc2openai_failed_requests ${m.failedRequests}

# HELP cc2openai_average_response_time Average response time (ms)
# TYPE cc2openai_average_response_time gauge
cc2openai_average_response_time ${m.averageResponseTime}
`;
  }

  reset(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      requestsByEndpoint: {},
      responseTimes: []
    };
  }
}

export const metrics = new RequestMetrics();
