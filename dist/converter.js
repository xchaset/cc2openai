"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.converter = exports.Converter = void 0;
class Converter {
    constructor() {
        this.toolMappings = new Map();
        // Initialize default mappings - can be extended to load from config
    }
    /**
     * Add a tool mapping for MCP tool name to OpenAPI operation
     */
    addToolMapping(mapping) {
        this.toolMappings.set(mapping.mcpToolName, mapping);
    }
    /**
     * Convert MCP tool call to OpenAPI request
     */
    convertToolCallToOpenAPI(toolCall) {
        const mapping = this.toolMappings.get(toolCall.name);
        if (!mapping) {
            return {
                success: false,
                error: `No mapping found for tool: ${toolCall.name}`
            };
        }
        // Map parameters according to mapping config
        const parameters = {};
        if (mapping.parameterMapping) {
            for (const [mcpParam, openApiParam] of Object.entries(mapping.parameterMapping)) {
                if (toolCall.input[mcpParam] !== undefined) {
                    parameters[openApiParam] = toolCall.input[mcpParam];
                }
            }
        }
        else {
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
    convertRequestToOpenAPI(request) {
        try {
            const converted = {
                messages: []
            };
            for (const msg of request.messages) {
                const convertedMsg = {
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
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    /**
     * Convert OpenAPI response to MCP format
     */
    convertResponseToMCP(openApiResponse, toolCallId) {
        try {
            const message = {
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
            }
            else {
                // Handle regular chat response
                if (typeof openApiResponse === 'object' && openApiResponse !== null) {
                    const response = openApiResponse;
                    if (response.choices && Array.isArray(response.choices)) {
                        const firstChoice = response.choices[0];
                        if (firstChoice.message) {
                            const msg = firstChoice.message;
                            message.content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                        }
                    }
                    else {
                        message.content = JSON.stringify(openApiResponse);
                    }
                }
                else {
                    message.content = String(openApiResponse);
                }
            }
            return { success: true, data: message };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    /**
     * Convert MCP tools to OpenAPI-compatible tool format
     */
    convertToolsToOpenAPITools(mcpTools) {
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
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    /**
     * Convert OpenAPI tools to MCP format
     */
    convertToolsToMCP(openApiTools) {
        try {
            if (!Array.isArray(openApiTools)) {
                return { success: false, error: 'Invalid tools format' };
            }
            const mcpTools = openApiTools.map((tool) => {
                const t = tool;
                if (t.type === 'function' && t.function) {
                    const fn = t.function;
                    return {
                        name: fn.name,
                        description: fn.description || '',
                        input_schema: fn.parameters || {}
                    };
                }
                return null;
            }).filter(Boolean);
            return { success: true, data: mcpTools };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    /**
     * Generate a mock MCP chat response
     */
    generateMCPChatResponse(model, message) {
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
    getOperationPath(operationId) {
        // This should be loaded from OpenAPI spec in production
        return `/api/${operationId}`;
    }
}
exports.Converter = Converter;
// Singleton instance
exports.converter = new Converter();
