import { describe, it, expect } from 'vitest';
import { QueryRouter } from '../src/router/index.js';

describe('Smart Query Router Tier Planning Table', () => {
  const referenceNow = new Date('2026-10-10T12:00:00.000Z');

  const testCases = [
    {
      label: '1 hour range (live)',
      from: new Date(referenceNow.getTime() - 1 * 3600 * 1000),
      to: referenceNow,
      expectedTier: 'T1_RAW',
      needsStitching: false
    },
    {
      label: '4 hours range (live edge)',
      from: new Date(referenceNow.getTime() - 4 * 3600 * 1000),
      to: referenceNow,
      expectedTier: 'T1_RAW',
      needsStitching: false
    },
    {
      label: '3 days range (within raw retention, > 4h)',
      from: new Date(referenceNow.getTime() - 3 * 24 * 3600 * 1000),
      to: referenceNow,
      expectedTier: 'T2_ROLLUP_5M',
      needsStitching: false
    },
    {
      label: '10 days range crossing T1/T2 seam (starts 10d ago, ends now)',
      from: new Date(referenceNow.getTime() - 10 * 24 * 3600 * 1000),
      to: referenceNow,
      expectedTier: 'STITCHED_T1_T2',
      needsStitching: true
    },
    {
      label: '30 days range (between 7d and 90d ago)',
      from: new Date(referenceNow.getTime() - 37 * 24 * 3600 * 1000),
      to: new Date(referenceNow.getTime() - 7 * 24 * 3600 * 1000),
      expectedTier: 'T2_ROLLUP_5M',
      needsStitching: false
    },
    {
      label: '6 months range crossing T2/T3 seam (starts 180d ago, ends now)',
      from: new Date(referenceNow.getTime() - 180 * 24 * 3600 * 1000),
      to: referenceNow,
      expectedTier: 'STITCHED_T2_T3',
      needsStitching: true
    },
    {
      label: '1 year range (historical older than 90d)',
      from: new Date(referenceNow.getTime() - 365 * 24 * 3600 * 1000),
      to: new Date(referenceNow.getTime() - 100 * 24 * 3600 * 1000),
      expectedTier: 'T3_ROLLUP_1H',
      needsStitching: false
    }
  ];

  for (const tc of testCases) {
    it(`correctly plans route for: ${tc.label}`, () => {
      const plan = QueryRouter.planRoute({
        deviceId: 'dev-test',
        metric: 'temperature_c',
        from: tc.from,
        to: tc.to,
        maxPoints: 1000,
        now: referenceNow
      });

      expect(plan.tier).toBe(tc.expectedTier);
      expect(plan.needsStitching).toBe(tc.needsStitching);

      if (tc.needsStitching) {
        expect(plan.seam).toBeDefined();
        // Seam must be strictly within [from, to]
        expect(plan.seam!.getTime()).toBeGreaterThan(tc.from.getTime());
        expect(plan.seam!.getTime()).toBeLessThan(tc.to.getTime());
      }
    });
  }
});
