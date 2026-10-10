import { AdapterFn, CanonicalReading } from './types.js';

export const v2Adapter: AdapterFn = (raw, context): CanonicalReading[] => {
  if (typeof raw.temperature !== 'number') {
    throw new Error('v2 payload missing numeric "temperature"');
  }

  const ts = new Date(raw.ts);
  if (isNaN(ts.getTime())) {
    throw new Error('Invalid timestamp in v2 payload');
  }

  const facilityId = String(raw.facilityId || context?.defaultFacilityId || 'facility-central');
  const deviceId = String(raw.deviceId);
  const model = String(raw.model || 'model-beta');
  const firmware = String(raw.firmware || 'v2.0');

  const unit = String(raw.unit || 'celsius').toLowerCase();
  let tempC = raw.temperature;
  if (unit === 'kelvin') {
    tempC = raw.temperature - 273.15;
  } else if (unit === 'fahrenheit') {
    tempC = ((raw.temperature - 32) * 5) / 9;
  }

  // Round to 3 decimal places
  tempC = Math.round(tempC * 1000) / 1000;

  const readings: CanonicalReading[] = [
    {
      ts,
      meta: {
        deviceId,
        metric: 'temperature_c',
        facilityId,
        model,
        firmware
      },
      value: tempC
    }
  ];

  if (typeof raw.battery_mv === 'number') {
    readings.push({
      ts,
      meta: {
        deviceId,
        metric: 'battery_v',
        facilityId,
        model,
        firmware
      },
      value: Math.round((raw.battery_mv / 1000) * 1000) / 1000
    });
  }

  return readings;
};
