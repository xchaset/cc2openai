import { configManager } from './config';
import { metrics } from './metrics';

interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime: number;
  checks: {
    server: 'ok' | 'error';
    backend: 'ok' | 'error' | 'unknown';
  };
  metrics: {
    totalRequests: number;
    failedRequests: number;
  };
}

let serverStartTime = Date.now();

export function setServerStartTime(time: number): void {
  serverStartTime = time;
}

export async function checkBackendHealth(): Promise<'ok' | 'error' | 'unknown'> {
  try {
    const backendUrl = configManager.getBackendUrl();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${backendUrl}/health`, {
      method: 'GET',
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return response.ok ? 'ok' : 'error';
  } catch {
    return 'unknown';
  }
}

export function getHealthStatus(): HealthStatus {
  const m = metrics.getMetrics();
  const failedRatio = m.totalRequests > 0 ? m.failedRequests / m.totalRequests : 0;

  let status: 'ok' | 'degraded' | 'down' = 'ok';
  if (failedRatio > 0.5 && m.totalRequests > 5) {
    status = 'down';
  } else if (failedRatio > 0.1 && m.totalRequests > 5) {
    status = 'degraded';
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: Date.now() - serverStartTime,
    checks: {
      server: 'ok',
      backend: 'unknown'
    },
    metrics: {
      totalRequests: m.totalRequests,
      failedRequests: m.failedRequests
    }
  };
}