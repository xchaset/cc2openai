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

  convertToSSE(chunk: unknown): string {
    const openAIChunk = chunk as OpenAIChunk;
    const choices = openAIChunk.choices || [];
    const firstChoice = choices[0];
    const finishReason = firstChoice?.finish_reason;

    if (finishReason === 'stop' || finishReason === 'length') {
      return 'data: [DONE]\n\n';
    }

    return `data: ${JSON.stringify(openAIChunk)}\n\n`;
  }

  convertAnthropicToSSE(chunk: unknown): string {
    const anthropicChunk = chunk as AnthropicChunk;

    if (anthropicChunk.type === 'message_stop') {
      return 'data: [DONE]\n\n';
    }

    return `data: ${JSON.stringify(anthropicChunk)}\n\n`;
  }

  async proxyStream(
    backendUrl: string,
    request: unknown,
    config: StreamingConfig,
    onChunk: (chunk: string) => Promise<void>,
    apiKey?: string
  ): Promise<void> {
    this.format = config.format;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers,
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

}

export const streamingHandler = new StreamingHandler();