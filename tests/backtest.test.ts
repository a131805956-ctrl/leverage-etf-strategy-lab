import { describe, expect, it } from 'vitest';

import { runBacktest } from '../src/core/backtest';
import type {
  BacktestInput,
  IsoDate,
  MarketSeries,
  PriceBar,
  StrategyConfig,
} from '../src/core/types';

const bar = (
  date: IsoDate,
  open: number,
  close: number,
  adjustedClose = close,
): PriceBar => ({
  date,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
  adjustedClose,
  volume: 1_000,
});

const prototype: MarketSeries = {
  symbol: 'BASE',
  bars: [
    bar('2024-01-01', 100, 100),
    bar('2024-01-02', 100, 80),
    bar('2024-01-03', 80, 80),
    bar('2024-01-04', 80, 88),
  ],
  dividends: [],
};

const leveraged: MarketSeries = {
  symbol: 'LEV',
  bars: [
    bar('2024-01-01', 100, 100),
    bar('2024-01-02', 100, 60),
    bar('2024-01-03', 60, 60),
    bar('2024-01-04', 60, 72),
  ],
  dividends: [],
};

const strategy: StrategyConfig = {
  id: 'switch',
  name: 'Switch',
  pairId: 'pair',
  baseLeveragedWeight: 0,
  highLeveragedWeight: 0,
  drawdownRules: [{ threshold: 10, leveragedWeight: 100 }],
  recoveryRules: [{ distanceToHigh: 15, leveragedWeight: 0 }],
  recoveryConfirmationPct: 5,
  rebalance: { mode: 'event', driftThreshold: 5 },
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

const input = (
  overrides: Partial<BacktestInput> = {},
): BacktestInput => ({
  pair: {
    id: 'pair',
    name: 'Pair',
    market: 'Test',
    prototype: { symbol: 'BASE', name: 'Base' },
    leveraged: { symbol: 'LEV', name: 'Lev', nominalLeverage: 2 },
  },
  strategy,
  prototype,
  leveraged,
  startDate: '2024-01-01',
  endDate: '2024-01-04',
  initialCapital: 1_000,
  ...overrides,
});

describe('runBacktest', () => {
  it('executes a close signal at the next trading day open', () => {
    const result = runBacktest(input());
    const drawdownTrade = result.trades.find((trade) => trade.reason === 'DRAWDOWN');
    expect(drawdownTrade?.date).toBe('2024-01-03');
    expect(result.points.find((point) => point.date === '2024-01-02')?.leveragedWeight).toBe(0);
    expect(result.points.find((point) => point.date === '2024-01-03')?.leveragedWeight).toBeCloseTo(100);
  });

  it('uses historical bars before the selected start without investing before it', () => {
    const result = runBacktest(
      input({ startDate: '2024-01-03', endDate: '2024-01-04' }),
    );
    expect(result.points[0]?.date).toBe('2024-01-03');
    expect(result.points[0]?.leveragedWeight).toBeCloseTo(100);
    expect(result.trades[0]?.reason).toBe('INITIAL');
  });

  it('anchors a non-common requested date to the first common trading date', () => {
    const result = runBacktest(
      input({
        leveraged: {
          ...leveraged,
          bars: leveraged.bars.filter((item) => item.date !== '2024-01-02'),
        },
        startDate: '2024-01-02',
        endDate: '2024-01-04',
      }),
    );

    expect(result.startDate).toBe('2024-01-03');
    expect(result.points[0]?.date).toBe('2024-01-03');
    expect(result.trades[0]?.date).toBe('2024-01-03');
  });

  it('holds cash dividends until an explicit reinvestment date', () => {
    const withDividend: MarketSeries = {
      ...prototype,
      dividends: [{ date: '2024-01-02', amountPerShare: 10 }],
    };
    const cashStrategy: StrategyConfig = {
      ...strategy,
      drawdownRules: [],
      dividendMode: 'cash',
    };
    const result = runBacktest(
      input({
        prototype: withDividend,
        strategy: cashStrategy,
        dividendReinvestments: [
          { date: '2024-01-03', target: 'prototype' },
        ],
      }),
    );
    expect(result.points.find((point) => point.date === '2024-01-02')?.cash).toBeGreaterThan(0);
    expect(result.points.find((point) => point.date === '2024-01-03')?.cash).toBeCloseTo(0);
    expect(result.trades.some((trade) => trade.reason === 'DIVIDEND_REINVEST')).toBe(true);
  });

  it('keeps non-dividend capital fully invested', () => {
    const result = runBacktest(input());
    for (const point of result.points) {
      expect(point.prototypeWeight + point.leveragedWeight).toBeCloseTo(100);
    }
  });
});
