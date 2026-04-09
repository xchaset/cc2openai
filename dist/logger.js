"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.logRequest = logRequest;
exports.logError = logError;
const pino_1 = __importDefault(require("pino"));
const isDevelopment = process.env.NODE_ENV !== 'production';
exports.logger = (0, pino_1.default)({
    level: process.env.LOG_LEVEL || 'info',
    transport: isDevelopment
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined
});
// Request logging helper
function logRequest(req, res, duration) {
    exports.logger.info({
        req: { method: req.method, url: req.url },
        res: { statusCode: res.statusCode, duration }
    }, 'request completed');
}
// Error logging helper
function logError(error, context) {
    exports.logger.error({ error: error.message, stack: error.stack, ...context }, 'error occurred');
}
