"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Server = void 0;
const express_1 = __importDefault(require("express"));
const config_1 = require("./config");
const logger_1 = require("./logger");
const metrics_1 = require("./metrics");
const health_1 = require("./health");
const streaming_1 = require("./streaming");
const retry_1 = require("./retry");
class Server {
    constructor() {
        this.app = (0, express_1.default)();
        this.port = config_1.configManager.getServerPort();
        this.host = config_1.configManager.getServerHost();
        (0, health_1.setServerStartTime)(Date.now());
        this.setupMiddleware();
        this.setupRoutes();
    }
    setupMiddleware() {
        this.app.use(express_1.default.json());
        // Request logging and metrics middleware
        this.app.use((req, res, next) => {
            const start = Date.now();
            res.on('finish', () => {
                const duration = Date.now() - start;
                const success = res.statusCode < 400;
                metrics_1.metrics.recordRequest(req.path, success, duration);
                logger_1.logger.info({
                    req: { method: req.method, url: req.url, status: res.statusCode },
                    res: { duration }
                }, 'request completed');
            });
            next();
        });
        // API Key authentication middleware
        this.app.use((req, res, next) => {
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
            const validKey = config_1.configManager.getAuthApiKey();
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
    convertAnthropicToOpenAI(request) {
        const messages = [];
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
        const openAIRequest = {
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
    convertOpenAItoAnthropic(openAIResponse) {
        const choices = openAIResponse.choices;
        const firstChoice = choices?.[0];
        const message = firstChoice?.message;
        const anthropicResponse = {
            id: openAIResponse.id || `msg_${Date.now()}`,
            type: 'message',
            role: 'assistant',
            content: [],
            model: openAIResponse.model || 'unknown',
            stop_reason: firstChoice?.finish_reason || 'end_turn',
            usage: {
                input_tokens: openAIResponse.usage?.prompt_tokens || 0,
                output_tokens: openAIResponse.usage?.completion_tokens || 0
            }
        };
        // 处理内容
        if (message?.content) {
            const content = message.content;
            anthropicResponse.content.push({
                type: 'text',
                text: content
            });
        }
        // 处理 tool_calls (如果有)
        if (message?.tool_calls && Array.isArray(message.tool_calls)) {
            for (const toolCall of message.tool_calls) {
                anthropicResponse.content.push({
                    type: 'tool_use',
                    id: toolCall.id || `tool_${Date.now()}`,
                    name: toolCall.function?.name,
                    input: toolCall.function?.arguments
                });
            }
        }
        return anthropicResponse;
    }
    setupRoutes() {
        // Health check (no auth required)
        this.app.get('/health', async (_req, res) => {
            const health = (0, health_1.getHealthStatus)();
            health.checks.backend = await (0, health_1.checkBackendHealth)();
            res.json(health);
        });
        // Anthropic Messages API 端点 (接收 Anthropic 格式请求)
        this.app.post('/v1/messages', async (req, res) => {
            try {
                const request = req.body;
                // 将 Anthropic 格式转换为 OpenAI 格式
                const openAIRequest = this.convertAnthropicToOpenAI(request);
                const backendUrl = config_1.configManager.getBackendUrl();
                const backendApiKey = config_1.configManager.getBackendApiKey();
                // 流式请求处理
                if (request.stream) {
                    const retryConfig = config_1.configManager.getRetryConfig();
                    // Set SSE headers
                    res.writeHead(200, {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive'
                    });
                    try {
                        await (0, retry_1.withRetry)(() => streaming_1.streamingHandler.proxyStream(`${backendUrl}/v1/chat/completions`, { ...openAIRequest, stream: true }, { format: 'sse', retryInterval: 1000 }, (chunk) => {
                            res.write(chunk);
                            return Promise.resolve();
                        }), retryConfig);
                    }
                    catch (streamError) {
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
                const anthropicResponse = this.convertOpenAItoAnthropic(openAIResponse);
                res.json(anthropicResponse);
            }
            catch (error) {
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
        this.app.post('/v1/chat/completions', async (req, res) => {
            try {
                const request = req.body;
                const backendUrl = config_1.configManager.getBackendUrl();
                const backendApiKey = config_1.configManager.getBackendApiKey();
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
            }
            catch (error) {
                console.error('Error in chat/completions:', error);
                res.status(500).json({
                    error: error instanceof Error ? error.message : 'Internal server error'
                });
            }
        });
        // Metrics endpoint (if enabled)
        const monitoringConfig = config_1.configManager.getMonitoringConfig();
        if (monitoringConfig.metricsEnabled) {
            this.app.get('/metrics', (_req, res) => {
                res.set('Content-Type', 'text/plain');
                res.send(metrics_1.metrics.getPrometheusMetrics());
            });
        }
    }
    start() {
        this.app.listen(this.port, this.host, () => {
            console.log(`Proxy Server running at http://${this.host}:${this.port}`);
            console.log('Available endpoints:');
            console.log('  POST /v1/messages (Anthropic format)');
            console.log('  POST /v1/chat/completions (OpenAI format)');
        });
    }
}
exports.Server = Server;
