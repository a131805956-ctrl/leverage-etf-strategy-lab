import { describe, expect, it } from 'vitest';

import { normalizeStrategyConfig } from '../src/core/strategyConfig';

const legacyStrategy = {
  id: 'balanced-drawdown',
  name: '回撤策略',
  pairId: 'tw50',
  baseLeveragedWeight: 70,
  highLeveragedWeight: 70,
  drawdownRules: [
    { threshold: 10, leveragedWeight: 80 },
    { threshold: 20, leveragedWeight: 90 },
  ],
  recoveryRules: [
    { distanceToHigh: 10, leveragedWeight: 80 },
  ],
  recoveryConfirmationPct: 5,
  dividendMode: 'total-return' as const,
  execution: 'next-open' as const,
  costs: {
    enabled: false,
    commissionRate: 0,
    sellTaxRate: 0,
    slippageRate: 0,
    minimumCommission: 0,
  },
};

describe('normalizeStrategyConfig', () => {
  it('migrates event strategies to exact-target with no forced rebalance', () => {
    const normalized = normalizeStrategyConfig({
      ...legacyStrategy,
      rebalance: { mode: 'event', driftThreshold: 5 },
    });

    expect(normalized.allocationPolicy).toBe('exact-target');
    expect(normalized.rebalance).toEqual({
      mode: 'none',
      driftThreshold: 5,
    });
  });

  it.each([
    ['daily', 1],
    ['weekly', 7],
  ] as const)('migrates %s to a calendar interval', (mode, intervalDays) => {
    const normalized = normalizeStrategyConfig({
      ...legacyStrategy,
      rebalance: { mode, driftThreshold: 5 },
    });

    expect(normalized.rebalance).toMatchObject({
      mode: 'calendar-interval',
      intervalDays,
    });
  });

  it.each([
    ['event', 'none', undefined],
    ['daily', 'calendar-interval', 1],
    ['weekly', 'calendar-interval', 7],
  ] as const)(
    'preserves extra rebalance fields without mutating a %s strategy',
    (mode, normalizedMode, intervalDays) => {
      const input = {
        ...legacyStrategy,
        rebalance: {
          mode,
          driftThreshold: 5,
          futureOption: { retain: true },
        },
      };
      const original = structuredClone(input);

      const normalized = normalizeStrategyConfig(input);

      expect(normalized.rebalance).toEqual({
        mode: normalizedMode,
        ...(intervalDays === undefined ? {} : { intervalDays }),
        driftThreshold: 5,
        futureOption: { retain: true },
      });
      expect(input).toEqual(original);
      expect(normalized).not.toBe(input);
      expect(normalized.rebalance).not.toBe(input.rebalance);
    },
  );

  it('treats an undefined allocation policy as missing', () => {
    const normalized = normalizeStrategyConfig({
      ...legacyStrategy,
      allocationPolicy: undefined,
      rebalance: { mode: 'none', driftThreshold: 5 },
    });

    expect(normalized.allocationPolicy).toBe('exact-target');
  });
});
