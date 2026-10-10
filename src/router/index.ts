import { getDb, getCollections } from '../db/mongo.js';
import { Document } from 'mongodb';

export type TierName = 'T1_RAW' | 'T2_ROLLUP_5M' | 'T3_ROLLUP_1H' | 'STITCHED_T1_T2' | 'STITCHED_T2_T3';

export interface SeriesQueryInput {
  deviceId: string;
  metric: string;
  from: Date;
  to: Date;
  maxPoints?: number;
  now?: Date; // injected for deterministic testing
}

export interface SeriesPoint {
  ts: Date;
  value: number;
  min?: number;
  max?: number;
  isSynthetic?: boolean;
}

export interface SeriesSummary {
  min: number;
  max: number;
  avg: number;
  p95: number;
  count: number;
}

export interface SeriesResult {
  points: SeriesPoint[];
  tier: TierName;
  docsScanned: number;
  serverMs: number;
  summary: SeriesSummary;
  anomalyCount: number;
}

export class QueryRouter {
  // Retention boundaries
  public static readonly RAW_RETENTION_MS = 7 * 24 * 3600 * 1000; // 7 days
  public static readonly ROLLUP5M_RETENTION_MS = 90 * 24 * 3600 * 1000; // 90 days

  /**
   * Selects appropriate tier and determines any required stitching seams.
   */
  public static planRoute(input: SeriesQueryInput): {
    tier: TierName;
    needsStitching: boolean;
    seam?: Date;
    estimatedPoints: number;
  } {
    const now = input.now || new Date();
    const spanMs = input.to.getTime() - input.from.getTime();
    const ageFromNowMs = now.getTime() - input.from.getTime();
    const maxPoints = input.maxPoints || 1000;

    const t1Threshold = new Date(now.getTime() - this.RAW_RETENTION_MS);
    const t2Threshold = new Date(now.getTime() - this.ROLLUP5M_RETENTION_MS);

    // Case 1: Within raw retention (< 7 days ago)
    if (input.from >= t1Threshold) {
      // If duration is short (< 4 hours) or points naturally <= maxPoints
      // At 5s interval, 4h = 2880 points
      if (spanMs <= 4 * 3600 * 1000) {
        return { tier: 'T1_RAW', needsStitching: false, estimatedPoints: Math.round(spanMs / 5000) };
      }
      // If > 4h but within 7d, check if user requested maxPoints fits Tier 2
      const expected5mPoints = Math.round(spanMs / (5 * 60 * 1000));
      if (expected5mPoints <= maxPoints) {
        return { tier: 'T2_ROLLUP_5M', needsStitching: false, estimatedPoints: expected5mPoints };
      }
      return { tier: 'T2_ROLLUP_5M', needsStitching: false, estimatedPoints: expected5mPoints };
    }

    // Case 2: Crossing T1/T2 seam (starts before 7d, ends after 7d)
    if (input.from < t1Threshold && input.to > t1Threshold && input.from >= t2Threshold) {
      const olderSpan = t1Threshold.getTime() - input.from.getTime();
      const newerSpan = input.to.getTime() - t1Threshold.getTime();
      const estPoints = Math.round(olderSpan / 300000) + Math.round(newerSpan / 5000);
      return {
        tier: 'STITCHED_T1_T2',
        needsStitching: true,
        seam: t1Threshold,
        estimatedPoints: estPoints
      };
    }

    // Case 3: Completely inside Tier 2 (< 90 days)
    if (input.from >= t2Threshold && input.to <= t1Threshold) {
      const estPoints = Math.round(spanMs / (5 * 60 * 1000));
      if (estPoints <= maxPoints || spanMs <= 30 * 24 * 3600 * 1000) {
        return { tier: 'T2_ROLLUP_5M', needsStitching: false, estimatedPoints: estPoints };
      }
      return { tier: 'T3_ROLLUP_1H', needsStitching: false, estimatedPoints: Math.round(spanMs / 3600000) };
    }

    // Case 4: Crossing T2/T3 seam (starts before 90d, ends after 90d)
    if (input.from < t2Threshold && input.to > t2Threshold) {
      const olderSpan = t2Threshold.getTime() - input.from.getTime();
      const newerSpan = input.to.getTime() - t2Threshold.getTime();
      const estPoints = Math.round(olderSpan / 3600000) + Math.round(newerSpan / 300000);
      return {
        tier: 'STITCHED_T2_T3',
        needsStitching: true,
        seam: t2Threshold,
        estimatedPoints: estPoints
      };
    }

    // Case 5: Fully older than 90 days -> Tier 3
    return {
      tier: 'T3_ROLLUP_1H',
      needsStitching: false,
      estimatedPoints: Math.round(spanMs / 3600000)
    };
  }

