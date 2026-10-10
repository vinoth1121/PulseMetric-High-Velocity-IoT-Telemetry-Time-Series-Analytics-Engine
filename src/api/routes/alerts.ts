import { Router, Request, Response } from 'express';
import { getCollections } from '../../db/mongo.js';
import { alertEvents } from '../../jobs/anomaly-runner.js';

export const alertsRouter = Router();

alertsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { alerts } = await getCollections();
    const limit = Math.min(100, parseInt(String(req.query.limit || '50'), 10));
    const deviceId = req.query.deviceId ? String(req.query.deviceId) : null;

    const filter: Record<string, any> = {};
    if (deviceId) {
      filter.deviceId = deviceId;
    }

    const items = await alerts.find(filter).sort({ ts: -1 }).limit(limit).toArray();
    return res.status(200).json(items);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch alerts', message: err.message });
  }
});

alertsRouter.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial connected event
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: new Date().toISOString() })}\n\n`);

  const onAlert = (alertData: any) => {
    res.write(`data: ${JSON.stringify({ type: 'alert', alert: alertData })}\n\n`);
  };

  alertEvents.on('alert', onAlert);

  // Send periodic heartbeat every 15s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    alertEvents.off('alert', onAlert);
  });
});
