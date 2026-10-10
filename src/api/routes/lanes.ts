import { Router, Request, Response } from 'express';
import { getCollections } from '../../db/mongo.js';
import { laneStats } from './ingest.js';

export const lanesRouter = Router();

lanesRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const { readingsHot, readingsLate, deadLetter } = await getCollections();

    // Query collection count estimates
    const [hotEst, lateEst, deadLetterEst] = await Promise.all([
      readingsHot.estimatedDocumentCount().catch(() => 0),
      readingsLate.estimatedDocumentCount().catch(() => 0),
      deadLetter.estimatedDocumentCount().catch(() => 0)
    ]);

    return res.status(200).json({
      counters: {
        totalIngested: laneStats.totalIngested,
        hotCount: laneStats.hotCount,
        coldCount: laneStats.coldCount,
        rejectedCount: laneStats.rejectedCount,
        deadLetterCount: laneStats.deadLetterCount,
        lastIngestAt: laneStats.lastIngestAt
      },
      collections: {
        readingsHotEstimatedCount: hotEst,
        readingsLateEstimatedCount: lateEst,
        deadLetterCount: deadLetterEst
      },
      system: {
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        uptimeSeconds: Math.round(process.uptime())
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to retrieve lane stats', message: err.message });
  }
});
