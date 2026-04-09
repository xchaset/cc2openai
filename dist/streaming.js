"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamingHandler = exports.StreamingHandler = void 0;
class StreamingHandler {
    constructor(format = 'sse') {
        this.format = format;
    }
    convertToSSE(chunk) {
        const openAIChunk = chunk;
        const choices = openAIChunk.choices || [];
        const firstChoice = choices[0];
        const finishReason = firstChoice?.finish_reason;
        if (finishReason === 'stop' || finishReason === 'length') {
            return 'data: [DONE]\n\n';
        }
        const content = firstChoice?.delta?.content || '';
        if (this.format === 'sse') {
            return `data: ${JSON.stringify(openAIChunk)}\n\n`;
        }
        else {
            return `${JSON.stringify(openAIChunk)}\n[DONE]\n`;
        }
    }
    convertAnthropicToSSE(chunk) {
        const anthropicChunk = chunk;
        if (anthropicChunk.type === 'message_stop') {
            return 'data: [DONE]\n\n';
        }
        const text = anthropicChunk.delta?.text || '';
        if (this.format === 'sse') {
            return `data: ${JSON.stringify(anthropicChunk)}\n\n`;
        }
        else {
            return `${JSON.stringify(anthropicChunk)}\n[DONE]\n`;
        }
    }
    async proxyStream(backendUrl, request, config, onChunk) {
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
                        }
                        catch {
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
                        }
                        catch {
                            // Skip invalid JSON
                        }
                    }
                }
            }
        }
        finally {
            reader.releaseLock();
        }
    }
    escapeSSEContent(content) {
        return content
            .replace(/\\/g, '\\\\')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
    }
}
exports.StreamingHandler = StreamingHandler;
exports.streamingHandler = new StreamingHandler();
