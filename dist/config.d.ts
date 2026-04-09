import { Config, RetryConfig, MonitoringConfig } from './types';
export declare class ConfigManager {
    private config;
    /**
     * Load configuration from YAML file with environment variable overrides
     */
    load(configPath?: string): Config;
    /**
     * Get the current configuration
     */
    get(): Config;
    /**
     * Get the backend URL
     */
    getBackendUrl(): string;
    /**
     * Get the backend API key
     */
    getBackendApiKey(): string;
    /**
     * Get the proxy auth API key
     */
    getAuthApiKey(): string;
    /**
     * Get the server port
     */
    getServerPort(): number;
    /**
     * Get the server host
     */
    getServerHost(): string;
    /**
     * Get the retry configuration
     */
    getRetryConfig(): RetryConfig;
    /**
     * Get the monitoring configuration
     */
    getMonitoringConfig(): MonitoringConfig;
}
export declare const configManager: ConfigManager;
