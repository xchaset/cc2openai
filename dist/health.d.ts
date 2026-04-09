interface HealthStatus {
    status: 'ok' | 'degraded' | 'down';
    timestamp: string;
    uptime: number;
    checks: {
        server: 'ok' | 'error';
        backend: 'ok' | 'error' | 'unknown';
    };
    metrics: {
        totalRequests: number;
        failedRequests: number;
    };
}
export declare function setServerStartTime(time: number): void;
export declare function checkBackendHealth(): Promise<'ok' | 'error' | 'unknown'>;
export declare function getHealthStatus(): HealthStatus;
export {};
