import request from 'supertest';
import { Server } from '../../src/server';

describe('Server Integration Tests', () => {
  let server: Server;
  let app: any;

  beforeAll(() => {
    server = new Server();
    // Get the express app
    app = (server as any).app;
  });

  describe('GET /health', () => {
    it('should return ok status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.checks).toBeDefined();
      expect(response.body.metrics).toBeDefined();
    });
  });

  describe('POST /v1/messages', () => {
    it('should return 401 without auth', async () => {
      const response = await request(app)
        .post('/v1/messages')
        .send({ model: 'claude-3', messages: [{ role: 'user', content: 'Hello' }] });

      expect(response.status).toBe(401);
    });

    it('should return 403 with invalid API key', async () => {
      const response = await request(app)
        .post('/v1/messages')
        .set('Authorization', 'Bearer invalid_key')
        .send({ model: 'claude-3', messages: [{ role: 'user', content: 'Hello' }] });

      expect(response.status).toBe(403);
    });
  });

  describe('POST /v1/chat/completions', () => {
    it('should return 401 without auth', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .send({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }] });

      expect(response.status).toBe(401);
    });
  });
});
