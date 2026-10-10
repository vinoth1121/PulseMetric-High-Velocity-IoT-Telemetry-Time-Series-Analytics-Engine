import { describe, it, expect } from 'vitest';
import { defaultRegistry, UnknownFirmwareError } from '../src/adapters/registry.js';
import { v1Adapter } from '../src/adapters/v1.js';
import { v2Adapter } from '../src/adapters/v2.js';
import { v3Adapter } from '../src/adapters/v3.js';

describe('Polymorphic Sensor Adapters', () => {
  const tsStr = '2026-10-10T12:00:00.000Z';
  const expectedTs = new Date(tsStr);

  it('normalizes v1 payload with temp_c into canonical temperature_c reading', () => {
    const raw = {
      deviceId: 'dev-001',
      model: 'sensornode-a',
      firmware: 'v1.0',
      ts: tsStr,
      temp_c: 22.1
    };

    const readings = v1Adapter(raw);
    expect(readings).toHaveLength(1);
    expect(readings[0]).toEqual({
      ts: expectedTs,
      meta: {
        deviceId: 'dev-001',
        metric: 'temperature_c',
        facilityId: 'facility-central',
        model: 'sensornode-a',
        firmware: 'v1.0'
      },
      value: 22.1
    });
  });

  it('normalizes v2 payload with kelvin conversion and battery_mv to battery_v', () => {
    const raw = {
      deviceId: 'dev-002',
      model: 'enviromon-b',
      firmware: 'v2.0',
      ts: tsStr,
      temperature: 295.25,
      unit: 'kelvin',
      battery_mv: 3100
    };

    const readings = v2Adapter(raw);
    expect(readings).toHaveLength(2);

    const tempReading = readings.find(r => r.meta.metric === 'temperature_c');
    const battReading = readings.find(r => r.meta.metric === 'battery_v');

    expect(tempReading).toBeDefined();
    expect(tempReading!.value).toBeCloseTo(22.1, 2); // 295.25 - 273.15 = 22.1
    expect(tempReading!.meta.deviceId).toBe('dev-002');

    expect(battReading).toBeDefined();
    expect(battReading!.value).toBe(3.1); // 3100 / 1000 = 3.1
  });

  it('normalizes v3 payload with humidity and pressure unit conversion (kpa -> hpa)', () => {
    const raw = {
      deviceId: 'dev-003',
      model: 'baroguard-c',
      firmware: 'v3.0',
      ts: tsStr,
      humidity_pct: 58.4,
      pressure_val: 101.325,
      pressure_unit: 'kpa'
    };

    const readings = v3Adapter(raw);
    expect(readings).toHaveLength(2);

    const hum = readings.find(r => r.meta.metric === 'humidity_pct');
    const press = readings.find(r => r.meta.metric === 'pressure_hpa');

    expect(hum).toBeDefined();
    expect(hum!.value).toBe(58.4);

    expect(press).toBeDefined();
    expect(press!.value).toBeCloseTo(1013.25, 2); // 101.325 kPa * 10 = 1013.25 hPa
  });

  it('rejects unknown firmware with UnknownFirmwareError via registry', () => {
    const raw = {
      deviceId: 'dev-999',
      model: 'legacy-sensor',
      firmware: 'v9.9-beta',
      ts: tsStr,
      data: 123
    };

    expect(() => defaultRegistry.normalize(raw)).toThrow(UnknownFirmwareError);
  });
});
