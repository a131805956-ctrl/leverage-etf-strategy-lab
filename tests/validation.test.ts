import { describe, expect, it } from 'vitest';

import { validateStrategy } from '../src/core/validation';
import type { StrategyConfig } from '../src/core/types';

const validStrategy: StrategyConfig = {
  id: 'balanced-drawdown',
  name: '回撤階梯',
  pairId: 'tw50',
  allocationPolicy: 'exact-target',
  baseLeveragedWeight: 70,
  highLeveragedWeight: 70,
  drawdownRules: [
    { threshold: 10, leveragedWeight: 80 },
    { threshold: 20, leveragedWeight: 90 },
    { threshold: 30, leveragedWeight: 100 },
  ],
  recoveryRules: [
    { distanceToHigh: 20, leveragedWeight: 90 },
    { distanceToHigh: 10, leveragedWeight: 80 },
    { distanceToHigh: 5, leveragedWeight: 70 },
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

describe('validateStrategy', () => {
  it('accepts a valid strategy', () => {
    expect(validateStrategy(validStrategy)).toEqual([]);
  });

  it.each(['minimum-floor', 'exact-target'] as const)(
    'accepts the %s allocation policy',
    (allocationPolicy) => {
      expect(
        validateStrategy({ ...validStrategy, allocationPolicy }),
      ).toEqual([]);
    },
  );

  it('rejects an unknown allocation policy', () => {
    expect(
      validateStrategy({
        ...validStrategy,
        allocationPolicy: 'unknown',
      } as unknown as StrategyConfig),
    ).toContain('配置政策必須是最低底線或精確目標');
  });

  it('requires an allocation policy', () => {
    expect(
      validateStrategy({
        ...validStrategy,
        allocationPolicy: undefined,
      } as unknown as StrategyConfig),
    ).toContain('配置政策必須是最低底線或精確目標');
  });

  it('rejects weights outside 0 to 100', () => {
    const strategy = { ...validStrategy, baseLeveragedWeight: 101 };
    expect(validateStrategy(strategy)).toContain('基礎槓桿 ETF 權重必須介於 0% 到 100%');
  });

  it('rejects duplicate drawdown thresholds', () => {
    const strategy = {
      ...validStrategy,
      drawdownRules: [
        ...validStrategy.drawdownRules,
        { threshold: 20, leveragedWeight: 95 },
      ],
    };
    expect(validateStrategy(strategy)).toContain('回撤門檻不可重複');
  });

  it('requires the next-open execution model', () => {
    const strategy = {
      ...validStrategy,
      execution: 'same-close',
    } as unknown as StrategyConfig;
    expect(validateStrategy(strategy)).toContain('正式回測只允許下一交易日開盤成交');
  });

  it('rejects a non-positive calendar interval', () => {
    expect(
      validateStrategy({
        ...validStrategy,
        rebalance: {
          mode: 'calendar-interval',
          intervalDays: 0,
          driftThreshold: 5,
        },
      } as unknown as StrategyConfig),
    ).toContain('日曆天再平衡必須是正整數');
  });

  it('rejects a fractional calendar interval', () => {
    expect(
      validateStrategy({
        ...validStrategy,
        rebalance: {
          mode: 'calendar-interval',
          intervalDays: 1.5,
          driftThreshold: 5,
        },
      } as unknown as StrategyConfig),
    ).toContain('日曆天再平衡必須是正整數');
  });

  it.each([0, -1, 51, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an unsafe drift threshold of %s',
    (driftThreshold) => {
      expect(
        validateStrategy({
          ...validStrategy,
          rebalance: {
            mode: 'drift',
            driftThreshold,
          },
        }),
      ).toContain('權重偏離門檻必須大於 0 且不超過 50 個百分點');
    },
  );
});
