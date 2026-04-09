# Phase 1: 流式响应 + 错误重试 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现流式响应支持和请求错误自动重试机制

**Architecture:**

- 新建 `src/retry.ts` 处理指数退避重试逻辑
- 新建 `src/streaming.ts` 处理 SSE 流式序列化
- 修改 `src/types.ts` 添加相关类型定义
- 修改 `src/config.ts` 支持重试配置
- 修改 `src/server.ts` 集成流式和重试

**Tech Stack:** Node.js + Express + TypeScript

---

### Task 1: 添加类型定义

**Files:**
- Modify: `src/types.ts`
- Test: (无测试，仅类型定义)

- [ ] **Step 1: 添加 StreamingConfig 和 RetryConfig 类型**

在 `src/types.ts` 末尾添加：

```typescript
// Streaming Types
export interface StreamingConfig {
  format: 'sse' | 'data';
  retryInterval: number;
}

// Retry Types
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableStatusCodes: number[];
}
```

- [ ] **Step 2: 编译验证**

Run: `npm run build`
Expected: 编译成功

- [ ] **Step 3: 提交**

---

### Task 2: 实现重试逻辑

**Files:**
- Create: `src/retry.ts`
- Test: `tests/unit/retry.test.ts`

- [ ] **Step 1: 编写重试函数测试**

创建 `tests/unit/retry.test.ts`:

```typescript
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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test -- tests/unit/retry.test.ts`
Expected: FAIL (模块不存在)

- [ ] **Step 3: 实现重试逻辑**

创建 `src/retry.ts`:

```typescript
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
    // Network errors
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
  let attempt = 0;

  while (attempt < config.maxRetries) {
    attempt++;
    try {
      return await fn();
    } catch (error) {
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

export function wrapRetryable<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  config: RetryConfig
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    return withRetry(() => fn(...args), config);
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test -- tests/unit/retry.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 提交**

---

### Task 3: 实现流式处理

**Files:**
- Create: `src/streaming.ts`
- Test: `tests/unit/streaming.test.ts`

- [ ] **Step 1: 编写流式处理测试**

创建 `tests/unit/streaming.test.ts`:

```typescript
import { StreamingHandler } from '../../src/streaming';

