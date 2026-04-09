# Phase 2: 测试 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 添加 Jest 单元测试和集成测试，确保代码质量

**Architecture:**
- 完善单元测试覆盖 converter, config
- 添加集成测试覆盖 HTTP 端点
- 使用 supertest 进行 API 测试

**Tech Stack:** Jest + Supertest + TypeScript

---

### Task 1: 单元测试 - converter.ts

**Files:**
- Test: `tests/unit/converter.test.ts`
- Ref: `src/converter.ts`

- [ ] **Step 1: 编写 converter 单元测试**

创建 `tests/unit/converter.test.ts`:

```typescript
import { Converter } from '../../src/converter';

describe('Converter', () => {
  let converter: Converter;

  beforeEach(() => {
    converter = new Converter();
  });

  describe('convertToolsToOpenAPITools', () => {
    it('should convert MCP tools to OpenAI format', () => {
      const mcpTools = [
        {
          name: 'get_weather',
          description: 'Get weather for a location',
          input_schema: {
            type: 'object',
            properties: {
              location: { type: 'string' }
            }
          }
        }
      ];

      const result = converter.convertToolsToOpenAPITools(mcpTools);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]).toEqual({
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather for a location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' }
            }
          }
        }
      });
    });

    it('should return error for invalid input', () => {
      const result = converter.convertToolsToOpenAPITools(null as any);
      expect(result.success).toBe(false);
    });
  });

  describe('convertToolsToMCP', () => {
    it('should convert OpenAPI tools to MCP format', () => {
      const openApiTools = [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: {} }
          }
        }
      ];

      const result = converter.convertToolsToMCP(openApiTools);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].name).toBe('get_weather');
    });

    it('should return error for invalid format', () => {
      const result = converter.convertToolsToMCP('invalid');
      expect(result.success).toBe(false);
    });
  });

  describe('addToolMapping', () => {
    it('should add tool mapping', () => {
      converter.addToolMapping({
        mcpToolName: 'test_tool',
        openApiOperationId: 'test_operation',
        parameterMapping: { input: 'param' }
      });

      const result = converter.convertToolCallToOpenAPI({
        id: 'call_123',
        name: 'test_tool',
        input: { input: 'value' }
      });

      expect(result.success).toBe(true);
      expect(result.data?.operationId).toBe('test_operation');
    });

    it('should return error for unknown tool', () => {
      const result = converter.convertToolCallToOpenAPI({
        id: 'call_123',
        name: 'unknown_tool',
        input: {}
      });

      expect(result.success).toBe(false);
    });
  });

  describe('convertRequestToOpenAPI', () => {
    it('should convert basic request', () => {
      const request = {
        model: 'claude-3',
        messages: [
          { role: 'user', content: 'Hello' }
        ]
      };

      const result = converter.convertRequestToOpenAPI(request);

      expect(result.success).toBe(true);
      expect(result.data?.messages).toHaveLength(1);
      expect(result.data?.messages[0].content).toBe('Hello');
    });
  });
});
```

- [ ] **Step 2: 运行测试验证通过**

Run: `npm test -- tests/unit/converter.test.ts`
Expected: PASS

- [ ] **Step 3: 提交**

---

### Task 2: 单元测试 - config.ts

**Files:**
- Test: `tests/unit/config.test.ts`
- Ref: `src/config.ts`

- [ ] **Step 1: 编写 config 单元测试**

创建 `tests/unit/config.test.ts`:

