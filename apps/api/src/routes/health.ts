import { Router, Request, Response } from 'express';
import { sendSuccess } from '../utils/api-response';
import { getConnectionState, pingDatabase, DatabaseStatus } from '../config/database';
import { env } from '../config/env';

export const healthRouter = Router();

healthRouter.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

healthRouter.get('/api/health', (req: Request, res: Response) => {
  const dbStatus = getConnectionState();
  const memoryUsage = process.memoryUsage();

  sendSuccess(res, {
    status: dbStatus === DatabaseStatus.CONNECTED ? 'healthy' : 'degraded',
    version: '1.0.0',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      status: dbStatus,
    },
    system: {
      heapUsedMb: Math.round((memoryUsage.heapUsed / 1024 / 1024) * 100) / 100,
      rssMb: Math.round((memoryUsage.rss / 1024 / 1024) * 100) / 100,
    },
  });
});

healthRouter.get('/api/health/db', async (req: Request, res: Response) => {
  const pingResult = await pingDatabase();
  const dbStatus = getConnectionState();

  if (pingResult.ok) {
    sendSuccess(res, {
      database: 'MongoDB',
      status: dbStatus,
      latencyMs: pingResult.latencyMs,
      message: 'MongoDB is responsive and accepting queries',
    });
  } else {
    res.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: pingResult.error || 'Database connection is not currently active',
        status: dbStatus,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  }
});
