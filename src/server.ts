import express, { Request, Response, NextFunction } from 'express';
import { configManager } from './config';
import { logger, generateRequestId, truncate } from './logger';
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
      const reqId = generateRequestId();
      const startTime = Date.now();

      try {
        const request = req.body as AnthropicRequest;

        // ═══════════════════════════════════════════════════
        // 📥 STEP 1: 客户端原始请求
        // ═══════════════════════════════════════════════════
        logger.info({
          reqId,
          step: '1_INCOMING_REQUEST',
          endpoint: '/v1/messages',
          method: req.method,
          url: req.originalUrl,
          clientIp: req.ip || req.socket.remoteAddress,
          headers: {
            'content-type': req.headers['content-type'],
            'user-agent': req.headers['user-agent'],
            'x-api-key': req.headers['x-api-key'] ? maskApiKey(req.headers['x-api-key'] as string) : 'none',
            'authorization': req.headers.authorization ? maskApiKey(req.headers.authorization as string) : 'none',
            'anthropic-version': req.headers['anthropic-version'],
            'accept': req.headers.accept
          },
          body: {
            model: request.model,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: request.stream,
            system: truncate(request.system, 500),
            tools_count: request.tools?.length || 0,
            tools_names: request.tools?.map(t => t.name) || [],
            messages_count: request.messages?.length || 0,
            messages: request.messages?.map((m, i) => ({
              index: i,
              role: m.role,
              content_type: typeof m.content,
              content_preview: truncate(
                typeof m.content === 'string'
                  ? m.content
                  : JSON.stringify(m.content),
                500
              ),
              content_blocks: Array.isArray(m.content)
                ? (m.content as AnthropicContentBlock[]).map(b => ({ type: b.type }))
                : undefined
            }))
          }
        }, `[${reqId}] 📥 收到 Anthropic 请求`);

        // ═══════════════════════════════════════════════════
        // 🔄 STEP 2: 格式转换 Anthropic → OpenAI
        // ═══════════════════════════════════════════════════
        const openAIRequest = this.convertAnthropicToOpenAI(request);

        logger.info({
          reqId,
          step: '2_CONVERTED_REQUEST',
          converted: {
            model: openAIRequest.model,
            stream: openAIRequest.stream,
            temperature: openAIRequest.temperature,
            max_tokens: openAIRequest.max_tokens,
            messages_count: (openAIRequest.messages as unknown[])?.length || 0,
            messages: (openAIRequest.messages as Array<Record<string, unknown>>)?.map((m, i) => ({
              index: i,
              role: m.role,
              content_preview: truncate(m.content, 500),
              has_tool_calls: !!(m.tool_calls),
              tool_call_id: m.tool_call_id || undefined
            })),
            tools_count: (openAIRequest.tools as unknown[])?.length || 0
          }
        }, `[${reqId}] 🔄 Anthropic → OpenAI 转换完成`);

        const backendUrl = configManager.getBackendUrl();
        const backendApiKey = configManager.getBackendApiKey();
        const targetUrl = `${backendUrl}/v1/chat/completions`;

        // 流式请求处理
        if (request.stream) {
          const retryConfig = configManager.getRetryConfig();

          // ═══════════════════════════════════════════════════
          // 📤 STEP 3: 发送流式请求到后端
          // ═══════════════════════════════════════════════════
          logger.info({
            reqId,
            step: '3_OUTGOING_STREAM_REQUEST',
            targetUrl,
            headers: {
              'content-type': 'application/json',
              'authorization': `Bearer ${maskApiKey(backendApiKey)}`
            },
            body: truncate(openAIRequest, 3000)
          }, `[${reqId}] 📤 发送流式请求 → ${targetUrl}`);

          // Set SSE headers
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });

          let chunkCount = 0;
          let totalContentLength = 0;

          try {
            await withRetry(
              () => streamingHandler.proxyStream(
                targetUrl,
                { ...openAIRequest, stream: true },
                { format: 'sse', retryInterval: 1000 },
                (chunk) => {
                  chunkCount++;
                  totalContentLength += chunk.length;
                  // 只记录前 5 个 chunk 和每 50 个 chunk
                  if (chunkCount <= 5 || chunkCount % 50 === 0) {
                    logger.debug({
                      reqId,
                      step: '4_STREAM_CHUNK',
                      chunkIndex: chunkCount,
                      chunkSize: chunk.length,
                      chunkPreview: truncate(chunk, 200)
                    }, `[${reqId}] 📦 流式 chunk #${chunkCount}`);
                  }
                  res.write(chunk);
                  return Promise.resolve();
                },
                backendApiKey
              ),
              retryConfig
            );

            // ═══════════════════════════════════════════════════
            // ✅ STEP 5: 流式传输完成
            // ═══════════════════════════════════════════════════
            const duration = Date.now() - startTime;
            logger.info({
              reqId,
              step: '5_STREAM_COMPLETE',
              totalChunks: chunkCount,
              totalContentLength,
              durationMs: duration
            }, `[${reqId}] ✅ 流式传输完成 (${chunkCount} chunks, ${duration}ms)`);

          } catch (streamError) {
            const duration = Date.now() - startTime;
            logger.error({
              reqId,
              step: '5_STREAM_ERROR',
              error: streamError instanceof Error ? streamError.message : String(streamError),
              stack: streamError instanceof Error ? streamError.stack : undefined,
              chunksBeforeError: chunkCount,
              durationMs: duration
            }, `[${reqId}] ❌ 流式传输出错`);

            res.write(`data: ${JSON.stringify({ error: { type: 'stream_error', message: streamError instanceof Error ? streamError.message : 'Stream error' } })}\n\n`);
          }

          res.end();
          return;
        }

        // ═══════════════════════════════════════════════════
        // 📤 STEP 3: 发送非流式请求到后端
        // ═══════════════════════════════════════════════════
        logger.info({
          reqId,
          step: '3_OUTGOING_REQUEST',
          targetUrl,
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${maskApiKey(backendApiKey)}`
          },
          body: truncate(openAIRequest, 3000)
        }, `[${reqId}] 📤 发送非流式请求 → ${targetUrl}`);

        const backendResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${backendApiKey}`
          },
          body: JSON.stringify(openAIRequest)
        });

        if (!backendResponse.ok) {
          const errorText = await backendResponse.text();
          const duration = Date.now() - startTime;

          // ═══════════════════════════════════════════════════
          // ❌ STEP 4: 后端返回错误
          // ═══════════════════════════════════════════════════
          logger.error({
            reqId,
            step: '4_BACKEND_ERROR',
            status: backendResponse.status,
            statusText: backendResponse.statusText,
            responseHeaders: Object.fromEntries(backendResponse.headers.entries()),
            body: truncate(errorText, 2000),
            durationMs: duration
          }, `[${reqId}] ❌ 后端返回 ${backendResponse.status} 错误`);

          res.status(backendResponse.status).json({
            error: {
              type: 'api_error',
              message: errorText
            }
          });
          return;
        }

        const openAIResponse = await backendResponse.json();

        // ═══════════════════════════════════════════════════
        // 📩 STEP 4: 后端原始响应 (OpenAI 格式)
        // ═══════════════════════════════════════════════════
        logger.info({
          reqId,
          step: '4_BACKEND_RESPONSE',
          status: backendResponse.status,
          responseHeaders: Object.fromEntries(backendResponse.headers.entries()),
          body: truncate(openAIResponse, 3000)
        }, `[${reqId}] 📩 收到后端响应 (OpenAI 格式)`);

        // 将 OpenAI 格式响应转换为 Anthropic 格式
        const anthropicResponse = this.convertOpenAItoAnthropic(openAIResponse as Record<string, unknown>);

        const duration = Date.now() - startTime;

        // ═══════════════════════════════════════════════════
        // ✅ STEP 5: 转换后的 Anthropic 响应 → 客户端
        // ═══════════════════════════════════════════════════
        logger.info({
          reqId,
          step: '5_OUTGOING_RESPONSE',
          body: truncate(anthropicResponse, 3000),
          usage: anthropicResponse.usage,
          model: anthropicResponse.model,
          stopReason: anthropicResponse.stop_reason,
          contentBlocks: anthropicResponse.content?.map(b => ({ type: b.type, textLen: b.text?.length })),
          durationMs: duration
        }, `[${reqId}] ✅ 返回 Anthropic 响应给客户端 (${duration}ms)`);

        res.json(anthropicResponse);
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error({
          reqId,
          step: 'ERROR',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          durationMs: duration
        }, `[${reqId}] 💥 /v1/messages 处理异常`);

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
      const reqId = generateRequestId();
      const startTime = Date.now();

      try {
        const request = req.body;

        // ═══════════════════════════════════════════════════
        // 📥 STEP 1: 客户端原始请求 (OpenAI 格式直通)
        // ═══════════════════════════════════════════════════
        logger.info({
          reqId,
          step: '1_INCOMING_REQUEST',
          endpoint: '/v1/chat/completions',
          method: req.method,
          url: req.originalUrl,
          clientIp: req.ip || req.socket.remoteAddress,
          headers: {
            'content-type': req.headers['content-type'],
            'user-agent': req.headers['user-agent'],
            'authorization': req.headers.authorization ? maskApiKey(req.headers.authorization as string) : 'none',
            'accept': req.headers.accept
          },
          body: {
            model: request.model,
            stream: request.stream,
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            messages_count: request.messages?.length || 0,
            messages: request.messages?.map((m: Record<string, unknown>, i: number) => ({
              index: i,
              role: m.role,
              content_preview: truncate(m.content, 500),
              has_tool_calls: !!(m.tool_calls),
              tool_call_id: m.tool_call_id || undefined
            })),
            tools_count: request.tools?.length || 0
          }
        }, `[${reqId}] 📥 收到 OpenAI 直通请求`);

        const backendUrl = configManager.getBackendUrl();
        const backendApiKey = configManager.getBackendApiKey();
        const targetUrl = `${backendUrl}/v1/chat/completions`;

        // ═══════════════════════════════════════════════════
        // 📤 STEP 2: 转发请求到后端 (无需转换)
        // ═══════════════════════════════════════════════════
        logger.info({
          reqId,
          step: '2_OUTGOING_REQUEST',
          targetUrl,
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${maskApiKey(backendApiKey)}`
          },
          body: truncate(request, 3000)
        }, `[${reqId}] 📤 转发请求 → ${targetUrl}`);

        const backendResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${backendApiKey}`
          },
          body: JSON.stringify(request)
        });

        if (!backendResponse.ok) {
          const errorText = await backendResponse.text();
          const duration = Date.now() - startTime;

          logger.error({
            reqId,
            step: '3_BACKEND_ERROR',
            status: backendResponse.status,
            statusText: backendResponse.statusText,
            responseHeaders: Object.fromEntries(backendResponse.headers.entries()),
            body: truncate(errorText, 2000),
            durationMs: duration
          }, `[${reqId}] ❌ 后端返回 ${backendResponse.status} 错误`);

          res.status(backendResponse.status).json({ error: errorText });
          return;
        }

        const response = await backendResponse.json();
        const duration = Date.now() - startTime;

        // ═══════════════════════════════════════════════════
        // ✅ STEP 3: 后端响应 → 客户端
        // ═══════════════════════════════════════════════════
        logger.info({
          reqId,
          step: '3_BACKEND_RESPONSE',
          status: backendResponse.status,
          body: truncate(response, 3000),
          durationMs: duration
        }, `[${reqId}] ✅ 返回后端响应给客户端 (${duration}ms)`);

        res.json(response);
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error({
          reqId,
          step: 'ERROR',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          durationMs: duration
        }, `[${reqId}] 💥 /v1/chat/completions 处理异常`);

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