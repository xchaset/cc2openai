import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { Config, RetryConfig, MonitoringConfig } from './types';

export class ConfigManager {
  private config: Config | null = null;

  /**
   * Load configuration from YAML file with environment variable overrides
   */
  load(configPath?: string): Config {
    const configDir = process.env.NODE_ENV === 'production'
      ? path.join(process.cwd(), 'config')
      : path.join(__dirname, '../config');
    const filePath = configPath || process.env.CONFIG_PATH || path.join(configDir, 'config.yaml');

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const config = yaml.parse(fileContent) as Config;

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
  get(): Config {
    if (!this.config) {
      return this.load();
    }
    return this.config;
  }

  /**
   * Get the backend URL
   */
  getBackendUrl(): string {
    return this.get().backend.url;
  }

  /**
   * Get the backend API key
   */
  getBackendApiKey(): string {
    return this.get().backend.apiKey;
  }

  /**
   * Get the proxy auth API key
   */
  getAuthApiKey(): string {
    return this.get().auth.apiKey;
  }

  /**
   * Get the server port
   */
  getServerPort(): number {
    return this.get().server.port;
  }

  /**
   * Get the server host
   */
  getServerHost(): string {
    return this.get().server.host;
  }

  /**
   * Get the retry configuration
   */
  getRetryConfig(): RetryConfig {
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
  getMonitoringConfig(): MonitoringConfig {
    const config = this.get();
    return config.monitoring || {
      enabled: true,
      logLevel: 'info',
      metricsEnabled: false,
      backendHealthCheck: true
    };
  }
}

// Singleton instance
export const configManager = new ConfigManager();