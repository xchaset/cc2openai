import express, { Request, Response, NextFunction } from 'express';
import { configManager } from './config';
import { logger } from './logger';
import { metrics } from './metrics';
import { setServerStartTime, checkBackendHealth, getHealthStatus } from './health';
import { streamingHandler } from './streaming';
import { withRetry } from './retry';

// Anthropic API 请求格式
interface AnthropicMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
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
interface AnthropicContentBlock {
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
  content: AnthropicContentBlock[];
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
    this.app.use(express.json());

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

    // API Key authentication middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      // Skip auth for health check
      if (req.path === '/health') {
        next();
        return;
      }

      const authHeader = req.headers.authorization;

      if (!authHeader) {
        res.status(401).json({ error: 'Authorization header required' });
        return;
      }

      const apiKey = authHeader.replace('Bearer ', '');
      const validKey = configManager.getAuthApiKey();

      if (apiKey !== validKey) {
        res.status(403).json({ error: 'Invalid API key' });
        return;
      }

      next();
    });
  }

  /**
   * 将 Anthropic 请求转换为 OpenAI 格式
   */
  private convertAnthropicToOpenAI(request: AnthropicRequest): Record<string, unknown> {
    interface OpenAIMessage {
      role: string;
      content: string;
    }

    const messages: OpenAIMessage[] = [];

    // 处理 system 消息
    if (request.system) {
      const systemContent = Array.isArray(request.system)
        ? request.system.join('\n')
        : request.system;
      messages.push({
        role: 'system',
        content: systemContent
      });
    }

    // 转换消息
    for (const msg of request.messages) {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    }

    const openAIRequest: Record<string, unknown> = {
      model: request.model,
      messages,
      stream: request.stream || false
    };

    // 复制其他参数
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

        // 将 Anthropic 格式转换为 OpenAI 格式
        const openAIRequest = this.convertAnthropicToOpenAI(request);

        const backendUrl = configManager.getBackendUrl();
        const backendApiKey = configManager.getBackendApiKey();

        // 流式请求处理
        if (request.stream) {
          const retryConfig = configManager.getRetryConfig();

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
          res.status(backendResponse.status).json({
            error: {
              type: 'api_error',
              message: errorText
            }
          });
          return;
        }

        const openAIResponse = await backendResponse.json();

        // 将 OpenAI 格式响应转换为 Anthropic 格式
        const anthropicResponse = this.convertOpenAItoAnthropic(openAIResponse as Record<string, unknown>);

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

        const backendUrl = configManager.getBackendUrl();
        const backendApiKey = configManager.getBackendApiKey();

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
          res.status(backendResponse.status).json({ error: errorText });
          return;
        }

        const response = await backendResponse.json();
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