  /**
   * Executes the series query with single $facet pipeline returning points, summary, and anomaly counts.
   */
  public static async execute(input: SeriesQueryInput): Promise<SeriesResult> {
    const startTimer = Date.now();
    const { readingsHot, rollup5m, rollup1h, alerts, db } = await getCollections();
    const plan = this.planRoute(input);
    const maxPoints = input.maxPoints || 1000;

    let points: SeriesPoint[] = [];
    let docsScanned = 0;

    if (plan.tier === 'T1_RAW') {
      const rawPipeline: Document[] = [
        {
          $match: {
            'meta.deviceId': input.deviceId,
            'meta.metric': input.metric,
            ts: { $gte: input.from, $lte: input.to }
          }
        },
        {
          $unionWith: {
            coll: 'readings_late',
            pipeline: [
              {
                $match: {
                  'meta.deviceId': input.deviceId,
                  'meta.metric': input.metric,
                  ts: { $gte: input.from, $lte: input.to }
                }
              }
            ]
          }
        },
        { $sort: { ts: 1 } },
        {
          $facet: {
            series: [
              {
                $project: {
                  _id: 0,
                  ts: 1,
                  value: 1,
                  min: '$value',
                  max: '$value'
                }
              },
              { $limit: maxPoints }
            ],
            summary: [
              {
                $group: {
                  _id: null,
                  min: { $min: '$value' },
                  max: { $max: '$value' },
                  sum: { $sum: '$value' },
                  count: { $sum: 1 },
                  avg: { $avg: '$value' },
                  p95Arr: {
                    $percentile: { input: '$value', p: [0.95], method: 'approximate' }
                  }
                }
              }
            ]
          }
        }
      ];

      // Measure execution stats
      try {
        const explainResult = await readingsHot.aggregate(rawPipeline).explain('executionStats');
        docsScanned = explainResult.executionStats?.totalDocsExamined || 0;
      } catch {
        docsScanned = plan.estimatedPoints;
      }

      const facetRes = await readingsHot.aggregate(rawPipeline).toArray();
      const rawSeries = facetRes[0]?.series || [];
      points = rawSeries.map((r: any) => ({
        ts: new Date(r.ts),
        value: Number(r.value),
        min: Number(r.min),
        max: Number(r.max)
      }));
    } else if (plan.tier === 'T2_ROLLUP_5M') {
      const pipeline: Document[] = [
        {
          $match: {
            '_id.deviceId': input.deviceId,
            '_id.metric': input.metric,
            start: { $gte: input.from, $lte: input.to }
          }
        },
        { $sort: { start: 1 } },
        {
          $facet: {
            series: [
              {
                $project: {
                  _id: 0,
                  ts: '$start',
                  value: '$avg',
                  min: 1,
                  max: 1
                }
              },
              { $limit: maxPoints }
            ],
            summary: [
              {
                $group: {
                  _id: null,
                  min: { $min: '$min' },
                  max: { $max: '$max' },
                  sum: { $sum: '$sum' },
                  count: { $sum: '$count' },
                  p95Arr: { $max: '$p95' }
                }
              }
            ]
          }
        }
      ];

      try {
        const explainResult = await rollup5m.aggregate(pipeline).explain('executionStats');
        docsScanned = explainResult.executionStats?.totalDocsExamined || 0;
      } catch {
        docsScanned = points.length;
      }

      const facetRes = await rollup5m.aggregate(pipeline).toArray();
      const rawSeries = facetRes[0]?.series || [];
      points = rawSeries.map((r: any) => ({
        ts: new Date(r.ts),
        value: Number(r.value),
        min: Number(r.min),
        max: Number(r.max)
      }));
    } else if (plan.tier === 'STITCHED_T1_T2' && plan.seam) {
      // Seam stitching: older part [from, seam) from rollup_5m, newer part [seam, to] from raw
      const older5m = await rollup5m
        .find({
          '_id.deviceId': input.deviceId,
          '_id.metric': input.metric,
          start: { $gte: input.from, $lt: plan.seam }
        })
        .sort({ start: 1 })
        .toArray();

      const newerRaw = await readingsHot
        .find({
          'meta.deviceId': input.deviceId,
          'meta.metric': input.metric,
          ts: { $gte: plan.seam, $lte: input.to }
        })
        .sort({ ts: 1 })
        .limit(Math.max(10, maxPoints - older5m.length))
        .toArray();

      docsScanned = older5m.length + newerRaw.length;
      points = [
        ...older5m.map((r: any) => ({
          ts: new Date(r.start),
          value: Number(r.avg),
          min: Number(r.min),
          max: Number(r.max)
        })),
        ...newerRaw.map((r: any) => ({
          ts: new Date(r.ts),
          value: Number(r.value),
          min: Number(r.value),
          max: Number(r.value)
        }))
      ];
    } else if (plan.tier === 'STITCHED_T2_T3' && plan.seam) {
      // Seam stitching: older part [from, seam) from rollup_1h, newer part [seam, to] from rollup_5m
      const older1h = await rollup1h
        .find({
          '_id.deviceId': input.deviceId,
          '_id.metric': input.metric,
          start: { $gte: input.from, $lt: plan.seam }
        })
        .sort({ start: 1 })
        .toArray();

      const newer5m = await rollup5m
        .find({
          '_id.deviceId': input.deviceId,
          '_id.metric': input.metric,
          start: { $gte: plan.seam, $lte: input.to }
        })
        .sort({ start: 1 })
        .toArray();

      docsScanned = older1h.length + newer5m.length;
      points = [
        ...older1h.map((r: any) => ({
          ts: new Date(r.start),
          value: Number(r.avg),
          min: Number(r.min),
          max: Number(r.max)
        })),
        ...newer5m.map((r: any) => ({
          ts: new Date(r.start),
          value: Number(r.avg),
          min: Number(r.min),
          max: Number(r.max)
        }))
      ];
    } else {
      // Tier 3: rollup_1h
      const raw1h = await rollup1h
        .find({
          '_id.deviceId': input.deviceId,
          '_id.metric': input.metric,
          start: { $gte: input.from, $lte: input.to }
        })
        .sort({ start: 1 })
        .limit(maxPoints)
        .toArray();

      docsScanned = raw1h.length;
      points = raw1h.map((r: any) => ({
        ts: new Date(r.start),
        value: Number(r.avg),
        min: Number(r.min),
        max: Number(r.max)
      }));
    }

    // Compute summary statistics across returned points
    let summary: SeriesSummary = { min: 0, max: 0, avg: 0, p95: 0, count: points.length };
    if (points.length > 0) {
      const vals = points.map(p => p.value).sort((a, b) => a - b);
      const sum = vals.reduce((acc, v) => acc + v, 0);
      const p95Idx = Math.floor(vals.length * 0.95);
      summary = {
        min: Math.round(vals[0] * 100) / 100,
        max: Math.round(vals[vals.length - 1] * 100) / 100,
        avg: Math.round((sum / vals.length) * 100) / 100,
        p95: Math.round(vals[Math.min(p95Idx, vals.length - 1)] * 100) / 100,
        count: points.length
      };
    }

    // Count anomalies in range
    const anomalyCount = await alerts.countDocuments({
      deviceId: input.deviceId,
      metric: input.metric,
      ts: { $gte: input.from, $lte: input.to }
    });

    const serverMs = Date.now() - startTimer;
    return {
      points,
      tier: plan.tier,
      docsScanned,
      serverMs,
      summary,
      anomalyCount
    };
  }
}
