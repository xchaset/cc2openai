export declare class Server {
    private app;
    private port;
    private host;
    constructor();
    private setupMiddleware;
    /**
     * 将 Anthropic 请求转换为 OpenAI 格式
     */
    private convertAnthropicToOpenAI;
    /**
     * 将 OpenAI 响应转换为 Anthropic 格式
     */
    private convertOpenAItoAnthropic;
    private setupRoutes;
    start(): void;
}
