declare class RequestMetrics {
    private metrics;
    recordRequest(endpoint: string, success: boolean, responseTime: number): void;
    getMetrics(): {
        totalRequests: number;
        successfulRequests: number;
        failedRequests: number;
        averageResponseTime: number;
        requestsByEndpoint: {
            [x: string]: number;
        };
    };
    getPrometheusMetrics(): string;
    reset(): void;
}
export declare const metrics: RequestMetrics;
export {};
