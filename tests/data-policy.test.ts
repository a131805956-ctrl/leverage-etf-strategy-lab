import { describe, expect, it } from 'vitest';

import {
  needsRefresh,
  requiredCutoff,
  requiredTradingCutoff,
} from '../src/data/freshness';

describe('monthly refresh policy', () => {
  it('requires the final calendar day of the previous month', () => {
    expect(requiredCutoff(new Date('2026-08-01T00:00:00+08:00'))).toBe('2026-07-31');
  });

  it('does not refresh data already covering the required trading cutoff', () => {
    expect(needsRefresh('2026-07-31', new Date('2026-08-01T00:00:00+08:00'))).toBe(false);
  });

  it('refreshes stale weekday data', () => {
    expect(needsRefresh('2026-07-30', new Date('2026-08-01T00:00:00+08:00'))).toBe(true);
  });

  it('moves a weekend cutoff back to Friday', () => {
    expect(requiredTradingCutoff(new Date('2026-06-01T00:00:00+08:00'))).toBe('2026-05-29');
  });
});
