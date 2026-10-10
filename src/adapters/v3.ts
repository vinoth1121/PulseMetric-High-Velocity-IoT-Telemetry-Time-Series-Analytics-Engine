import { AdapterFn, CanonicalReading } from './types.js';

export const v3Adapter: AdapterFn = (raw, context): CanonicalReading[] => {
  if (typeof raw.humidity_pct !== 'number' && typeof raw.pressure_val !== 'number') {
    throw new Error('v3 payload missing humidity_pct or pressure_val');
  }

  const ts = new Date(raw.ts);
  if (isNaN(ts.getTime())) {
    throw new Error('Invalid timestamp in v3 payload');
  }

  const facilityId = String(raw.facilityId || context?.defaultFacilityId || 'facility-central');
  const deviceId = String(raw.deviceId);
  const model = String(raw.model || 'model-gamma');
  const firmware = String(raw.firmware || 'v3.0');

  const readings: CanonicalReading[] = [];

  if (typeof raw.humidity_pct === 'number') {
    readings.push({
      ts,
      meta: {
        deviceId,
        metric: 'humidity_pct',
        facilityId,
        model,
        firmware
      },
      value: Math.round(raw.humidity_pct * 100) / 100
    });
  }

  if (typeof raw.pressure_val === 'number') {
    const unit = String(raw.pressure_unit || 'hpa').toLowerCase();
    let hpa = raw.pressure_val;
    if (unit === 'kpa') {
      hpa = raw.pressure_val * 10.0;
    } else if (unit === 'bar') {
      hpa = raw.pressure_val * 1000.0;
    } else if (unit === 'psi') {
      hpa = raw.pressure_val * 68.9476;
    }

    readings.push({
      ts,
      meta: {
        deviceId,
        metric: 'pressure_hpa',
        facilityId,
        model,
        firmware
      },
      value: Math.round(hpa * 100) / 100
    });
  }

  return readings;
};
