import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app';

describe('Finora API Foundation & Health Endpoints', () => {
  it('GET /health returns 200 and ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('GET /api/health returns standardized ApiResponse structure', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('version', '1.0.0');
    expect(res.body.data).toHaveProperty('uptimeSeconds');
    expect(res.body.data).toHaveProperty('database');
    expect(res.body.meta).toHaveProperty('timestamp');
  });

  it('GET /api/health/db handles disconnected state safely without crashing', async () => {
    const res = await request(app).get('/api/health/db');
    // If not connected to MongoDB, returns 503 with standardized error
    if (res.status === 503) {
      expect(res.body.success).toBe(false);
      expect(res.body.error).toHaveProperty('code', 'DATABASE_UNAVAILABLE');
    } else {
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('latencyMs');
    }
  });

  it('GET /unknown-route returns standardized 404 error', async () => {
    const res = await request(app).get('/api/non-existent-endpoint-xyz');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toHaveProperty('code', 'NOT_FOUND');
    expect(res.body.meta).toHaveProperty('timestamp');
  });
});
