# cc2openai 增强功能设计文档

**项目**: cc2openai - OpenAI 兼容 HTTP 代理服务
**版本**: 1.0.0
**日期**: 2026-04-04
**状态**: 设计完成，待实现

---

## 目标

为 cc2openai 添加流式响应、测试、监控、错误重试功能，提升生产可用性。

## 设计范围

- [Phase 1] 流式响应 + 错误重试
- [Phase 2] 测试
- [Phase 3] 监控

---

# Phase 1: 流式响应 + 错误重试

## 1.1 目标

实现代理服务的流式响应能力，支持 SSE 格式输出。同时添加请求失败时的自动重试机制，提升可靠性。

## 1.2 流式响应

### 1.2.1 需求

- 支持 `stream: true` 请求参数
- 使用 SSE (Server-Sent Events) 格式流式返回
- 兼容 OpenAI 和 Anthropic 流式响应格式
- 支持 `format: 'sse'` 和 `format: 'data'` 两种输出格式

### 1.2.2 技术方案

**架构**:

```
Client Request (stream: true)
        ↓
Server (检测 stream 参数)
        ↓
转发后端 (保持流式)
        ↓
Streaming Handler
        ↓
SSE Serializer
        ↓
Client
```

**实现位置**: `src/streaming.ts` (新建)

```typescript
interface StreamingConfig {
  format: 'sse' | 'data';  // 默认 'sse'
  retryInterval: number;       // 重试间隔 (ms)
}

export class StreamingHandler {
  // 将 OpenAI 流式 chunk 转换为 SSE 格式
  convertToSSE(chunk: OpenAIChunk): string;

  // 将 Anthropic 流式 chunk 转换为 SSE 格式
  convertAnthropicToSSE(chunk: AnthropicChunk): string;

  // 流式代理转发
  proxyStream(
    backendUrl: string,
    request: AnthropicRequest,
    config: StreamingConfig
  ): Promise<void>;  // 使用 transformResponse 回调
}
```

**端点行为**:

| 端点 | 流式请求 | 非流式请求 |
|------|---------|-----------|
| `/v1/messages` | SSE 格式返回 | JSON 返回 |
| `/v1/chat/completions` | SSE 格式返回 | JSON 返回 |

**SSE 格式 (默认)**:

```
data: {"id":"chatcmpl-xxx","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: [DONE]
```

**data 格式 (备选)**:

```
{"id":"chatcmpl-xxx","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}
[DONE]
```

### 1.2.3 注意事项

- 转发层使用 `Response.body` 的 ReadableStream
- 需要正确处理后端连接断开
- 设置适当的超时时间（与 max_tokens 对应）
- 错误时的 SSE 格式: `data: {"error":"message"}`

---

## 1.3 错误重试

### 1.3.1 需求

- 后端请求 5xx 错误时自动重试
- 指数退避策略 (exponential backoff)
- 最大重试次数可配置
- 流式请求成功第一个 chunk 后不再重试

### 1.3.2 技术方案

**实现位置**: `src/retry.ts` (新建)

```typescript
interface RetryConfig {
  maxRetries: number;          // 默认 3
  baseDelay: number;        // 基础延迟 (ms), 默认 1000
  maxDelay: number;       // 最大延迟 (ms), 默认 10000
  backoffMultiplier: number; // 退避倍数, 默认 2
  retryableStatusCodes: number[]; // 可重试状态码, 默认 [502, 503, 504]
}

export class RetryableError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public attempt: number
  );
}

// 核心重试函数
async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<T>;
```

**重试策略**:

| 重试次数 | 延迟 |
|---------|------|
| 1 | 1000ms |
| 2 | 2000ms |
| 3 | 4000ms |
| ... | min(baseDelay * 2^(n-1), maxDelay) |

**重试条件**:

- HTTP 状态码: 502, 503, 504 (可���置)
- 网络错误 (ECONNREFUSED, ETIMEDOUT)
- 超时错误 (可选)

**不重试条件**:

- 4xx 客户端错误
- 流式请求已开始接收数据
- 已超过最大重试次数

### 1.3.3 配置

```yaml
retry:
  maxRetries: 3
  baseDelay: 1000
  maxDelay: 10000
  backoffMultiplier: 2
  retryableStatusCodes: [502, 503, 504]
```

---

## 1.4 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/streaming.ts` | 新建 | 流式处理逻辑 |
| `src/retry.ts` | 新建 | 重试逻辑 |
| `src/types.ts` | 修改 | 添加流式/重试类型 |
| `src/config.ts` | 修改 | 重试配置读取 |
| `src/server.ts` | 修改 | 集成流式和重试 |
| `config/config.yaml` | 修改 | 添加配置 |

---

# Phase 2: 测试

## 2.1 目标

添加 Jest 单元测试和集成测试，确保代码质量。

## 2.2 测试框架

