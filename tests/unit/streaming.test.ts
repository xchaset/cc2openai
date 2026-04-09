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
});