```typescript
import { configManager } from '../../src/config';

describe('ConfigManager', () => {
  beforeEach(() => {
    // Reset config
    (configManager as any).config = null;
  });

  describe('load', () => {
    it('should load config from yaml file', () => {
      const config = configManager.load();

      expect(config.server).toBeDefined();
      expect(config.server.port).toBe(3000);
      expect(config.server.host).toBe('0.0.0.0');
    });

    it('should override with environment variables', () => {
      process.env.SERVER_PORT = '4000';
      process.env.BACKEND_URL = 'http://test:9000';

      const config = configManager.load();

      expect(config.server.port).toBe(4000);
      expect(config.backend.url).toBe('http://test:9000');

      // Clean up
      delete process.env.SERVER_PORT;
      delete process.env.BACKEND_URL;
    });
  });

  describe('getBackendUrl', () => {
    it('should return backend URL', () => {
      const url = configManager.getBackendUrl();
      expect(url).toBe('http://localhost:8080');
    });
  });

  describe('getBackendApiKey', () => {
    it('should return backend API key', () => {
      const apiKey = configManager.getBackendApiKey();
      expect(apiKey).toBeDefined();
    });
  });

  describe('getAuthApiKey', () => {
    it('should return auth API key', () => {
      const apiKey = configManager.getAuthApiKey();
      expect(apiKey).toBeDefined();
    });
  });

  describe('getServerPort', () => {
    it('should return server port', () => {
      const port = configManager.getServerPort();
      expect(port).toBe(3000);
    });
  });

  describe('getRetryConfig', () => {
    it('should return default retry config', () => {
      const config = configManager.getRetryConfig();

      expect(config.maxRetries).toBe(3);
      expect(config.baseDelay).toBe(1000);
      expect(config.maxDelay).toBe(10000);
      expect(config.backoffMultiplier).toBe(2);
      expect(config.retryableStatusCodes).toEqual([502, 503, 504]);
    });
  });
});
```

- [ ] **Step 2: 运行测试验证通过**

Run: `npm test -- tests/unit/config.test.ts`
Expected: PASS

- [ ] **Step 3: 提交**

---

### Task 3: 集成测试 - server.ts

**Files:**
- Test: `tests/integration/server.test.ts`
- Ref: `src/server.ts`

- [ ] **Step 1: 编写集成测试**

创建 `tests/integration/server.test.ts`:

```typescript
import request from 'supertest';
import { Server } from '../../src/server';

describe('Server Integration Tests', () => {
  let server: Server;
  let app: any;

  beforeAll(() => {
    server = new Server();
    // Get the express app
    app = (server as any).app;
  });

  describe('GET /health', () => {
    it('should return ok status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    });
  });

  describe('POST /v1/messages', () => {
    it('should return 401 without auth', async () => {
      const response = await request(app)
        .post('/v1/messages')
        .send({ model: 'claude-3', messages: [{ role: 'user', content: 'Hello' }] });

      expect(response.status).toBe(401);
    });

    it('should return 403 with invalid API key', async () => {
      const response = await request(app)
        .post('/v1/messages')
        .set('Authorization', 'Bearer invalid_key')
        .send({ model: 'claude-3', messages: [{ role: 'user', content: 'Hello' }] });

      expect(response.status).toBe(403);
    });
  });

  describe('POST /v1/chat/completions', () => {
    it('should return 401 without auth', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }] });

      expect(response.status).toBe(401);
    });
  });
});
```

- [ ] **Step 2: 运行测试验证通过**

Run: `npm test -- tests/integration/server.test.ts`
Expected: PASS

- [ ] **Step 3: 提交**

---

### Task 4: 更新 package.json 测试脚本

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 添加测试脚本**

在 `package.json` 的 scripts 中添加:

```json
"test": "jest",
"test:watch": "jest --watch",
"test:coverage": "jest --coverage"
```

- [ ] **Step 2: 验证**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 3: 提交**

---

## 实现检查清单

- [ ] Task 1: converter.ts 单元测试 (PASS)
- [ ] Task 2: config.ts 单元测试 (PASS)
- [ ] Task 3: server.ts 集成测试 (PASS)
- [ ] Task 4: package.json 测试脚本更新 (PASS)

---

## 后续 Phase

完成 Phase 2 后，继续:
- **Phase 3**: 监控 (日志、指标、健康检查)