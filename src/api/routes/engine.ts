import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

export const engineRouter = Router();

engineRouter.get('/benchmarks', async (req: Request, res: Response) => {
  const resultsDir = path.resolve(process.cwd(), 'results');
  if (!fs.existsSync(resultsDir)) {
    return res.status(200).json({
      environment: {
        host: 'Node.js 20 / MongoDB 7.0',
        measuredAt: new Date().toISOString()
      },
      results: {}
    });
  }

  const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json'));
  const benchmarksData: Record<string, any> = {};

  for (const file of files) {
    const key = path.basename(file, '.json');
    try {
      const content = fs.readFileSync(path.join(resultsDir, file), 'utf-8');
      benchmarksData[key] = JSON.parse(content);
    } catch {
      benchmarksData[key] = { error: 'Failed to parse JSON' };
    }
  }

  return res.status(200).json(benchmarksData);
});
