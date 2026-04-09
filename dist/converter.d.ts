import { MCPToolCall, MCPChatMessage, MCPChatRequest, MCPChatResponse, ConversionResult, ToolMapping } from './types';
export declare class Converter {
    private toolMappings;
    constructor();
    /**
     * Add a tool mapping for MCP tool name to OpenAPI operation
     */
    addToolMapping(mapping: ToolMapping): void;
    /**
     * Convert MCP tool call to OpenAPI request
     */
    convertToolCallToOpenAPI(toolCall: MCPToolCall): ConversionResult<{
        operationId: string;
        parameters: Record<string, unknown>;
        path: string;
        method: string;
    }>;
    /**
     * Convert MCP chat request to OpenAPI format
     */
    convertRequestToOpenAPI(request: MCPChatRequest): ConversionResult<{
        messages: Array<{
            role: string;
            content: string;
        }>;
        toolCalls?: Array<{
            operationId: string;
            parameters: Record<string, unknown>;
        }>;
    }>;
    /**
     * Convert OpenAPI response to MCP format
     */
    convertResponseToMCP(openApiResponse: unknown, toolCallId?: string): ConversionResult<MCPChatMessage>;
    /**
     * Convert MCP tools to OpenAPI-compatible tool format
     */
    convertToolsToOpenAPITools(mcpTools: Array<{
        name: string;
        description: string;
        input_schema: Record<string, unknown>;
    }>): ConversionResult<unknown>;
    /**
     * Convert OpenAPI tools to MCP format
     */
    convertToolsToMCP(openApiTools: unknown): ConversionResult<Array<{
        name: string;
        description: string;
        input_schema: Record<string, unknown>;
    }>>;
    /**
     * Generate a mock MCP chat response
     */
    generateMCPChatResponse(model: string, message: MCPChatMessage): MCPChatResponse;
    /**
     * Get operation path from operation ID (placeholder - should be loaded from OpenAPI spec)
     */
    private getOperationPath;
}
export declare const converter: Converter;
