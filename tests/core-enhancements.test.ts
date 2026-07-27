import { describe, expect, it } from 'vitest';

import { earliestCommonDate, runBacktest } from '../src/core/backtest';
import { buildExposureEvents } from '../src/core/events';
import { resolveAllocationRule } from '../src/core/rules';
import { createOptimizationCandidate } from '../src/optimization/gridSearch';
import type {
  DailyPoint,
  IsoDate,
  MarketSeries,
  PriceBar,
  StrategyConfig,
  TradeRecord,
} from '../src/core/types';

const bar = (date: IsoDate, close: number): PriceBar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  adjustedClose: close,
  volume: 1,
});

const strategy: StrategyConfig = {
  id: 'enhancements',
  name: 'Enhancements',
  pairId: 'pair',
  allocationPolicy: 'exact-target',
  baseLeveragedWeight: 60,
  highLeveragedWeight: 70,
  drawdownRules: [
    { threshold: 10, leveragedWeight: 80 },
    { threshold: 20, leveragedWeight: 90 },
    { threshold: 30, leveragedWeight: 100 },
  ],
  reductionReference: 'prototype-rebound',
  reductionRules: [
    { threshold: 5, leveragedWeight: 65 },
    { threshold: 15, leveragedWeight: 55 },
  ],
  recoveryRules: [],
  recoveryConfirmationPct: 5,
  rebalance: { mode: 'none', driftThreshold: 5 },
  dividendMode: 'price-only',
  execution: 'next-open',
  costs: {
    enabled: false,
    commissionRate: 0,
    sellTaxRate: 0,
    slippageRate: 0,
    minimumCommission: 0,
  },
};

const input = (overrides: Partial<Parameters<typeof runBacktest>[0]> = {}) => {
  const dates = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'] as IsoDate[];
  const prototype: MarketSeries = {
    symbol: 'BASE',
    bars: dates.map((date, index) => bar(date, [100, 90, 80, 88][index] ?? 88)),
    dividends: [],
  };
  const leveraged: MarketSeries = {
    symbol: 'LEV',
    bars: dates.map((date, index) => bar(date, [100, 80, 60, 72][index] ?? 72)),
    dividends: [],
  };
  return {
    pair: {
      id: 'pair',
      name: 'Pair',
      market: 'test',
      prototype: { symbol: 'BASE', name: 'Base' },
      leveraged: { symbol: 'LEV', name: 'Lev', nominalLeverage: 2 },
    },
    strategy,
    prototype,
    leveraged,
    startDate: '2024-01-01' as IsoDate,
    endDate: '2024-01-04' as IsoDate,
    initialCapital: 1_000,
    ...overrides,
  };
};

describe('core enhancements', () => {
  it('finds the earliest date shared by both market series', () => {
    const series = (dates: IsoDate[]): MarketSeries => ({
      symbol: 'x',
      bars: dates.map((date) => bar(date, 100)),
      dividends: [],
    });
    expect(
      earliestCommonDate(
        series(['2024-01-03', '2024-01-05']),
        series(['2024-01-01', '2024-01-05']),
      ),
    ).toBe('2024-01-05');
  });

  it('resolves a leveraged rebound reduction using the configured reduction steps', () => {
    const state = {
      regime: 'RECOVERY' as const,
      runningHigh: 100,
      runningHighDate: '2024-01-01' as IsoDate,
      trough: 70,
      troughDate: '2024-01-02' as IsoDate,
      drawdownPct: 16,
      reboundPct: 8,
      leveragedReboundPct: 16,
      distanceToHighPct: 16,
    };
    const event = resolveAllocationRule(
      { ...strategy, reductionReference: 'leveraged-rebound' },
      state,
    );
    expect(event).toMatchObject({
      reason: 'RECOVERY',
      leveragedWeight: 55,
      ruleKey: 'reduction:15',
    });
  });

  it('records trade share deltas and post-trade values', () => {
    const result = runBacktest(input());
    const initial = result.trades[0];
    expect(initial).toMatchObject({
      reason: 'INITIAL',
      leveragedSharesBought: 6,
      prototypeSharesBought: 4,
      prototypeSharesSold: 0,
      leveragedSharesSold: 0,
      totalValueAfter: 1_000,
    });
    expect(initial?.prototypePrice).toBe(100);
    expect(initial?.leveragedPrice).toBe(100);
  });

  it('builds a pink-markable exposure event from add through first reduction', () => {
    const points: DailyPoint[] = [
      { date: '2024-01-01', value: 100, prototypeValue: 40, leveragedValue: 60, cash: 0, prototypeWeight: 40, leveragedWeight: 60, targetLeveragedWeight: 70, nominalExposure: 160, drawdown: 0, regime: 'AT_HIGH', benchmarkPrototype: 100, benchmarkLeveraged: 100 },
      { date: '2024-01-02', value: 95, prototypeValue: 38, leveragedValue: 57, cash: 0, prototypeWeight: 40, leveragedWeight: 60, targetLeveragedWeight: 80, nominalExposure: 160, drawdown: 5, regime: 'DECLINE', benchmarkPrototype: 95, benchmarkLeveraged: 90 },
      { date: '2024-01-03', value: 110, prototypeValue: 44, leveragedValue: 66, cash: 0, prototypeWeight: 40, leveragedWeight: 60, targetLeveragedWeight: 65, nominalExposure: 160, drawdown: 0, regime: 'RECOVERY', benchmarkPrototype: 110, benchmarkLeveraged: 120 },
    ];
    const trades: TradeRecord[] = [
      { date: '2024-01-02', reason: 'DRAWDOWN', prototypeValueBefore: 40, leveragedValueBefore: 60, cashBefore: 0, targetLeveragedWeight: 80, tradedValue: 20, cost: 0, note: '', leveragedSharesBought: 1, prototypeSharesBought: 0 },
      { date: '2024-01-03', reason: 'RECOVERY', prototypeValueBefore: 38, leveragedValueBefore: 76, cashBefore: 0, targetLeveragedWeight: 65, tradedValue: 12, cost: 0, note: '', leveragedSharesSold: 1, prototypeSharesBought: 0 },
    ];
    const events = buildExposureEvents(points, trades);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      startDate: '2024-01-01',
      endDate: '2024-01-03',
      addTrades: [trades[0]],
      reductionTrades: [trades[1]],
    });
    expect(events[0]?.stages.length).toBeGreaterThan(0);
  });

  it('quick optimization candidates use normal leverage for both base and high and disable rebalance', () => {
    const candidate = createOptimizationCandidate(strategy, {
      normal: 75,
      dd10: 80,
      dd20: 90,
    });
    expect(candidate.baseLeveragedWeight).toBe(75);
    expect(candidate.highLeveragedWeight).toBe(75);
    expect(candidate.rebalance.mode).toBe('none');
  });
});
