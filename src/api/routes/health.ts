import { Router, Request, Response } from 'express';
import { getDb } from '../../db/mongo.js';

export const healthRouter = Router();

healthRouter.get('/', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const adminDb = db.admin();
    const buildInfo = await adminDb.buildInfo();
    const ping = await adminDb.ping();

    return res.status(200).json({
      status: 'ok',
      service: 'PulseMetric Engine',
      mongo: {
        status: ping.ok === 1 ? 'connected' : 'degraded',
        version: buildInfo.version,
        targetMinVersion: '7.0.0'
      },
      system: {
        nodeVersion: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
      },
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return res.status(503).json({
      status: 'error',
      service: 'PulseMetric Engine',
      mongo: {
        status: 'disconnected',
        error: err.message
      },
      timestamp: new Date().toISOString()
    });
  }
});