**测试框架**: Jest + Supertest

**依赖**:
```json
{
  "devDependencies": {
    "@types/jest": "^29.x",
    "jest": "^29.x",
    "ts-jest": "^29.x",
    "supertest": "^6.x",
    "@types/supertest": "^6.x"
  }
}
```

**配置**: `jest.config.js`

---

## 2.3 测试覆盖

### 2.3.1 单元测试

| 模块 | 测试内容 | 优先级 |
|------|---------|--------|
| `converter.ts` | 格式转换 | 高 |
| `config.ts` | 配置加载 | 高 |
| `retry.ts` | 重试逻辑 | 中 |
| `streaming.ts` | SSE 序列化 | 中 |

### 2.3.2 集成测试

| 端点 | 测试内容 | 优先级 |
|------|---------|--------|
| `/health` | 健康检查 | 高 |
| `/v1/messages` | 请求转换 + 转发 | 高 |
| `/v1/chat/completions` | 请求透传 | 中 |
| 流式 | SSE 输出 | 中 |

---

## 2.4 文件结构

```
tests/
├── unit/
│   ├── converter.test.ts
│   ├── config.test.ts
│   ├── retry.test.ts
│   └── streaming.test.ts
└── integration/
    └── server.test.ts
```

---

## 2.5 测试覆盖目标

- 核心转换逻辑: 100%
- 错误处理: 80%
- 配置加载: 90%

---

# Phase 3: 监控

## 3.1 目标

添加结构化日志、请求指标、扩展健康检查。

## 3.2 日志系统

### 3.2.1 技术选型

**库**: Pino (轻量、高性能)

**配置**:
```typescript
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty' }
    : undefined
});
```

### 3.2.2 日志格式

```json
{
  "level": 30,
  "time": 1617955768092,
  "msg": "request completed",
  "req": { "method": "POST", "url": "/v1/messages", "status": 200 },
  "res": { "duration": 150 }
}
```

### 3.2.3 日志内容

| 级别 | 内容 |
|------|------|
| INFO | 请求开始/结束、配置加载、服务启动 |
| WARN | 重试、后端响应慢 |
| ERROR | 请求失败、错误异常 |

---

## 3.3 请求指标

### 3.3.1 指标定义

```typescript
interface RequestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  requestsByEndpoint: Record<string, number>;
  errorsByType: Record<string, number>;
}
```

### 3.3.2 暴露方式

**端点**: `GET /metrics` (可选，需要配置开启)
**格式**: Prometheus text exposition

```
# HELP cc2openai_total_requests Total requests
# TYPE cc2openai_total_requests counter
cc2openai_total_requests 1234

# HELP cc2openai_average_response_time Average response time (ms)
# TYPE cc2openai_average_response_time gauge
cc2openai_average_response_time 145.6
```

---

## 3.4 扩展健康检查

### 3.4.1 健康检查端点

**当前**: `/health` 返回 `{ status: 'ok' }`

**增强后**: `/health` ��回详细状态

```json
{
  "status": "ok",
  "timestamp": "2026-04-04T12:00:00Z",
  "uptime": 3600000,
  "checks": {
    "server": "ok",
    "backend": "ok"
  },
  "metrics": {
    "totalRequests": 1234,
    "failedRequests": 5
  }
}
```

### 3.4.2 后端检查

添加 `/health` 的健康检查逻辑：

```typescript
async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${backendUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

### 3.4.3 配置

```yaml
monitoring:
  enabled: true
  logLevel: "info"
  metricsEnabled: false  # 是否暴露 /metrics
  backendHealthCheck: true
```

---

## 3.5 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/logger.ts` | 新建 | 日志模块 |
| `src/metrics.ts` | 新建 | 指标模块 |
| `src/health.ts` | 新建 | 健康检查模块 |
| `src/server.ts` | 修改 | 集成日志和指标 |

---

# 实现优先级

## Phase 1 (核心功能)

1. `src/retry.ts` - 重试逻辑
2. `src/streaming.ts` - 流式处理
3. 修改 `server.ts` 集成
4. 配置更新

## Phase 2 (质量保证)

1. Jest 配置
2. 单元测试
3. 集成测试

## Phase 3 (运维)

1. 日志系统
2. 指标 (可选)
3. 健康检查增强

---

# 验收标准

## Phase 1

- [ ] 流式请求返回 SSE 格式
- [ ] 流式请求正确转发响应 chunk
- [ ] 流式请求错误时正确返回错误信息
- [ ] 5xx 错误触发重试
- [ ] 重试使用指数退避
- [ ] 配置可控制重试参数

## Phase 2

- [ ] `npm test` 通过
- [ ] 覆盖率 > 80%

## Phase 3

- [ ] 请求日志输出 JSON 格式
- [ ] `/health` 返回详细状态
- [ ] 配置可控制日志级别