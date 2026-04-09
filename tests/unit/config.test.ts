import { configManager } from '../../src/config';

describe('ConfigManager', () => {
  beforeEach(() => {
    // Reset config
    (configManager as any).config = null;
  });

  describe('load', () => {
    it('should load config from yaml file', () => {
      const config = configManager.load();

      expect(config.server).toBeDefined();
      expect(config.server.port).toBe(3000);
      expect(config.server.host).toBe('0.0.0.0');
    });

    it('should override with environment variables', () => {
      process.env.SERVER_PORT = '4000';
      process.env.BACKEND_URL = 'http://test:9000';

      const config = configManager.load();

      expect(config.server.port).toBe(4000);
      expect(config.backend.url).toBe('http://test:9000');

      // Clean up
      delete process.env.SERVER_PORT;
      delete process.env.BACKEND_URL;
    });
  });

  describe('getBackendUrl', () => {
    it('should return backend URL', () => {
      const url = configManager.getBackendUrl();
      expect(url).toBe('http://localhost:8080');
    });
  });

  describe('getBackendApiKey', () => {
    it('should return backend API key', () => {
      const apiKey = configManager.getBackendApiKey();
      expect(apiKey).toBeDefined();
    });
  });

  describe('getAuthApiKey', () => {
    it('should return auth API key', () => {
      const apiKey = configManager.getAuthApiKey();
      expect(apiKey).toBeDefined();
    });
  });

  describe('getServerPort', () => {
    it('should return server port', () => {
      const port = configManager.getServerPort();
      expect(port).toBe(3000);
    });
  });

  describe('getRetryConfig', () => {
    it('should return default retry config', () => {
      const config = configManager.getRetryConfig();

      expect(config.maxRetries).toBe(3);
      expect(config.baseDelay).toBe(1000);
      expect(config.maxDelay).toBe(10000);
      expect(config.backoffMultiplier).toBe(2);
      expect(config.retryableStatusCodes).toEqual([502, 503, 504]);
    });
  });
});