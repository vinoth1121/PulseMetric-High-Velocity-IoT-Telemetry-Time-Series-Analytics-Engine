import { defaultRegistry } from '../src/adapters/registry.js';
import { CanonicalReading } from '../src/adapters/types.js';
import { getCollections, closeDb } from '../src/db/mongo.js';

// Seeded pseudo-random generator (Mulberry32)
export function createRng(seed: number = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DeviceConfig {
  deviceId: string;
  facilityId: string;
  model: string;
  firmware: string;
  baseTemp: number;
  batteryMv: number;
  anomalyChance: number;
}

export function generateDeviceFleet(count: number = 15): DeviceConfig[] {
  const facilities = ['facility-central', 'facility-north', 'facility-maritime'];
  const fleet: DeviceConfig[] = [];

  for (let i = 1; i <= count; i++) {
    const pad = String(i).padStart(3, '0');
    const deviceId = `pm-device-${pad}`;
    const facilityId = facilities[(i - 1) % facilities.length];

    if (i % 3 === 1) {
      fleet.push({
        deviceId,
        facilityId,
        model: 'sensornode-a',
        firmware: 'v1.0',
        baseTemp: 21.0 + (i % 5),
        batteryMv: 3200,
        anomalyChance: 0.02
      });
    } else if (i % 3 === 2) {
      fleet.push({
        deviceId,
        facilityId,
        model: 'enviromon-b',
        firmware: 'v2.0',
        baseTemp: 294.15 + (i % 5), // Kelvin
        batteryMv: 3150,
        anomalyChance: 0.02
      });
    } else {
      fleet.push({
        deviceId,
        facilityId,
        model: 'baroguard-c',
        firmware: 'v3.0',
        baseTemp: 20.5 + (i % 5),
        batteryMv: 3100,
        anomalyChance: 0.02
      });
    }
  }

  return fleet;
}

export function generateDeviceReading(
  dev: DeviceConfig,
  timestamp: Date,
  rng: () => number,
  forceAnomaly: boolean = false
): Record<string, any> {
  const tsMs = timestamp.getTime();
  const daySec = (tsMs / 1000) % 86400;
  const diurnal = Math.sin((daySec / 86400) * 2 * Math.PI) * 4.0;
  const noise = (rng() - 0.5) * 0.8;
  const isAnomaly = forceAnomaly || rng() < dev.anomalyChance;
  const spike = isAnomaly ? (rng() > 0.5 ? 12.0 : -10.0) : 0;

  if (dev.firmware === 'v1.0') {
    return {
      deviceId: dev.deviceId,
      facilityId: dev.facilityId,
      model: dev.model,
      firmware: dev.firmware,
      ts: timestamp.toISOString(),
      temp_c: Math.round((dev.baseTemp + diurnal + noise + spike) * 100) / 100
    };
  }

  if (dev.firmware === 'v2.0') {
    const kelvinVal = dev.baseTemp + diurnal + noise + spike;
    return {
      deviceId: dev.deviceId,
      facilityId: dev.facilityId,
      model: dev.model,
      firmware: dev.firmware,
      ts: timestamp.toISOString(),
      temperature: Math.round(kelvinVal * 100) / 100,
      unit: 'kelvin',
      battery_mv: Math.max(2800, Math.round(dev.batteryMv - (rng() * 2)))
    };
  }

  // v3.0
  const hum = Math.min(99, Math.max(20, 55 + (diurnal * -3) + noise * 5 + (isAnomaly ? 30 : 0)));
  const pressKpa = 101.325 + (noise * 0.5) + (isAnomaly ? -5 : 0);
  return {
    deviceId: dev.deviceId,
    facilityId: dev.facilityId,
    model: dev.model,
    firmware: dev.firmware,
    ts: timestamp.toISOString(),
    humidity_pct: Math.round(hum * 10) / 10,
    pressure_val: Math.round(pressKpa * 100) / 100,
    pressure_unit: 'kpa'
  };
}

let bgSimulatorTimer: NodeJS.Timeout | null = null;

export function startBackgroundSimulator(options: { intervalMs?: number; deviceCount?: number } = {}) {
  const intervalMs = options.intervalMs || 3000;
  const deviceCount = options.deviceCount || 10;
  const fleet = generateDeviceFleet(deviceCount);
  const rng = createRng(12345);

  console.log(`[simulator] Starting background low-rate generator (${deviceCount} devices, every ${intervalMs}ms)...`);

  const step = async () => {
    try {
      const { readingsHot, deviceRegistry } = await getCollections();
      const now = new Date();
      const rawPayloads: Record<string, any>[] = [];

      for (const dev of fleet) {
        // 95% chance of reporting to simulate realistic minor network drops
        if (rng() > 0.05) {
          rawPayloads.push(generateDeviceReading(dev, now, rng));
        }
      }

      const canonicalBatch: CanonicalReading[] = [];
      for (const raw of rawPayloads) {
        try {
          const list = defaultRegistry.normalize(raw);
          canonicalBatch.push(...list);
        } catch {}
      }

      if (canonicalBatch.length > 0) {
        await readingsHot.insertMany(canonicalBatch, { ordered: false });
      }

      for (const dev of fleet) {
        deviceRegistry.updateOne(
          { _id: dev.deviceId as any },
          {
            $set: {
              facilityId: dev.facilityId,
              model: dev.model,
              firmware: dev.firmware,
              status: 'online',
              lastSeen: now
            }
          },
          { upsert: true }
        ).catch(() => {});
      }
    } catch (err: any) {
      console.warn('[simulator] Step warning:', err.message);
    }
  };

  step().catch(() => {});
  bgSimulatorTimer = setInterval(() => {
    step().catch(() => {});
  }, intervalMs);
}

export function stopBackgroundSimulator() {
  if (bgSimulatorTimer) {
    clearInterval(bgSimulatorTimer);
    bgSimulatorTimer = null;
  }
}

import { fileURLToPath } from 'url';
import path from 'path';

const isDirectCli = () => {
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
};

if (isDirectCli()) {
  console.log('[simulator-cli] Running 1-minute continuous simulation...');
  startBackgroundSimulator({ intervalMs: 2000, deviceCount: 15 });
  setTimeout(async () => {
    stopBackgroundSimulator();
    console.log('[simulator-cli] Simulation completed.');
    await closeDb();
    process.exit(0);
  }, 60000);
}
