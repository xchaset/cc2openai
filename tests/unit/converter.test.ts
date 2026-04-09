import { Converter } from '../../src/converter';
import { MCPChatRequest } from '../../src/types';

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
      expect((result.data as any)[0]).toEqual({
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
      const request: MCPChatRequest = {
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
