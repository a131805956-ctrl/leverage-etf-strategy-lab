import { describe, expect, it } from 'vitest';

import { advanceRegime, initialRegime } from '../src/core/regime';
import { resolveAllocationRule } from '../src/core/rules';
import type { IsoDate, StrategyConfig } from '../src/core/types';

const strategy: StrategyConfig = {
  id: 'test',
  name: 'test',
  pairId: 'tw50',
  allocationPolicy: 'exact-target',
  baseLeveragedWeight: 60,
  highLeveragedWeight: 70,
  drawdownRules: [
    { threshold: 10, leveragedWeight: 80 },
    { threshold: 20, leveragedWeight: 100 },
  ],
  recoveryRules: [
    { distanceToHigh: 20, leveragedWeight: 85 },
    { distanceToHigh: 10, leveragedWeight: 70 },
  ],
  recoveryConfirmationPct: 5,
  rebalance: { mode: 'none', driftThreshold: 5 },
  dividendMode: 'total-return',
  execution: 'next-open',
  costs: {
    enabled: false,
    commissionRate: 0,
    sellTaxRate: 0,
    slippageRate: 0,
    minimumCommission: 0,
  },
};

const date = (day: number): IsoDate => `2024-01-${String(day).padStart(2, '0')}` as IsoDate;

describe('market regime', () => {
  it('starts at a known high', () => {
    const state = initialRegime(100, date(1));
    expect(state.regime).toBe('AT_HIGH');
    expect(state.drawdownPct).toBe(0);
  });

  it('enters decline and updates the trough using only observed prices', () => {
    const high = initialRegime(100, date(1));
    const decline = advanceRegime(high, 90, date(2), 5);
    const lower = advanceRegime(decline, 80, date(3), 5);
    expect(lower.regime).toBe('DECLINE');
    expect(lower.trough).toBe(80);
    expect(lower.drawdownPct).toBeCloseTo(20);
  });

  it('enters recovery after rebounding from the observed trough', () => {
    const high = initialRegime(100, date(1));
    const decline = advanceRegime(high, 80, date(2), 5);
    const recovery = advanceRegime(decline, 84, date(3), 5);
    expect(recovery.regime).toBe('RECOVERY');
    expect(recovery.reboundPct).toBeCloseTo(5);
    expect(recovery.distanceToHighPct).toBeCloseTo(16);
  });

  it('resets state when a new high is observed', () => {
    const decline = advanceRegime(initialRegime(100, date(1)), 80, date(2), 5);
    const recovery = advanceRegime(decline, 90, date(3), 5);
    const nextHigh = advanceRegime(recovery, 101, date(4), 5);
    expect(nextHigh.regime).toBe('AT_HIGH');
    expect(nextHigh.runningHigh).toBe(101);
    expect(nextHigh.trough).toBe(101);
  });
});

describe('allocation rules', () => {
  it('emits a stable key at a new high', () => {
    expect(resolveAllocationRule(strategy, initialRegime(100, date(1)))).toEqual({
      ruleKey: 'new-high',
      leveragedWeight: 70,
      reason: 'NEW_HIGH',
    });
  });

  it('does not fall back to the initial weight below the first drawdown step', () => {
    const state = advanceRegime(initialRegime(100, date(1)), 95, date(2), 5);
    expect(resolveAllocationRule(strategy, state)).toBeUndefined();
  });

  it('emits a stable key for the deepest reached drawdown step', () => {
    const state = advanceRegime(initialRegime(100, date(1)), 80, date(2), 5);
    expect(resolveAllocationRule(strategy, state)).toEqual({
      ruleKey: 'drawdown:20',
      leveragedWeight: 100,
      reason: 'DRAWDOWN',
    });
  });

  it('emits a recovery key without a drawdown fallback', () => {
    const decline = advanceRegime(initialRegime(100, date(1)), 75, date(2), 5);
    const recovery = advanceRegime(decline, 80, date(3), 5);
    expect(recovery.regime).toBe('RECOVERY');
    expect(resolveAllocationRule(strategy, recovery)).toEqual({
      ruleKey: 'recovery:20',
      leveragedWeight: 85,
      reason: 'RECOVERY',
    });
  });

  it('returns undefined when no recovery rule applies', () => {
    const decline = advanceRegime(initialRegime(100, date(1)), 75, date(2), 5);
    const recovery = advanceRegime(decline, 78.75, date(3), 5);
    expect(recovery.regime).toBe('RECOVERY');
    expect(resolveAllocationRule(strategy, recovery)).toBeUndefined();
  });

  it('does not mutate configured rule arrays while resolving events', () => {
    const before = structuredClone(strategy);
    const decline = advanceRegime(initialRegime(100, date(1)), 80, date(2), 5);
    const recovery = advanceRegime(decline, 84, date(3), 5);

    resolveAllocationRule(strategy, decline);
    resolveAllocationRule(strategy, recovery);

    expect(strategy.drawdownRules).toEqual(before.drawdownRules);
    expect(strategy.recoveryRules).toEqual(before.recoveryRules);
  });
});
