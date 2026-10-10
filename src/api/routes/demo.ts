import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getCollections } from '../../db/mongo.js';
import { CanonicalReading } from '../../adapters/types.js';
import { laneStats } from './ingest.js';

export const demoRouter = Router();

// In-memory rate limiting map (IP -> timestamp)
const rateLimitMap = new Map<string, number>();

const ALLOWED_DEMO_DEVICES = new Set([
  'demo-ship-alpha',
  'demo-reconnect-001',
  'demo-reconnect-002'
]);

const outageSchema = z.object({
  deviceId: z.string().optional().default('demo-ship-alpha'),
  hoursOffline: z.number().min(1).max(12).optional().default(6),
  includeLiveBurst: z.boolean().optional().default(true)
});

export const demoRateLimitMap = rateLimitMap;

demoRouter.post('/outage', async (req: Request, res: Response) => {
  const startTimer = Date.now();
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const nowMs = Date.now();

  const parseResult = outageSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid Parameters', details: parseResult.error.issues });
  }

  const { deviceId, hoursOffline, includeLiveBurst } = parseResult.data;

  // Security: only allow designated demo devices
  if (!ALLOWED_DEMO_DEVICES.has(deviceId)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: `Outage demo is restricted to demo devices: ${Array.from(ALLOWED_DEMO_DEVICES).join(', ')}`
    });
  }

  // Rate limit: 1 request per 5 seconds per IP
  const lastTime = rateLimitMap.get(clientIp) || 0;
  if (nowMs - lastTime < 5000) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Demo rate limit reached. Please wait 5 seconds before retrying.'
    });
  }
  rateLimitMap.set(clientIp, nowMs);

  const { readingsHot, readingsLate, deviceRegistry } = await getCollections();
  const now = new Date();

  // Generate synthetic backlog
  const backlogStart = new Date(now.getTime() - hoursOffline * 3600 * 1000);
  const backlogEnd = new Date(now.getTime() - 6 * 60 * 1000); // 6 minutes ago (outside hot tolerance)

  const coldBatch: CanonicalReading[] = [];
  const hotBatch: CanonicalReading[] = [];

  // Generate 1 reading every 15 seconds across temperature_c and battery_v
  const stepMs = 15 * 1000;
  let curr = backlogStart.getTime();
  let baseTemp = 21.0;

  while (curr <= backlogEnd.getTime() && coldBatch.length < 4800) {
    const t = new Date(curr);
    baseTemp += (Math.random() - 0.5) * 0.4;
    const tempVal = Math.round((baseTemp + Math.sin(curr / 3600000) * 3) * 100) / 100;
    const battVal = Math.round((3.2 - ((now.getTime() - curr) / (24 * 3600 * 1000)) * 0.1) * 100) / 100;

    coldBatch.push({
      ts: t,
      meta: {
        deviceId,
        metric: 'temperature_c',
        facilityId: 'facility-maritime',
        model: 'model-beta',
        firmware: 'v2.0'
      },
      value: tempVal
    });

    coldBatch.push({
      ts: t,
      meta: {
        deviceId,
        metric: 'battery_v',
        facilityId: 'facility-maritime',
        model: 'model-beta',
        firmware: 'v2.0'
      },
      value: battVal
    });

    curr += stepMs;
  }

  // Optional: include 20 live burst readings from the last 2 minutes
  if (includeLiveBurst) {
    for (let i = 0; i < 10; i++) {
      const liveTs = new Date(now.getTime() - (10 - i) * 5000); // within last 50s
      hotBatch.push({
        ts: liveTs,
        meta: {
          deviceId,
          metric: 'temperature_c',
          facilityId: 'facility-maritime',
          model: 'model-beta',
          firmware: 'v2.0'
        },
        value: 22.4 + Math.random() * 0.5
      });
      hotBatch.push({
        ts: liveTs,
        meta: {
          deviceId,
          metric: 'battery_v',
          facilityId: 'facility-maritime',
          model: 'model-beta',
          firmware: 'v2.0'
        },
        value: 3.14
      });
    }
  }

  // Ingest cold batch (quarantined and sorted)
  coldBatch.sort((a, b) => {
    const devCmp = a.meta.deviceId.localeCompare(b.meta.deviceId);
    if (devCmp !== 0) return devCmp;
    const metCmp = a.meta.metric.localeCompare(b.meta.metric);
    if (metCmp !== 0) return metCmp;
    return a.ts.getTime() - b.ts.getTime();
  });

  const CHUNK_SIZE = 500;
  for (let i = 0; i < coldBatch.length; i += CHUNK_SIZE) {
    const chunk = coldBatch.slice(i, i + CHUNK_SIZE);
    await readingsLate.insertMany(chunk, { ordered: false }).catch(() => {});
  }

  // Ingest hot batch
  if (hotBatch.length > 0) {
    await readingsHot.insertMany(hotBatch, { ordered: false }).catch(() => {});
  }

  // Update device registry
  await deviceRegistry.updateOne(
    { _id: deviceId as any },
    {
      $set: {
        facilityId: 'facility-maritime',
        model: 'model-beta',
        firmware: 'v2.0',
        status: 'online',
        lastSeen: now,
        batteryPct: 88
      }
    },
    { upsert: true }
  );

  laneStats.coldCount += coldBatch.length;
  laneStats.hotCount += hotBatch.length;
  laneStats.totalIngested += coldBatch.length + hotBatch.length;

  const durationMs = Date.now() - startTimer;

  return res.status(200).json({
    success: true,
    deviceId,
    totalGenerated: coldBatch.length + hotBatch.length,
    coldLaneCount: coldBatch.length,
    hotLaneCount: hotBatch.length,
    rejectedCount: 0,
    durationMs,
    message: `Successfully ingested ${coldBatch.length} backlog points to COLD lane and ${hotBatch.length} live points to HOT lane for ${deviceId}.`
  });
});
