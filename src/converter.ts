import {
  MCPToolCall,
  MCPChatMessage,
  MCPChatRequest,
  MCPChatResponse,
  ConversionResult,
  ToolMapping
} from './types';
import { configManager } from './config';

export class Converter {
  private toolMappings: Map<string, ToolMapping> = new Map();

  constructor() {
    // Initialize default mappings - can be extended to load from config
  }

  /**
   * Add a tool mapping for MCP tool name to OpenAPI operation
   */
  addToolMapping(mapping: ToolMapping): void {
    this.toolMappings.set(mapping.mcpToolName, mapping);
  }

  /**
   * Convert MCP tool call to OpenAPI request
   */
  convertToolCallToOpenAPI(toolCall: MCPToolCall): ConversionResult<{
    operationId: string;
    parameters: Record<string, unknown>;
    path: string;
    method: string;
  }> {
    const mapping = this.toolMappings.get(toolCall.name);

    if (!mapping) {
      return {
        success: false,
        error: `No mapping found for tool: ${toolCall.name}`
      };
    }

    // Map parameters according to mapping config
    const parameters: Record<string, unknown> = {};
    if (mapping.parameterMapping) {
      for (const [mcpParam, openApiParam] of Object.entries(mapping.parameterMapping)) {
        if (toolCall.input[mcpParam] !== undefined) {
          parameters[openApiParam] = toolCall.input[mcpParam];
        }
      }
    } else {
      // Default: pass through all parameters
      Object.assign(parameters, toolCall.input);
    }

    return {
      success: true,
      data: {
        operationId: mapping.openApiOperationId,
        parameters,
        path: this.getOperationPath(mapping.openApiOperationId),
        method: 'POST'
      }
    };
  }

  /**
   * Convert MCP chat request to OpenAPI format
   */
  convertRequestToOpenAPI(request: MCPChatRequest): ConversionResult<{
    messages: Array<{ role: string; content: string }>;
    toolCalls?: Array<{ operationId: string; parameters: Record<string, unknown> }>;
  }> {
    try {
      const converted: {
        messages: Array<{ role: string; content: string }>;
        toolCalls?: Array<{ operationId: string; parameters: Record<string, unknown> }>;
      } = {
        messages: []
      };

      for (const msg of request.messages) {
        const convertedMsg: { role: string; content: string } = {
          role: msg.role,
          content: msg.content
        };
        converted.messages.push(convertedMsg);

        // Convert tool calls
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          converted.toolCalls = [];
          for (const toolCall of msg.tool_calls) {
            const result = this.convertToolCallToOpenAPI(toolCall);
            if (result.success && result.data) {
              converted.toolCalls.push({
                operationId: result.data.operationId,
                parameters: result.data.parameters
              });
            }
          }
        }
      }

      return { success: true, data: converted };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Convert OpenAPI response to MCP format
   */
  convertResponseToMCP(openApiResponse: unknown, toolCallId?: string): ConversionResult<MCPChatMessage> {
    try {
      const message: MCPChatMessage = {
        role: 'assistant',
        content: ''
      };

      // Handle tool result
      if (toolCallId) {
        message.role = 'tool';
        message.tool_call_id = toolCallId;
        message.content = typeof openApiResponse === 'string'
          ? openApiResponse
          : JSON.stringify(openApiResponse);
      } else {
        // Handle regular chat response
        if (typeof openApiResponse === 'object' && openApiResponse !== null) {
          const response = openApiResponse as Record<string, unknown>;
          if (response.choices && Array.isArray(response.choices)) {
            const firstChoice = response.choices[0] as Record<string, unknown>;
            if (firstChoice.message) {
              const msg = firstChoice.message as Record<string, unknown>;
              message.content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            }
          } else {
            message.content = JSON.stringify(openApiResponse);
          }
        } else {
          message.content = String(openApiResponse);
        }
      }

      return { success: true, data: message };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Convert MCP tools to OpenAPI-compatible tool format
   */
  convertToolsToOpenAPITools(mcpTools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>): ConversionResult<unknown> {
    try {
      const openApiTools = mcpTools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema
        }
      }));

      return { success: true, data: openApiTools };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Convert OpenAPI tools to MCP format
   */
  convertToolsToMCP(openApiTools: unknown): ConversionResult<Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>> {
    try {
      if (!Array.isArray(openApiTools)) {
        return { success: false, error: 'Invalid tools format' };
      }

      const mcpTools = openApiTools.map((tool: unknown) => {
        const t = tool as Record<string, unknown>;
        if (t.type === 'function' && t.function) {
          const fn = t.function as Record<string, unknown>;
          return {
            name: fn.name as string,
            description: (fn.description as string) || '',
            input_schema: (fn.parameters as Record<string, unknown>) || {}
          };
        }
        return null;
      }).filter(Boolean);

      return { success: true, data: mcpTools as Array<{ name: string; description: string; input_schema: Record<string, unknown> }> };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Generate a mock MCP chat response
   */
  generateMCPChatResponse(model: string, message: MCPChatMessage): MCPChatResponse {
    return {
      id: `chat-${Date.now()}`,
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };
  }

  /**
   * Get operation path from operation ID (placeholder - should be loaded from OpenAPI spec)
   */
  private getOperationPath(operationId: string): string {
    // This should be loaded from OpenAPI spec in production
    return `/api/${operationId}`;
  }
}

// Singleton instance
export const converter = new Converter();