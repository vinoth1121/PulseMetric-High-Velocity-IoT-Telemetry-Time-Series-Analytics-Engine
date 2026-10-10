import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getCollections } from '../../db/mongo.js';
import { defaultRegistry, UnknownFirmwareError } from '../../adapters/registry.js';
import { CanonicalReading } from '../../adapters/types.js';

export const ingestRouter = Router();

// Cumulative lane counters
export const laneStats = {
  totalIngested: 0,
  hotCount: 0,
  coldCount: 0,
  rejectedCount: 0,
  deadLetterCount: 0,
  lastIngestAt: new Date()
};

// Ingest validation schema
const singleReadingSchema = z.object({
  deviceId: z.string().min(1, 'deviceId is required'),
  ts: z.union([z.string(), z.number(), z.date()])
}).passthrough();

const ingestPayloadSchema = z.union([
  singleReadingSchema,
  z.array(singleReadingSchema).min(1).max(1000)
]);

const HOT_TOLERANCE_MS = (parseInt(process.env.HOT_LANE_TOLERANCE_MINUTES || '5', 10)) * 60 * 1000;
const MAX_FUTURE_DRIFT_MS = 5 * 60 * 1000; // 5 minutes in future
const MAX_RETENTION_MS = 7 * 24 * 3600 * 1000; // 7 days old

ingestRouter.post('/', async (req: Request, res: Response) => {
  const startTimer = Date.now();
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.API_KEY || 'pm_live_secret_key_9f8e7d6c';

  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing x-api-key header'
    });
  }

  const parseResult = ingestPayloadSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid Payload',
      details: parseResult.error.issues
    });
  }

  const rawItems = Array.isArray(parseResult.data) ? parseResult.data : [parseResult.data];
  if (rawItems.length === 0) {
    return res.status(200).json({ hotCount: 0, coldCount: 0, rejectedCount: 0, totalProcessed: 0, serverTimingMs: 0 });
  }

  const { readingsHot, readingsLate, deadLetter, deviceRegistry } = await getCollections();
  const now = new Date();
  const nowMs = now.getTime();

  const hotBatch: CanonicalReading[] = [];
  const coldBatch: CanonicalReading[] = [];
  let rejectedCount = 0;
  const touchedDevices = new Map<string, { model: string; firmware: string; facilityId: string; batteryPct?: number; lastSeen: Date }>();

  for (const item of rawItems) {
    let canonicalList: CanonicalReading[] = [];
    try {
      canonicalList = defaultRegistry.normalize(item);
    } catch (err: any) {
      if (err instanceof UnknownFirmwareError) {
        // Unknown firmware: reject with 422 and log to capped dead-letter collection
        laneStats.deadLetterCount++;
        await deadLetter.insertOne({
          rejectedAt: now,
          error: err.message,
          model: err.model,
          firmware: err.firmware,
          rawPayload: item
        }).catch(() => {});

        return res.status(422).json({
          error: 'Unprocessable Entity',
          message: err.message,
          model: err.model,
          firmware: err.firmware
        });
      } else {
        rejectedCount++;
        continue;
      }
    }

    for (const reading of canonicalList) {
      const readingMs = reading.ts.getTime();
      const diff = Math.abs(readingMs - nowMs);

      // Boundary check: reject > 7 days old or > 5 min in future
      if (nowMs - readingMs > MAX_RETENTION_MS || readingMs - nowMs > MAX_FUTURE_DRIFT_MS) {
        rejectedCount++;
        continue;
      }

      // Track device for registry update
      const devId = reading.meta.deviceId;
      if (!touchedDevices.has(devId)) {
        touchedDevices.set(devId, {
          model: reading.meta.model,
          firmware: reading.meta.firmware,
          facilityId: reading.meta.facilityId,
          lastSeen: reading.ts
        });
      }

      // Temporal Classifier: drift <= 5 minutes -> HOT lane, otherwise -> COLD lane
      if (diff <= HOT_TOLERANCE_MS) {
        hotBatch.push(reading);
      } else {
        coldBatch.push(reading);
      }
    }
  }

  // 1. Write to HOT lane: direct unordered insertMany
  if (hotBatch.length > 0) {
    try {
      await readingsHot.insertMany(hotBatch, { ordered: false });
    } catch (err: any) {
      // Ignore duplicate key warnings in unordered batch
    }
  }

  // 2. Write to COLD lane: quarantine in memory, sort by (meta.deviceId, meta.metric, ts), insert in chunks
  if (coldBatch.length > 0) {
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
      try {
        await readingsLate.insertMany(chunk, { ordered: false });
      } catch (err: any) {
        // Ignore duplicate key warnings
      }
    }
  }

  // Update device registry with latest seen info
  for (const [devId, info] of touchedDevices.entries()) {
    deviceRegistry.updateOne(
      { _id: devId as any },
      {
        $set: {
          facilityId: info.facilityId,
          model: info.model,
          firmware: info.firmware,
          status: 'online',
          lastSeen: info.lastSeen
        }
      },
      { upsert: true }
    ).catch(() => {});
  }

  // Update counters
  laneStats.hotCount += hotBatch.length;
  laneStats.coldCount += coldBatch.length;
  laneStats.rejectedCount += rejectedCount;
  laneStats.totalIngested += hotBatch.length + coldBatch.length;
  laneStats.lastIngestAt = new Date();

  const serverTimingMs = Date.now() - startTimer;
  res.setHeader('Server-Timing', `ingest;dur=${serverTimingMs}`);

  return res.status(200).json({
    hotCount: hotBatch.length,
    coldCount: coldBatch.length,
    rejectedCount,
    totalProcessed: hotBatch.length + coldBatch.length,
    serverTimingMs
  });
});
