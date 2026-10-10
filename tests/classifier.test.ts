import { describe, it, expect } from 'vitest';

describe('Temporal Classifier Boundaries', () => {
  const HOT_TOLERANCE_MS = 5 * 60 * 1000; // 5 min
  const MAX_FUTURE_DRIFT_MS = 5 * 60 * 1000; // 5 min
  const MAX_RETENTION_MS = 7 * 24 * 3600 * 1000; // 7 days

  function classifyTimestamp(eventTs: Date, now: Date): 'HOT' | 'COLD' | 'REJECTED' {
    const readingMs = eventTs.getTime();
    const nowMs = now.getTime();
    const diff = Math.abs(readingMs - nowMs);

    // Past retention or excessive future drift
    if (nowMs - readingMs > MAX_RETENTION_MS || readingMs - nowMs > MAX_FUTURE_DRIFT_MS) {
      return 'REJECTED';
    }

    if (diff <= HOT_TOLERANCE_MS) {
      return 'HOT';
    }

    return 'COLD';
  }

  const now = new Date('2026-10-10T12:00:00.000Z');

  it('classifies exact 0ms drift as HOT', () => {
    expect(classifyTimestamp(now, now)).toBe('HOT');
  });

  it('classifies exactly 5 minutes in the past as HOT', () => {
    const exactly5mPast = new Date(now.getTime() - 5 * 60 * 1000);
    expect(classifyTimestamp(exactly5mPast, now)).toBe('HOT');
  });

  it('classifies 5 minutes and 1 millisecond in the past as COLD', () => {
    const coldTs = new Date(now.getTime() - (5 * 60 * 1000 + 1));
    expect(classifyTimestamp(coldTs, now)).toBe('COLD');
  });

  it('classifies 3 days in the past as COLD', () => {
    const cold3d = new Date(now.getTime() - 3 * 24 * 3600 * 1000);
    expect(classifyTimestamp(cold3d, now)).toBe('COLD');
  });

  it('classifies exactly 7 days in the past as COLD', () => {
    const exactly7d = new Date(now.getTime() - MAX_RETENTION_MS);
    expect(classifyTimestamp(exactly7d, now)).toBe('COLD');
  });

  it('rejects timestamps older than 7 days (> 7 days past retention limit)', () => {
    const expiredTs = new Date(now.getTime() - (MAX_RETENTION_MS + 1000));
    expect(classifyTimestamp(expiredTs, now)).toBe('REJECTED');
  });

  it('classifies exactly 5 minutes in future as HOT', () => {
    const future5m = new Date(now.getTime() + 5 * 60 * 1000);
    expect(classifyTimestamp(future5m, now)).toBe('HOT');
  });

  it('rejects timestamps more than 5 minutes in future (bad device clock)', () => {
    const futureExcess = new Date(now.getTime() + (5 * 60 * 1000 + 1000));
    expect(classifyTimestamp(futureExcess, now)).toBe('REJECTED');
  });
});
