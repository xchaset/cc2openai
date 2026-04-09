"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.configManager = exports.ConfigManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("yaml"));
class ConfigManager {
    constructor() {
        this.config = null;
    }
    /**
     * Load configuration from YAML file with environment variable overrides
     */
    load(configPath) {
        const configDir = process.env.NODE_ENV === 'production'
            ? path.join(process.cwd(), 'config')
            : path.join(__dirname, '../config');
        const filePath = configPath || process.env.CONFIG_PATH || path.join(configDir, 'config.yaml');
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const config = yaml.parse(fileContent);
        // Environment variable overrides
        if (process.env.SERVER_PORT) {
            config.server.port = parseInt(process.env.SERVER_PORT, 10);
        }
        if (process.env.SERVER_HOST) {
            config.server.host = process.env.SERVER_HOST;
        }
        if (process.env.BACKEND_URL) {
            config.backend.url = process.env.BACKEND_URL;
        }
        if (process.env.BACKEND_API_KEY) {
            config.backend.apiKey = process.env.BACKEND_API_KEY;
        }
        if (process.env.AUTH_API_KEY) {
            config.auth.apiKey = process.env.AUTH_API_KEY;
        }
        this.config = config;
        return config;
    }
    /**
     * Get the current configuration
     */
    get() {
        if (!this.config) {
            return this.load();
        }
        return this.config;
    }
    /**
     * Get the backend URL
     */
    getBackendUrl() {
        return this.get().backend.url;
    }
    /**
     * Get the backend API key
     */
    getBackendApiKey() {
        return this.get().backend.apiKey;
    }
    /**
     * Get the proxy auth API key
     */
    getAuthApiKey() {
        return this.get().auth.apiKey;
    }
    /**
     * Get the server port
     */
    getServerPort() {
        return this.get().server.port;
    }
    /**
     * Get the server host
     */
    getServerHost() {
        return this.get().server.host;
    }
    /**
     * Get the retry configuration
     */
    getRetryConfig() {
        const config = this.get();
        return config.retry || {
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 10000,
            backoffMultiplier: 2,
            retryableStatusCodes: [502, 503, 504]
        };
    }
    /**
     * Get the monitoring configuration
     */
    getMonitoringConfig() {
        const config = this.get();
        return config.monitoring || {
            enabled: true,
            logLevel: 'info',
            metricsEnabled: false,
            backendHealthCheck: true
        };
    }
}
exports.ConfigManager = ConfigManager;
// Singleton instance
exports.configManager = new ConfigManager();
