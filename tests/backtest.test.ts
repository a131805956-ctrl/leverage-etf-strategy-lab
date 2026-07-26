import { describe, expect, it } from 'vitest';

import { runBacktest } from '../src/core/backtest';
import type {
  BacktestInput,
  IsoDate,
  LegacyStrategyConfig,
  MarketSeries,
  PriceBar,
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

const strategy: LegacyStrategyConfig = {
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

const legacySchedulingStrategy = (
  mode: Extract<LegacyStrategyConfig['rebalance']['mode'], 'daily' | 'weekly'>,
): LegacyStrategyConfig => ({
  ...strategy,
  drawdownRules: [],
  recoveryRules: [],
  rebalance: { mode, driftThreshold: 5 },
});

const seriesForDates = (symbol: string, dates: IsoDate[]): MarketSeries => ({
  symbol,
  bars: dates.map((date) => bar(date, 100, 100)),
  dividends: [],
});

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

  it('anchors calendar intervals to the first common trading date', () => {
    const dates = ['2024-01-01', '2024-01-03', '2024-01-30', '2024-01-31', '2024-02-05'] as const;
    const calendarPrototype: MarketSeries = {
      symbol: 'BASE',
      bars: dates.map((date) => bar(date, 100, 100)),
      dividends: [],
    };
    const calendarLeveraged: MarketSeries = {
      symbol: 'LEV',
      bars: dates
        .filter((date) => date !== '2024-01-01')
        .map((date) => bar(date, 100, 100)),
      dividends: [],
    };

    const result = runBacktest(
      input({
        prototype: calendarPrototype,
        leveraged: calendarLeveraged,
        startDate: '2024-01-01',
        endDate: '2024-02-05',
        strategy: {
          ...strategy,
          allocationPolicy: 'exact-target',
          drawdownRules: [],
          recoveryRules: [],
          rebalance: {
            mode: 'calendar-interval',
            intervalDays: 30,
            driftThreshold: 5,
          },
        },
      }),
    );

    expect(result.startDate).toBe('2024-01-03');
    expect(
      result.trades.find((trade) => trade.reason === 'SCHEDULED_REBALANCE')?.date,
    ).toBe('2024-02-05');
  });

  it('normalizes legacy daily scheduling at the backtest entry boundary', () => {
    const dates: IsoDate[] = ['2024-01-01', '2024-01-02', '2024-01-03'];
    const result = runBacktest(
      input({
        prototype: seriesForDates('BASE', dates),
        leveraged: seriesForDates('LEV', dates),
        strategy: legacySchedulingStrategy('daily'),
      }),
    );

    expect(result.strategy.rebalance).toMatchObject({
      mode: 'calendar-interval',
      intervalDays: 1,
    });
    expect(
      result.trades
        .filter((trade) => trade.reason === 'SCHEDULED_REBALANCE')
        .map((trade) => trade.date),
    ).toEqual(['2024-01-02', '2024-01-03']);
  });

  it('normalizes legacy weekly scheduling at the backtest entry boundary', () => {
    const dates: IsoDate[] = ['2024-01-01', '2024-01-05', '2024-01-08'];
    const result = runBacktest(
      input({
        prototype: seriesForDates('BASE', dates),
        leveraged: seriesForDates('LEV', dates),
        endDate: '2024-01-08',
        strategy: legacySchedulingStrategy('weekly'),
      }),
    );

    expect(result.strategy.rebalance).toMatchObject({
      mode: 'calendar-interval',
      intervalDays: 7,
    });
    expect(
      result.trades
        .filter((trade) => trade.reason === 'SCHEDULED_REBALANCE')
        .map((trade) => trade.date),
    ).toEqual(['2024-01-08']);
  });

  it('executes one scheduled rebalance after a sparse row crosses multiple buckets', () => {
    const dates: IsoDate[] = ['2024-01-01', '2024-01-20'];
    const result = runBacktest(
      input({
        prototype: seriesForDates('BASE', dates),
        leveraged: seriesForDates('LEV', dates),
        endDate: '2024-01-20',
        strategy: {
          ...strategy,
          allocationPolicy: 'exact-target',
          drawdownRules: [],
          recoveryRules: [],
          rebalance: {
            mode: 'calendar-interval',
            intervalDays: 7,
            driftThreshold: 5,
          },
        },
      }),
    );

    expect(
      result.trades.filter((trade) => trade.reason === 'SCHEDULED_REBALANCE'),
    ).toHaveLength(1);
    expect(
      result.trades.find((trade) => trade.reason === 'SCHEDULED_REBALANCE')?.date,
    ).toBe('2024-01-20');
  });

  it('holds cash dividends until an explicit reinvestment date', () => {
    const withDividend: MarketSeries = {
      ...prototype,
      dividends: [{ date: '2024-01-02', amountPerShare: 10 }],
    };
    const cashStrategy: LegacyStrategyConfig = {
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
