import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import {
  connectDatabase,
  disconnectDatabase,
  isConnected,
  pingDatabase,
  getConnectionState,
  DatabaseStatus,
} from '../config/database';

describe('MongoDB Connection & Health Ping Test Suite', () => {
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    const connected = await connectDatabase(uri);
    expect(connected).toBe(true);
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it('connects to valid MongoDB instance successfully', () => {
    expect(isConnected()).toBe(true);
    expect(getConnectionState()).toBe(DatabaseStatus.CONNECTED);
  });

  it('pingDatabase() returns ok: true and latency measurement', async () => {
    const ping = await pingDatabase();
    expect(ping.ok).toBe(true);
    expect(typeof ping.latencyMs).toBe('number');
    expect(ping.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('GET /api/health/db returns 200 and healthy response when connected', async () => {
    const res = await request(app).get('/api/health/db');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe(DatabaseStatus.CONNECTED);
    expect(res.body.data).toHaveProperty('latencyMs');
  });

  it('GET /api/health reflects healthy database status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('healthy');
    expect(res.body.data.database.status).toBe(DatabaseStatus.CONNECTED);
  });
});
