# Phase 3: 监控实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 添加结构化日志、请求指标、扩展健康检查

**Architecture:**
- 新建 `src/logger.ts` - 结构化日志系统
- 新建 `src/metrics.ts` - 请求指标收集
- 新建 `src/health.ts` - 增强健康检查
- 修改 `src/server.ts` - 集成日志和指标

**Tech Stack:** Pino + Prometheus metrics + TypeScript

---

### Task 1: 日志系统

**Files:**
- Create: `src/logger.ts`
- Ref: `config/config.yaml`

- [ ] **Step 1: 安装 pino 依赖**

```bash
npm install pino pino-pretty
```

- [ ] **Step 2: 创建日志模块**

创建 `src/logger.ts`:

```typescript
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
```

- [ ] **Step 3: 更新 config.ts 添加日志配置读取**

在 config.ts 添加 getLogLevel 方法

- [ ] **Step 4: 编译验证**

Run: `npm run build`

- [ ] **Step 5: 提交**

---

### Task 2: 指标系统

**Files:**
- Create: `src/metrics.ts`
- Test: `tests/unit/metrics.test.ts`

- [ ] **Step 1: 创建指标模块**

创建 `src/metrics.ts`:

```typescript
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
```

- [ ] **Step 2: 创建单元测试**

创建 `tests/unit/metrics.test.ts`:

```typescript
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
```

- [ ] **Step 3: 运行测试**

Run: `npm test -- tests/unit/metrics.test.ts`
Expected: PASS

- [ ] **Step 4: 提交**

---

### Task 3: 增强健康检查

**Files:**
- Create: `src/health.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: 创建健康检查模块**

创建 `src/health.ts`:

```typescript
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
  if (failedRatio > 0.5 || m.failedRequests > 10) {
    status = 'down';
  } else if (failedRatio > 0.1 || m.failedRequests > 0) {
    status = 'degraded';
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: Date.now() - serverStartTime,
    checks: {
      server: 'ok',
      backend: 'unknown' // 异步检查需要单独处理
    },
    metrics: {
      totalRequests: m.totalRequests,
      failedRequests: m.failedRequests
    }
  };
}
```

- [ ] **Step 2: 修改 server.ts 集成日志和指标**

在 `src/server.ts` 中：

1. 导入模块:
```typescript
import { logger } from './logger';
import { metrics } from './metrics';
import { setServerStartTime, checkBackendHealth, getHealthStatus } from './health';
```

2. 在 Server 构造函数中设置启动时间:
```typescript
constructor() {
  setServerStartTime(Date.now());
  // ... existing code
}
```

3. 修改 /health 端点:
```typescript
this.app.get('/health', async (_req: Request, res: Response) => {
  const backendStatus = await checkBackendHealth();
  const health = getHealthStatus();
  health.checks.backend = backendStatus;
  res.json(health);
});
```

4. 添加请求日志中间件:
```typescript
this.app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const success = res.statusCode < 400;

    metrics.recordRequest(req.path, success, duration);
    logger.info({
      req: { method: req.method, url: req.url, status: res.statusCode },
      res: { duration }
    }, 'request completed');
  });

  next();
});
```

- [ ] **Step 3: 编译验证**

Run: `npm run build`

- [ ] **Step 4: 运行测试**

Run: `npm test`

- [ ] **Step 5: 提交**

---

### Task 4: 可选 - /metrics 端点

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: 添加 /metrics 端点 (仅当配置开启时)**

在 server.ts 添加:

```typescript
// 在 setupRoutes 中添加
const monitoringConfig = configManager.getMonitoringConfig();

if (monitoringConfig.metricsEnabled) {
  this.app.get('/metrics', (_req: Request, res: Response) => {
    res.set('Content-Type', 'text/plain');
    res.send(metrics.getPrometheusMetrics());
  });
}
```

- [ ] **Step 2: 编译验证**

- [ ] **Step 3: 提交**

---

## 实现检查清单

- [ ] Task 1: 日志系统 (PASS)
- [ ] Task 2: 指标系统 (PASS)
- [ ] Task 3: 健康检查增强 (PASS)
- [ ] Task 4: /metrics 端点 (PASS, 可选)

---

## 完成

所有 3 个 Phase 完成后，项目将具备:
- ✅ 流式响应 + 错误重试
- ✅ 单元测试 + 集成测试
- ✅ 日志 + 指标 + 健康检查