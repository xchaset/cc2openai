"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setServerStartTime = setServerStartTime;
exports.checkBackendHealth = checkBackendHealth;
exports.getHealthStatus = getHealthStatus;
const config_1 = require("./config");
const metrics_1 = require("./metrics");
let serverStartTime = Date.now();
function setServerStartTime(time) {
    serverStartTime = time;
}
async function checkBackendHealth() {
    try {
        const backendUrl = config_1.configManager.getBackendUrl();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${backendUrl}/health`, {
            method: 'GET',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response.ok ? 'ok' : 'error';
    }
    catch {
        return 'unknown';
    }
}
function getHealthStatus() {
    const m = metrics_1.metrics.getMetrics();
    const failedRatio = m.totalRequests > 0 ? m.failedRequests / m.totalRequests : 0;
    let status = 'ok';
    if (failedRatio > 0.5 || m.failedRequests > 10) {
        status = 'down';
    }
    else if (failedRatio > 0.1 || m.failedRequests > 0) {
        status = 'degraded';
    }
    return {
        status,
        timestamp: new Date().toISOString(),
        uptime: Date.now() - serverStartTime,
        checks: {
            server: 'ok',
            backend: 'unknown'
        },
        metrics: {
            totalRequests: m.totalRequests,
            failedRequests: m.failedRequests
        }
    };
}