describe('StreamingHandler', () => {
  let handler: StreamingHandler;

  beforeEach(() => {
    handler = new StreamingHandler();
  });

  describe('convertToSSE', () => {
    it('should convert OpenAI chunk to SSE format', () => {
      const chunk = {
        id: 'chatcmpl-xxx',
        choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }]
      };

      const sse = handler.convertToSSE(chunk);
      expect(sse).toMatch(/^data: /);
      expect(sse).toContain('Hello');
    });

    it('should add [DONE] for finish', () => {
      const chunk = {
        id: 'chatcmpl-xxx',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
      };

      const sse = handler.convertToSSE(chunk);
      expect(sse).toBe('data: [DONE]\n\n');
    });

    it('should escape newlines in content', () => {
      const chunk = {
        id: 'chatcmpl-xxx',
        choices: [{ index: 0, delta: { content: 'Line1\nLine2' }, finish_reason: null }]
      };

      const sse = handler.convertToSSE(chunk);
      expect(sse).toContain('Line1\\nLine2');
    });
  });

  describe('convertAnthropicToSSE', () => {
    it('should convert Anthropic chunk to SSE format', () => {
      const chunk = {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello' }
      };

      const sse = handler.convertAnthropicToSSE(chunk);
      expect(sse).toMatch(/^data: /);
      expect(sse).toContain('Hello');
    });
  });

  describe('proxyStream', () => {
    it('should proxy stream correctly', async () => {
      // Mock backend response with readable stream
      const mockResponse = new ReadableStream({
        start(controller) {
          controller.enqueue(JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] }) + '\n');
          controller.close();
        }
      });

      const result: string[] = [];

      await handler.proxyStream(
        'http://localhost:8080/v1/chat/completions',
        { model: 'test', messages: [] },
        { format: 'sse', retryInterval: 1000 },
        (chunk) => { result.push(chunk); return Promise.resolve(); }
      );

      expect(result.length).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test -- tests/unit/streaming.test.ts`
Expected: FAIL (模块不存在)

- [ ] **Step 3: 实现流式处理**

创建 `src/streaming.ts`:

```typescript
import { StreamingConfig } from './types';

interface OpenAIChunk {
  id?: string;
  choices?: Array<{
    index: number;
    delta?: {
      content?: string;
      role?: string;
    };
    finish_reason?: string | null;
  }>;
}

interface AnthropicChunk {
  type: string;
  delta?: {
    type: string;
    text?: string;
  };
}

export class StreamingHandler {
  private format: 'sse' | 'data';

  constructor(format: 'sse' | 'data' = 'sse') {
    this.format = format;
  }

  /**
   * Convert OpenAI chunk to SSE format
   */
  convertToSSE(chunk: unknown): string {
    const openAIChunk = chunk as OpenAIChunk;
    const choices = openAIChunk.choices || [];
    const firstChoice = choices[0];
    const finishReason = firstChoice?.finish_reason;

    if (finishReason === 'stop' || finishReason === 'length') {
      return 'data: [DONE]\n\n';
    }

    const content = firstChoice?.delta?.content || '';
    const escapedContent = this.escapeSSEContent(content);

    if (this.format === 'sse') {
      return `data: ${JSON.stringify(openAIChunk)}\n\n`;
    } else {
      return `${JSON.stringify(openAIChunk)}\n[DONE]\n`;
    }
  }

  /**
   * Convert Anthropic chunk to SSE format
   */
  convertAnthropicToSSE(chunk: unknown): string {
    const anthropicChunk = chunk as AnthropicChunk;

    if (anthropicChunk.type === 'message_stop') {
      return 'data: [DONE]\n\n';
    }

    const text = anthropicChunk.delta?.text || '';

    if (this.format === 'sse') {
      return `data: ${JSON.stringify(anthropicChunk)}\n\n`;
    } else {
      return `${JSON.stringify(anthropicChunk)}\n[DONE]\n`;
    }
  }

  /**
   * Proxy streaming request to backend
   */
  async proxyStream(
    backendUrl: string,
    request: unknown,
    config: StreamingConfig,
    onChunk: (chunk: string) => Promise<void>
  ): Promise<void> {
    this.format = config.format;

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.text();
      const errorMessage = `data: ${JSON.stringify({ error })}\n\n`;
      await onChunk(errorMessage);
      return;
    }

    if (!response.body) {
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (buffer.trim()) {
            try {
              const chunk = JSON.parse(buffer);
              const sse = this.convertToSSE(chunk);
              await onChunk(sse);
            } catch {
              // Non-JSON response
            }
          }
          await onChunk('data: [DONE]\n\n');
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            if (data === '[DONE]') {
              await onChunk('data: [DONE]\n\n');
              return;
            }

            try {
              const chunk = JSON.parse(data);
              const sse = this.convertToSSE(chunk);
              await onChunk(sse);
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Escape content for SSE format
   */
  private escapeSSEContent(content: string): string {
    return content
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }
}

// Singleton instance
export const streamingHandler = new StreamingHandler();
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test -- tests/unit/streaming.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 提交**

---

### Task 4: 更新配置支持

**Files:**
- Modify: `src/config.ts`
- Modify: `config/config.yaml`

- [ ] **Step 1: 添加配置读取方法**

在 `src/config.ts` 添加：

```typescript
import { RetryConfig } from './types';

// 在 ConfigManager 类中添加

/**
 * Get retry configuration
 */
getRetryConfig(): RetryConfig {
  const config = this.get();
  return config.retry || {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
    retryableStatusCodes: [502, 503, 504]
  };
}
```

- [ ] **Step 2: 更新配置类型**

在 `src/types.ts` 修改 `Config` 接口：

```typescript
export interface Config {
  server: {
    port: number;
    host: string;
  };
  backend: {
    url: string;
    apiKey: string;
    openApiSpecPath?: string;
  };
  auth: {
    apiKey: string;
  };
  retry?: RetryConfig;
  monitoring?: {
    enabled: boolean;
    logLevel?: string;
    metricsEnabled?: boolean;
    backendHealthCheck?: boolean;
  };
}
```

- [ ] **Step 3: 更新 YAML 配置**

修改 `config/config.yaml`：

```yaml
server:
  port: 3000
  host: "0.0.0.0"

backend:
  url: "http://localhost:8080"
  apiKey: "your-backend-api-key"
  openApiSpecPath: "./config/openapi.json"

auth:
  apiKey: "your-proxy-api-key"

retry:
  maxRetries: 3
  baseDelay: 1000
  maxDelay: 10000
  backoffMultiplier: 2
  retryableStatusCodes: [502, 503, 504]

monitoring:
  enabled: true
  logLevel: "info"
  metricsEnabled: false
  backendHealthCheck: true
```

- [ ] **Step 4: 编译验证**

Run: `npm run build`
Expected: 编译成功

- [ ] **Step 5: 提交**

---

### Task 5: 集成到 Server

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: 实现流式请求处理**

在 `src/server.ts` 的 `/v1/messages` 端点添加流式支持：

```typescript
// 在 imports 中添加
import { streamingHandler } from './streaming';
import { withRetry } from './retry';
import { configManager } from './config';

// 在 convertAnthropicToOpenAI 方法中添加 stream 参数处理
private convertAnthropicToOpenAI(request: AnthropicRequest): Record<string, unknown> {
  const openAIRequest: Record<string, unknown> = {
    model: request.model,
    messages,
    stream: request.stream || false
  };
  // ... 现有逻辑
  return openAIRequest;
}

// 修改 /v1/messages 端点
this.app.post('/v1/messages', async (req: Request, res: Response) => {
  try {
    const request = req.body as AnthropicRequest;

    // Check if streaming
    if (request.stream) {
      const openAIRequest = this.convertAnthropicToOpenAI(request);
      const backendUrl = configManager.getBackendUrl();
      const backendApiKey = configManager.getBackendApiKey();
      const retryConfig = configManager.getRetryConfig();

      // Set SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      await withRetry(
        () => streamingHandler.proxyStream(
          `${backendUrl}/v1/chat/completions`,
          { ...openAIRequest, stream: true },
          { format: 'sse', retryInterval: 1000 },
          (chunk) => {
            res.write(chunk);
            return Promise.resolve();
          }
        ),
        retryConfig
      );

      res.end();
      return;
    }

    // Existing non-stream logic...
  } catch (error) {
    // Existing error handling...
  }
});
```

- [ ] **Step 2: 添加流式错误处理**

确保流式请求错误时正确返回错误信息：

```typescript
// 在流式处理中添加错误处理
if (!response.ok) {
  const error = await response.text();
  const errorChunk = `data: ${JSON.stringify({ error: { type: 'api_error', message: error } })}\n\n`;
  res.write(errorChunk);
  res.end();
  return;
}
```

- [ ] **Step 3: 编译验证**

Run: `npm run build`
Expected: 编译成功

- [ ] **Step 4: 运行测试**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 5: 提交**

---

### Task 6: 端到端验证

**Files:**
- (无文件变更)

- [ ] **Step 1: 启动后端 mock 服务**

```bash
# 启动一个简单的 mock OpenAI 服务 (使用 npx)
npx @anthropic-ai/sdk mock-server 或创建简单测试服务器
```

- [ ] **Step 2: 测试非流式请求**

```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Authorization: Bearer your-proxy-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-opus",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

Expected: JSON 响应

- [ ] **Step 3: 测试流式请求**

```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Authorization: Bearer your-proxy-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-opus",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

Expected: SSE 格式响应

- [ ] **Step 4: 测试重试机制**

确保重试逻辑正常工作

- [ ] **Step 5: 提交**

---

## 实现检查清单

- [ ] Task 1: 类型定义添加完成
- [ ] Task 2: 重试逻辑实现 (5 tests passing)
- [ ] Task 3: 流式处理实现 (6 tests passing)
- [ ] Task 4: 配置更新完成
- [ ] Task 5: Server 集成完成
- [ ] Task 6: 端到端验证通过

---

## 后续 Phase

完成 Phase 1 后，继续:
- **Phase 2**: 测试 (Jest 配置 + 单元/集成测试)
- **Phase 3**: 监控 (日志、指标、健康检查)