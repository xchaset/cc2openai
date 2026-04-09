# cc2openai

OpenAI 兼容 HTTP 代理服务，将 Claude Code 调用转发到目标 OpenAI 兼容后端。

## 功能

- HTTP 代理：接收标准 OpenAI 格式请求，转发给目标后端
- 响应透传：将后端响应直接返回
- Bearer Token 认证

## 快速开始

### 安装依赖

```bash
npm install
```

### 构建

```bash
npm run build
```

### 配置

编辑 `config/config.yaml`:

```yaml
server:
  port: 3000
  host: "0.0.0.0"

backend:
  url: "http://localhost:8080"
  apiKey: "your-backend-api-key"

auth:
  apiKey: "your-proxy-api-key"
```

### 运行

```bash
# 生产
npm start

# 开发
npm run dev
```

## API 端点

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /health | 健康检查 |
| POST | /v1/chat/completions | 聊天完成 |

## 环境变量

| 变量 | 描述 |
|------|------|
| SERVER_PORT | 服务端口 |
| SERVER_HOST | 服务地址 |
| BACKEND_URL | 后端服务地址 |
| BACKEND_API_KEY | 后端 API 密钥 |
| AUTH_API_KEY | 代理认证密钥 |

## 使用示例

```bash
# 健康检查
curl http://localhost:3000/health

# 聊天完成
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer your-proxy-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```