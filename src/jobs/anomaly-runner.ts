import { getCollections } from '../db/mongo.js';
import { buildAnomalyPipeline } from '../pipelines/anomaly.js';
import { EventEmitter } from 'events';

export const alertEvents = new EventEmitter();

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

export async function runAnomalyDetectionJob(): Promise<number> {
  if (isRunning) return 0;
  isRunning = true;

  try {
    const { readingsHot, alerts, deviceRegistry } = await getCollections();
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 60 * 1000); // Trailing 30 minutes

    // Find active devices
    const devices = await deviceRegistry.find({}, { projection: { _id: 1 } }).toArray();
    const deviceIds = devices.length > 0
      ? devices.map(d => String(d._id))
      : ['demo-device-001', 'demo-device-002'];

    const metrics = ['temperature_c', 'humidity_pct', 'pressure_hpa', 'battery_v'];
    let newAlertsCount = 0;

    for (const deviceId of deviceIds) {
      for (const metric of metrics) {
        // Run pipeline with mergeIntoAlerts: true
        const pipeline = buildAnomalyPipeline({
          deviceId,
          metric,
          from,
          to: now,
          stepSeconds: 5,
          fillMethod: 'locf',
          mergeIntoAlerts: true,
          minSamples: 5,
          zScoreThreshold: 3.0
        });

        await readingsHot.aggregate(pipeline).toArray();
      }
    }

    // Check newly inserted alerts in the last 35 seconds to broadcast to SSE
    const recentThreshold = new Date(now.getTime() - 35 * 1000);
    const recentAlerts = await alerts.find({ createdAt: { $gte: recentThreshold } }).toArray();
    newAlertsCount = recentAlerts.length;

    for (const alert of recentAlerts) {
      alertEvents.emit('alert', alert);
    }

    return newAlertsCount;
  } catch (err: any) {
    console.error('[anomaly-job] Error running anomaly detection:', err.message);
    return 0;
  } finally {
    isRunning = false;
  }
}

export function startAnomalyRunner(intervalMs: number = 30000): void {
  if (timer) return;
  console.log(`[anomaly-job] Starting anomaly runner job (every ${intervalMs}ms)...`);
  runAnomalyDetectionJob().catch(() => {});
  timer = setInterval(() => {
    runAnomalyDetectionJob().catch(() => {});
  }, intervalMs);
}

export function stopAnomalyRunner(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
