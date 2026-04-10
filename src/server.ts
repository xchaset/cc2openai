import express, { Request, Response, NextFunction } from 'express';
import { configManager } from './config';
import { logger } from './logger';
import { metrics } from './metrics';
import { setServerStartTime, checkBackendHealth, getHealthStatus } from './health';
import { streamingHandler } from './streaming';
import { withRetry } from './retry';

// 脱敏处理：隐藏 API Key 的中间部分
function maskApiKey(key: string): string {
  if (!key || key.length < 10) return '***';
  return key.slice(0, 6) + '...' + key.slice(-4);
}

// Anthropic content block types
interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

// Anthropic API 请求格式
interface AnthropicMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | AnthropicContentBlock[];
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | string[];
  max_tokens?: number;
  temperature?: number;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  stream?: boolean;
}

// Anthropic API 响应格式
interface AnthropicResponseContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  tool_name?: string;
  content?: string;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicResponseContentBlock[];
  model: string;
  stop_reason: string;
  stop_sequence?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class Server {
  private app = express();
  private port: number;
  private host: string;

  constructor() {
    this.port = configManager.getServerPort();
    this.host = configManager.getServerHost();
    setServerStartTime(Date.now());
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // 配置 body parser，增大请求体限制以支持大请求
    this.app.use(express.json({
      limit: '50mb',  // 增加请求体大小限制
      strict: true     // 只接受数组和对象
    }));

    // Request logging and metrics middleware
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

    // No authentication - proxy is open (auth handled by backend)
  }

  /**
   * 将 Anthropic 请求转换为 OpenAI 格式
   *
   * Anthropic content 可以是 string 或 content block 数组:
   *   - text block → 提取文本
   *   - tool_use block → 转为 OpenAI tool_calls
   *   - tool_result block → 转为 OpenAI tool message
   */
  private convertAnthropicToOpenAI(request: AnthropicRequest): Record<string, unknown> {
    interface OpenAIMessage {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
      tool_call_id?: string;
    }

    const messages: OpenAIMessage[] = [];

    // 处理 system 消息
    if (request.system) {
      const systemContent = Array.isArray(request.system)
        ? request.system.join('\n')
        : request.system;
      messages.push({ role: 'system', content: systemContent });
    }

    // 转换消息
    for (const msg of request.messages) {
      // content 是纯 string，直接传
      if (typeof msg.content === 'string') {
        messages.push({ role: msg.role, content: msg.content });
        continue;
      }

      // content 是 block 数组，需要拆分处理
      const blocks = msg.content as AnthropicContentBlock[];
      const textParts: string[] = [];
      const toolCalls: OpenAIMessage['tool_calls'] = [];
      const toolResults: OpenAIMessage[] = [];

      for (const block of blocks) {
        switch (block.type) {
          case 'text':
            textParts.push(block.text);
            break;

          case 'tool_use':
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: typeof block.input === 'string'
                  ? block.input
                  : JSON.stringify(block.input)
              }
            });
            break;

          case 'tool_result': {
            let resultContent = '';
            if (typeof block.content === 'string') {
              resultContent = block.content;
            } else if (Array.isArray(block.content)) {
              resultContent = block.content
                .map(c => c.text || '')
                .filter(Boolean)
                .join('\n');
            }
            toolResults.push({
              role: 'tool',
              content: resultContent,
              tool_call_id: block.tool_use_id
            });
            break;
          }
        }
      }

      // assistant 消息：文本 + tool_calls
      if (msg.role === 'assistant') {
        const assistantMsg: OpenAIMessage = {
          role: 'assistant',
          content: textParts.length > 0 ? textParts.join('\n') : null
        };
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }
        messages.push(assistantMsg);
      } else if (msg.role === 'user') {
        // user 消息中可能包含 tool_result（Anthropic 把 tool result 放在 user 消息里）
        if (toolResults.length > 0) {
          // 先推 tool result messages
          for (const tr of toolResults) {
            messages.push(tr);
          }
          // 如果还有文本部分，单独推一条 user 消息
          if (textParts.length > 0) {
            messages.push({ role: 'user', content: textParts.join('\n') });
          }
        } else {
          messages.push({
            role: 'user',
            content: textParts.join('\n') || ''
          });
        }
      } else {
        // 其他 role，拼接文本
        messages.push({
          role: msg.role,
          content: textParts.join('\n') || ''
        });
      }
    }

    const openAIRequest: Record<string, unknown> = {
      model: request.model,
      messages,
      stream: request.stream || false
    };

    if (request.temperature !== undefined) {
      openAIRequest.temperature = request.temperature;
    }
    if (request.max_tokens !== undefined) {
      openAIRequest.max_tokens = request.max_tokens;
    }

    // 转换 tools (Anthropic tools 格式 -> OpenAI tools 格式)
    if (request.tools && request.tools.length > 0) {
      openAIRequest.tools = request.tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema
        }
      }));
    }

    return openAIRequest;
  }

  /**
   * 将 OpenAI 响应转换为 Anthropic 格式
   */
  private convertOpenAItoAnthropic(openAIResponse: Record<string, unknown>): AnthropicResponse {
    const choices = openAIResponse.choices as Array<Record<string, unknown>>;
    const firstChoice = choices?.[0] as Record<string, unknown> | undefined;
    const message = firstChoice?.message as Record<string, unknown> | undefined;

    const anthropicResponse: AnthropicResponse = {
      id: (openAIResponse.id as string) || `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [],
      model: (openAIResponse.model as string) || 'unknown',
      stop_reason: (firstChoice?.finish_reason as string) || 'end_turn',
      usage: {
        input_tokens: (openAIResponse.usage as Record<string, number>)?.prompt_tokens || 0,
        output_tokens: (openAIResponse.usage as Record<string, number>)?.completion_tokens || 0
      }
    };

    // 处理内容
    if (message?.content) {
      const content = message.content as string;
      anthropicResponse.content.push({
        type: 'text',
        text: content
      });
    }

    // 处理 tool_calls (如果有)
    if (message?.tool_calls && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls as Array<Record<string, unknown>>) {
        anthropicResponse.content.push({
          type: 'tool_use',
          id: (toolCall.id as string) || `tool_${Date.now()}`,
          name: (toolCall.function as Record<string, unknown>)?.name as string,
          input: (toolCall.function as Record<string, unknown>)?.arguments
        });
      }
    }

    return anthropicResponse;
  }

  private setupRoutes(): void {
    // Health check (no auth required)
    this.app.get('/health', async (_req: Request, res: Response) => {
      const health = getHealthStatus();
      health.checks.backend = await checkBackendHealth();
      res.json(health);
    });

    // Anthropic Messages API 端点 (接收 Anthropic 格式请求)
    this.app.post('/v1/messages', async (req: Request, res: Response) => {
      try {
        const request = req.body as AnthropicRequest;

        // === 日志 1: 接收到的请求信息 ===
        logger.info({
          direction: 'INCOMING',
          endpoint: '/v1/messages',
          method: req.method,
          url: req.originalUrl,
          headers: {
            'content-type': req.headers['content-type'],
            'user-agent': req.headers['user-agent'],
            authorization: req.headers.authorization ? maskApiKey(req.headers.authorization as string) : 'none'
          },
          body: {
            model: request.model,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: request.stream,
            system: request.system,
            tools_count: request.tools?.length || 0,
            messages_count: request.messages?.length || 0
          }
        }, '收到 Anthropic 请求');

        // 将 Anthropic 格式转换为 OpenAI 格式
        const openAIRequest = this.convertAnthropicToOpenAI(request);

        const backendUrl = configManager.getBackendUrl();
        const backendApiKey = configManager.getBackendApiKey();

        // 流式请求处理
        if (request.stream) {
          const retryConfig = configManager.getRetryConfig();

          // === 日志 2: 发送给后端的流式请求 ===
          logger.info({
            direction: 'OUTGOING',
            endpoint: `${backendUrl}/v1/chat/completions`,
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${maskApiKey(backendApiKey)}`
            },
            body: openAIRequest
          }, '发送流式请求到后端');

          // Set SSE headers
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });

          try {
            await withRetry(
              () => streamingHandler.proxyStream(
                `${backendUrl}/v1/chat/completions`,
                { ...openAIRequest, stream: true },
                { format: 'sse', retryInterval: 1000 },
                (chunk) => {
                  res.write(chunk);
                  return Promise.resolve();
                },
                backendApiKey
              ),
              retryConfig
            );
          } catch (streamError) {
            console.error('Streaming error:', streamError);
            res.write(`data: ${JSON.stringify({ error: { type: 'stream_error', message: streamError instanceof Error ? streamError.message : 'Stream error' } })}\n\n`);
          }

          res.end();
          return;
        }

        // 非流式请求处理
        // === 日志 2: 发送给后端的非流式请求 ===
        logger.info({
          direction: 'OUTGOING',
          endpoint: `${backendUrl}/v1/chat/completions`,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${maskApiKey(backendApiKey)}`
          },
          body: openAIRequest
        }, '发送非流式请求到后端');

        const backendResponse = await fetch(`${backendUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${backendApiKey}`
          },
          body: JSON.stringify(openAIRequest)
        });

        if (!backendResponse.ok) {
          const errorText = await backendResponse.text();

          // === 日志 3: 后端错误响应 ===
          logger.error({
            direction: 'BACKEND_ERROR',
            status: backendResponse.status,
            statusText: backendResponse.statusText,
            body: errorText
          }, '后端返回错误');

          res.status(backendResponse.status).json({
            error: {
              type: 'api_error',
              message: errorText
            }
          });
          return;
        }

        const openAIResponse = await backendResponse.json();

        // === 日志 3: 后端返回的响应 ===
        logger.info({
          direction: 'BACKEND_RESPONSE',
          body: openAIResponse
        }, '收到后端响应');

        // 将 OpenAI 格式响应转换为 Anthropic 格式
        const anthropicResponse = this.convertOpenAItoAnthropic(openAIResponse as Record<string, unknown>);

        // === 日志 4: 转换后的 Anthropic 响应 ===
        logger.info({
          direction: 'OUTGOING_RESPONSE',
          body: anthropicResponse
        }, '发送转换后的 Anthropic 响应给客户端');

        res.json(anthropicResponse);
      } catch (error) {
        console.error('Error in /v1/messages:', error);
        res.status(500).json({
          error: {
            type: 'server_error',
            message: error instanceof Error ? error.message : 'Internal server error'
          }
        });
      }
    });

    // OpenAI Chat Completions 端点 (也支持，作为备选)
    this.app.post('/v1/chat/completions', async (req: Request, res: Response) => {
      try {
        const request = req.body;

        // === 日志 1: 接收到的请求信息 ===
        logger.info({
          direction: 'INCOMING',
          endpoint: '/v1/chat/completions',
          method: req.method,
          url: req.originalUrl,
          headers: {
            'content-type': req.headers['content-type'],
            'user-agent': req.headers['user-agent'],
            authorization: req.headers.authorization ? maskApiKey(req.headers.authorization as string) : 'none'
          },
          body: request
        }, '收到 OpenAI 请求');

        const backendUrl = configManager.getBackendUrl();
        const backendApiKey = configManager.getBackendApiKey();

        // === 日志 2: 发送给后端的请求 ===
        logger.info({
          direction: 'OUTGOING',
          endpoint: `${backendUrl}/v1/chat/completions`,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${maskApiKey(backendApiKey)}`
          },
          body: request
        }, '发送请求到后端');

        const backendResponse = await fetch(`${backendUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${backendApiKey}`
          },
          body: JSON.stringify(request)
        });

        if (!backendResponse.ok) {
          const errorText = await backendResponse.text();

          // === 日志 3: 后端错误响应 ===
          logger.error({
            direction: 'BACKEND_ERROR',
            status: backendResponse.status,
            statusText: backendResponse.statusText,
            body: errorText
          }, '后端返回错误');

          res.status(backendResponse.status).json({ error: errorText });
          return;
        }

        const response = await backendResponse.json();

        // === 日志 3: 后端返回的响应 ===
        logger.info({
          direction: 'BACKEND_RESPONSE',
          body: response
        }, '收到后端响应');

        res.json(response);
      } catch (error) {
        console.error('Error in chat/completions:', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Internal server error'
        });
      }
    });

    // Metrics endpoint (if enabled)
    const monitoringConfig = configManager.getMonitoringConfig();
    if (monitoringConfig.metricsEnabled) {
      this.app.get('/metrics', (_req: Request, res: Response) => {
        res.set('Content-Type', 'text/plain');
        res.send(metrics.getPrometheusMetrics());
      });
    }
  }

  public start(): void {
    this.app.listen(this.port, this.host, () => {
      console.log(`Proxy Server running at http://${this.host}:${this.port}`);
      console.log('Available endpoints:');
      console.log('  POST /v1/messages (Anthropic format)');
      console.log('  POST /v1/chat/completions (OpenAI format)');
    });
  }
}