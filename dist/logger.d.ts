import pino from 'pino';
export declare const logger: pino.Logger<never, boolean>;
export declare function logRequest(req: {
    method: string;
    url: string;
}, res: {
    statusCode: number;
}, duration: number): void;
export declare function logError(error: Error, context?: Record<string, unknown>): void;
