import { AdapterFn, CanonicalReading } from './types.js';

export const v1Adapter: AdapterFn = (raw, context): CanonicalReading[] => {
  if (typeof raw.temp_c !== 'number') {
    throw new Error('v1 payload missing numeric "temp_c"');
  }

  const ts = new Date(raw.ts);
  if (isNaN(ts.getTime())) {
    throw new Error('Invalid timestamp in v1 payload');
  }

  const facilityId = String(raw.facilityId || context?.defaultFacilityId || 'facility-central');
  const deviceId = String(raw.deviceId);
  const model = String(raw.model || 'model-alpha');
  const firmware = String(raw.firmware || 'v1.0');

  return [
    {
      ts,
      meta: {
        deviceId,
        metric: 'temperature_c',
        facilityId,
        model,
        firmware
      },
      value: Number(raw.temp_c)
    }
  ];
};
