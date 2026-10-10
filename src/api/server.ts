import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { ingestRouter } from './routes/ingest.js';
import { devicesRouter } from './routes/devices.js';
import { seriesRouter } from './routes/series.js';
import { alertsRouter } from './routes/alerts.js';
import { lanesRouter } from './routes/lanes.js';
import { demoRouter } from './routes/demo.js';
import { engineRouter } from './routes/engine.js';
import { healthRouter } from './routes/health.js';
import { startAnomalyRunner } from '../jobs/anomaly-runner.js';
import { startRollupScheduler } from '../jobs/rollup.js';
import { startBackgroundSimulator } from '../../scripts/simulate.js';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(helmet({
  contentSecurityPolicy: false // Allow inline scripts and assets for uPlot / local charts
}));

const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: corsOrigin === '*' ? '*' : corsOrigin.split(','),
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

app.use(express.json({ limit: '1mb' }));

// API Routes
app.use('/api/ingest', ingestRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/series', seriesRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/lanes', lanesRouter);
app.use('/api/demo', demoRouter);
app.use('/api/engine', engineRouter);
app.use('/api/health', healthRouter);

// Serve Frontend in Production / Built State
const webDistPath = path.resolve(process.cwd(), 'web', 'dist');
if (fs.existsSync(webDistPath)) {
  console.log(`[server] Serving static frontend from ${webDistPath}`);
  app.use(express.static(webDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.json({
      service: 'PulseMetric API Server',
      status: 'active',
      endpoints: [
        '/api/health',
        '/api/devices',
        '/api/series',
        '/api/alerts',
        '/api/alerts/stream',
        '/api/lanes/stats',
        '/api/demo/outage',
        '/api/engine/benchmarks'
      ]
    });
  });
}

// 404 Handler for API
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[server] Uncaught route error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

import { fileURLToPath } from 'url';

const isDirectCli = () => {
  try {
    return fileURLToPath(import.meta.url).toLowerCase().includes('server');
  } catch {
    return false;
  }
};

if (isDirectCli()) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] PulseMetric Engine listening on port ${PORT}`);

    // Start background jobs
    startAnomalyRunner(30000);
    startRollupScheduler(300000);

    // Optional background simulator
    if (process.env.SIMULATOR_ENABLED === 'true') {
      const rateMs = parseInt(process.env.SIMULATOR_RATE_MS || '3000', 10);
      const devices = parseInt(process.env.SIMULATOR_DEVICES || '10', 10);
      startBackgroundSimulator({ intervalMs: rateMs, deviceCount: devices });
    }
  });
}

export default app;
