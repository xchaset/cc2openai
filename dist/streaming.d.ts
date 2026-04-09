import { StreamingConfig } from './types';
export declare class StreamingHandler {
    private format;
    constructor(format?: 'sse' | 'data');
    convertToSSE(chunk: unknown): string;
    convertAnthropicToSSE(chunk: unknown): string;
    proxyStream(backendUrl: string, request: unknown, config: StreamingConfig, onChunk: (chunk: string) => Promise<void>): Promise<void>;
    private escapeSSEContent;
}
export declare const streamingHandler: StreamingHandler;
