import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { QueryRouter } from '../../router/index.js';
import { buildAnomalyPipeline } from '../../pipelines/anomaly.js';
import { getCollections } from '../../db/mongo.js';

export const seriesRouter = Router();

const seriesQuerySchema = z.object({
  deviceId: z.string().min(1),
  metric: z.string().min(1),
  from: z.string().transform(val => new Date(val)),
  to: z.string().transform(val => new Date(val)),
  maxPoints: z.coerce.number().optional().default(1000),
  fillMethod: z.enum(['locf', 'linear']).optional().default('locf'),
  withAnomalyData: z.coerce.boolean().optional().default(false)
});

seriesRouter.get('/', async (req: Request, res: Response) => {
  const parseResult = seriesQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid Query Parameters',
      details: parseResult.error.issues
    });
  }

  const { deviceId, metric, from, to, maxPoints, fillMethod, withAnomalyData } = parseResult.data;

  try {
    if (withAnomalyData) {
      // Execute in-database anomaly pipeline for detailed Explorer chart overlays
      const startTimer = Date.now();
      const { readingsHot } = await getCollections();
      const stepSeconds = Math.max(5, Math.round((to.getTime() - from.getTime()) / (maxPoints * 1000)));

      const pipeline = buildAnomalyPipeline({
        deviceId,
        metric,
        from,
        to,
        stepSeconds,
        fillMethod,
        mergeIntoAlerts: false,
        minSamples: 5,
        zScoreThreshold: 3.0
      });

      // Add projection
      pipeline.push({
        $project: {
          _id: 0,
          ts: 1,
          value: { $round: ['$value', 3] },
          synthetic: 1,
          mu: { $round: ['$mu', 3] },
          sigma: { $round: ['$sigma', 3] },
          ema: { $round: ['$ema', 3] },
          zScore: { $round: ['$zScore', 2] },
          isAnomaly: 1
        }
      });

      const docs = await readingsHot.aggregate(pipeline).toArray();
      const serverMs = Date.now() - startTimer;

      let anomalyCount = 0;
      const points = docs.map((d: any) => {
        if (d.isAnomaly) anomalyCount++;
        return {
          ts: d.ts,
          value: d.value,
          synthetic: Boolean(d.synthetic),
          mu: d.mu,
          sigma: d.sigma,
          ema: d.ema,
          zScore: d.zScore,
          isAnomaly: Boolean(d.isAnomaly)
        };
      });

      const vals = points.map(p => p.value).sort((a, b) => a - b);
      const sum = vals.reduce((acc, v) => acc + v, 0);
      const p95Idx = Math.floor(vals.length * 0.95);

      return res.status(200).json({
        points,
        tier: 'T1_RAW_ANOMALY',
        docsScanned: docs.length,
        serverMs,
        summary: {
          min: vals.length > 0 ? vals[0] : 0,
          max: vals.length > 0 ? vals[vals.length - 1] : 0,
          avg: vals.length > 0 ? Math.round((sum / vals.length) * 100) / 100 : 0,
          p95: vals.length > 0 ? vals[Math.min(p95Idx, vals.length - 1)] : 0,
          count: vals.length
        },
        anomalyCount
      });
    }

    // Default: Fast tiered resolution via QueryRouter
    const result = await QueryRouter.execute({
      deviceId,
      metric,
      from,
      to,
      maxPoints
    });

    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(500).json({
      error: 'Query Execution Failed',
      message: err.message
    });
  }
});
