import { describe, expect, it } from 'vitest';

import {
  coversCutoffMonth,
  needsRefresh,
  requiredCutoff,
} from '../src/data/freshness';

describe('monthly refresh policy', () => {
  it('requires the final calendar day of the previous month', () => {
    expect(requiredCutoff(new Date('2026-08-01T00:00:00+08:00'))).toBe('2026-07-31');
  });

  it('does not refresh a snapshot already generated through the required month', () => {
    expect(needsRefresh('2026-07-31', new Date('2026-08-01T00:00:00+08:00'))).toBe(false);
  });

  it('refreshes a snapshot whose declared coverage is still the prior month', () => {
    expect(needsRefresh('2026-06-30', new Date('2026-08-01T00:00:00+08:00'))).toBe(true);
  });

  it('accepts a holiday-shortened month when the final bar is in the cutoff month', () => {
    expect(coversCutoffMonth('2025-01-22', '2025-01-31')).toBe(true);
    expect(coversCutoffMonth('2024-12-31', '2025-01-31')).toBe(false);
  });
});
