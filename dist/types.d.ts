export interface MCPTool {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
}
export interface MCPToolCall {
    id: string;
    name: string;
    input: Record<string, unknown>;
}
export interface MCPChatMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    tool_calls?: MCPToolCall[];
    tool_call_id?: string;
}
export interface MCPChatRequest {
    model: string;
    messages: MCPChatMessage[];
    temperature?: number;
    max_tokens?: number;
    tools?: MCPTool[];
}
export interface MCPChatResponse {
    id: string;
    model: string;
    choices: {
        index: number;
        message: MCPChatMessage;
        finish_reason: string;
    }[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
export interface OpenAPIOperation {
    operationId: string;
    summary?: string;
    parameters?: OpenAPIParameter[];
    requestBody?: OpenAPIRequestBody;
}
export interface OpenAPIParameter {
    name: string;
    in: 'query' | 'header' | 'path';
    required?: boolean;
    schema: OpenAPISchema;
}
export interface OpenAPIRequestBody {
    required?: boolean;
    content: {
        'application/json'?: {
            schema: OpenAPISchema;
        };
    };
}
export interface OpenAPISchema {
    type: string;
    properties?: Record<string, OpenAPISchema>;
    items?: OpenAPISchema;
    enum?: unknown[];
    format?: string;
}
export interface Config {
    server: {
        port: number;
        host: string;
    };
    backend: {
        url: string;
        apiKey: string;
        openApiSpecPath?: string;
    };
    auth: {
        apiKey: string;
    };
    retry?: RetryConfig;
    monitoring?: MonitoringConfig;
}
export interface MonitoringConfig {
    enabled: boolean;
    logLevel: string;
    metricsEnabled: boolean;
    backendHealthCheck: boolean;
}
export interface ToolMapping {
    mcpToolName: string;
    openApiOperationId: string;
    parameterMapping?: Record<string, string>;
}
export interface ConversionResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}
export interface StreamingConfig {
    format: 'sse' | 'data';
    retryInterval: number;
}
export interface RetryConfig {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
    retryableStatusCodes: number[];
}
