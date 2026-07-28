import { describe, expect, it } from 'vitest';

import { runBacktest } from '../src/core/backtest';
import type {
  BacktestInput,
  IsoDate,
  LegacyStrategyConfig,
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

const profitRunStrategy = (
  overrides: Partial<StrategyConfig> = {},
): StrategyConfig => ({
  id: 'profit-run',
  name: 'Profit run',
  pairId: 'pair',
  allocationPolicy: 'minimum-floor',
  baseLeveragedWeight: 60,
  highLeveragedWeight: 70,
  drawdownRules: [{ threshold: 10, leveragedWeight: 80 }],
  recoveryRules: [{ distanceToHigh: 20, leveragedWeight: 70 }],
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
  ...overrides,
});

const pathSeries = (
  symbol: string,
  rows: Array<[IsoDate, number, number]>,
): MarketSeries => ({
  symbol,
  bars: rows.map(([date, open, close]) => bar(date, open, close)),
  dividends: [],
});

const profitRunInput = (): BacktestInput =>
  input({
    strategy: profitRunStrategy(),
    prototype: pathSeries('BASE', [
      ['2024-01-01', 100, 100],
      ['2024-01-02', 100, 101],
      ['2024-01-03', 101, 95.95],
      ['2024-01-04', 95.95, 95.95],
    ]),
    leveraged: pathSeries('LEV', [
      ['2024-01-01', 100, 100],
      ['2024-01-02', 100, 100],
      ['2024-01-03', 100, 100],
      ['2024-01-04', 100, 100],
    ]),
  });

const raisedFloorInput = (
  allocationPolicy: StrategyConfig['allocationPolicy'],
  leveragedDeclineClose: number,
  raisedFloor = 80,
): BacktestInput =>
  input({
    strategy: profitRunStrategy({
      allocationPolicy,
      highLeveragedWeight: 60,
      drawdownRules: [{ threshold: 10, leveragedWeight: raisedFloor }],
      recoveryRules: [],
    }),
    prototype: pathSeries('BASE', [
      ['2024-01-01', 100, 100],
      ['2024-01-02', 100, 89],
      ['2024-01-03', 89, 89],
    ]),
    leveraged: pathSeries('LEV', [
      ['2024-01-01', 100, 100],
      ['2024-01-02', 100, leveragedDeclineClose],
      ['2024-01-03', leveragedDeclineClose, leveragedDeclineClose],
    ]),
    endDate: '2024-01-03',
  });

const alreadyAboveFloorInput = (
  allocationPolicy: StrategyConfig['allocationPolicy'] = 'minimum-floor',
): BacktestInput => raisedFloorInput(allocationPolicy, 300);

const costEnabledAboveFloorInput = (): BacktestInput => {
  const aboveFloor = alreadyAboveFloorInput();
  return {
    ...aboveFloor,
    strategy: profitRunStrategy({
      highLeveragedWeight: 60,
      drawdownRules: [{ threshold: 10, leveragedWeight: 80 }],
      recoveryRules: [],
      costs: {
        enabled: true,
        commissionRate: 0,
        sellTaxRate: 0.01,
        slippageRate: 0,
        minimumCommission: 0,
      },
    }),
  };
};

const cashAboveFloorInput = (
  overrides: Partial<StrategyConfig> = {},
): BacktestInput =>
  input({
    strategy: profitRunStrategy({
      baseLeveragedWeight: 60,
      highLeveragedWeight: 70,
      drawdownRules: [],
      recoveryRules: [],
      dividendMode: 'cash',
      ...overrides,
    }),
    prototype: {
      ...pathSeries('BASE', [
        ['2024-01-01', 100, 100],
        ['2024-01-02', 100, 100],
        ['2024-01-03', 100, 100],
      ]),
      dividends: [{ date: '2024-01-02', amountPerShare: 25 }],
    },
    leveraged: pathSeries('LEV', [
      ['2024-01-01', 100, 100],
      ['2024-01-02', 200, 200],
      ['2024-01-03', 200, 200],
    ]),
    endDate: '2024-01-03',
    dividendReinvestments: [
      { date: '2024-01-03', target: 'target-allocation' },
    ],
  });

const belowRaisedFloorInput = (): BacktestInput =>
  raisedFloorInput('minimum-floor', 50, 90);

const recoveryFloorInput = (
  rebalance: StrategyConfig['rebalance'] = {
    mode: 'none',
    driftThreshold: 5,
  },
): BacktestInput =>
  input({
    strategy: profitRunStrategy({
      baseLeveragedWeight: 80,
      highLeveragedWeight: 80,
      drawdownRules: [{ threshold: 10, leveragedWeight: 90 }],
      rebalance,
    }),
    prototype: pathSeries('BASE', [
      ['2024-01-01', 100, 100],
      ['2024-01-02', 100, 80],
      ['2024-01-03', 80, 84],
      ['2024-01-04', 84, 84],
    ]),
    leveraged: pathSeries('LEV', [
      ['2024-01-01', 100, 100],
      ['2024-01-02', 100, 100],
      ['2024-01-03', 100, 100],
      ['2024-01-04', 100, 100],
    ]),
  });

const unchangedFloorDriftInput = (): BacktestInput =>
  input({
    strategy: profitRunStrategy({
      highLeveragedWeight: 60,
      recoveryRules: [],
    }),
    prototype: pathSeries('BASE', [
      ['2024-01-01', 100, 100],
      ['2024-01-02', 100, 89],
      ['2024-01-03', 89, 85],
      ['2024-01-04', 85, 85],
    ]),
    leveraged: pathSeries('LEV', [
      ['2024-01-01', 100, 100],
      ['2024-01-02', 100, 50],
      ['2024-01-03', 50, 25],
      ['2024-01-04', 25, 25],
    ]),
  });

const reenteredRuleInput = (): BacktestInput =>
  input({
    strategy: profitRunStrategy({
      highLeveragedWeight: 60,
      recoveryRules: [],
      recoveryConfirmationPct: 50,
    }),
    prototype: pathSeries('BASE', [
      ['2024-01-01', 100, 100],
      ['2024-01-02', 100, 89],
      ['2024-01-03', 89, 95],
      ['2024-01-04', 95, 89],
      ['2024-01-05', 89, 89],
    ]),
    leveraged: pathSeries('LEV', [
      ['2024-01-01', 100, 100],
      ['2024-01-02', 100, 50],
      ['2024-01-03', 50, 25],
      ['2024-01-04', 25, 20],
      ['2024-01-05', 20, 20],
    ]),
    endDate: '2024-01-05',
  });

const coincidentScheduleInput = (): BacktestInput =>
  input({
    strategy: profitRunStrategy({
      highLeveragedWeight: 60,
      recoveryRules: [],
      rebalance: { mode: 'monthly', driftThreshold: 5 },
    }),
    prototype: pathSeries('BASE', [
      ['2024-01-30', 100, 100],
      ['2024-01-31', 100, 89],
      ['2024-02-01', 89, 89],
    ]),
    leveraged: pathSeries('LEV', [
      ['2024-01-30', 100, 100],
      ['2024-01-31', 100, 50],
      ['2024-02-01', 50, 50],
    ]),
    startDate: '2024-01-30',
    endDate: '2024-02-01',
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
    expect(result.points[0]?.leveragedWeight).toBeCloseTo(0);
    expect(result.trades[0]?.reason).toBe('INITIAL');
  });

  it('uses the initial weight once and never falls back after a new high', () => {
    const result = runBacktest(profitRunInput());

    expect(result.trades[0]).toMatchObject({
      reason: 'INITIAL',
      targetLeveragedWeight: 60,
    });
    expect(
      result.trades.some(
        (trade, index) =>
          index > 0 && trade.targetLeveragedWeight === 60,
      ),
    ).toBe(false);
    expect(result.points.at(-1)?.targetLeveragedWeight).toBe(70);
  });

  it('does not sell when actual leveraged weight is above a higher floor', () => {
    const result = runBacktest(alreadyAboveFloorInput());

    expect(
      result.trades.filter((trade) => trade.reason === 'DRAWDOWN'),
    ).toHaveLength(0);
    expect(result.points.at(-1)?.targetLeveragedWeight).toBe(80);
    expect(result.metrics.tradeCount).toBe(1);
    expect(result.metrics.turnover).toBeCloseTo(100);
    expect(result.metrics.totalCosts).toBe(0);
  });

  it('does not count a no-op rule event as a trade or cost', () => {
    const result = runBacktest(costEnabledAboveFloorInput());

    expect(
      result.trades.filter((trade) => trade.reason === 'DRAWDOWN'),
    ).toHaveLength(0);
    expect(result.metrics).toMatchObject({
      tradeCount: 1,
      totalCosts: 0,
    });
  });

  it('does not mutate cash or charge a hidden fee below trade tolerance', () => {
    const initialCapital = 1e-12;
    const result = runBacktest(
      input({
        initialCapital,
        strategy: {
          ...profitRunStrategy({
            baseLeveragedWeight: 60,
            highLeveragedWeight: 60,
            drawdownRules: [],
            recoveryRules: [],
          }),
          costs: {
            enabled: true,
            commissionRate: 0,
            sellTaxRate: 0,
            slippageRate: 0,
            minimumCommission: 1,
          },
        },
      }),
    );

    expect(result.trades).toHaveLength(0);
    expect(result.points[0]).toMatchObject({
      cash: initialCapital,
      prototypeValue: 0,
      leveragedValue: 0,
      value: initialCapital,
    });
    expect(result.metrics).toMatchObject({
      finalValue: initialCapital,
      tradeCount: 0,
      turnover: 0,
      totalCosts: 0,
    });
  });

  it('buys only enough to reach a newly raised floor', () => {
    const result = runBacktest(belowRaisedFloorInput());
    const trade = result.trades.find((item) => item.reason === 'DRAWDOWN');

    expect(trade?.targetLeveragedWeight).toBe(90);
    expect(
      result.points.find((point) => point.date === trade?.date)
        ?.leveragedWeight,
    ).toBeCloseTo(90);
  });

  it('updates a lower recovery floor without selling', () => {
    const result = runBacktest(recoveryFloorInput());

    expect(result.points.at(-1)?.targetLeveragedWeight).toBe(70);
    expect(
      result.trades.some((trade) => trade.reason === 'RECOVERY'),
    ).toBe(false);
  });

  it('executes drift at the next open when a lower rule floor changes', () => {
    const result = runBacktest(
      recoveryFloorInput({ mode: 'drift', driftThreshold: 10 }),
    );
    const nextOpenTrades = result.trades.filter(
      (trade) => trade.date === '2024-01-04',
    );

    expect(nextOpenTrades).toHaveLength(1);
    expect(nextOpenTrades[0]).toMatchObject({
      reason: 'DRIFT_REBALANCE',
      targetLeveragedWeight: 70,
    });
    expect(
      result.points.find((point) => point.date === '2024-01-04')
        ?.leveragedWeight,
    ).toBeCloseTo(70);
  });

  it('does not micro-rebalance after weight drifts below an unchanged floor', () => {
    const result = runBacktest(unchangedFloorDriftInput());

    expect(
      result.trades.filter((trade) => trade.reason === 'DRAWDOWN'),
    ).toHaveLength(1);
    expect(result.points.at(-1)?.leveragedWeight).toBeLessThan(80);
  });

  it('allows the same keyed rule to trigger after an undefined interval', () => {
    const result = runBacktest(reenteredRuleInput());

    expect(
      result.trades
        .filter((trade) => trade.reason === 'DRAWDOWN')
        .map((trade) => trade.date),
    ).toEqual(['2024-01-03', '2024-01-05']);
  });

  it('fires each modern drawdown rung once per running-high episode', () => {
    const original = reenteredRuleInput();
    const result = runBacktest({
      ...original,
      strategy: {
        ...original.strategy,
        reductionRules: [],
        reductionReference: 'new-high-decline',
      },
    });

    expect(
      result.trades
        .filter((trade) => trade.reason === 'DRAWDOWN')
        .map((trade) => trade.date),
    ).toEqual(['2024-01-03']);
  });

  it('keeps exact-target allocation behavior for changed rule events', () => {
    const result = runBacktest(alreadyAboveFloorInput('exact-target'));
    const drawdownTrade = result.trades.find(
      (trade) => trade.reason === 'DRAWDOWN',
    );

    expect(drawdownTrade).toBeDefined();
    expect(
      result.points.find((point) => point.date === drawdownTrade?.date)
        ?.leveragedWeight,
    ).toBeCloseTo(80);
  });

  it('uses one exact scheduled trade at an updated coincident rule floor', () => {
    const result = runBacktest(coincidentScheduleInput());

    expect(
      result.trades.filter((trade) => trade.reason === 'DRAWDOWN'),
    ).toHaveLength(0);
    expect(
      result.trades.filter(
        (trade) => trade.reason === 'SCHEDULED_REBALANCE',
      ),
    ).toHaveLength(1);
    expect(
      result.trades.find(
        (trade) => trade.reason === 'SCHEDULED_REBALANCE',
      )?.targetLeveragedWeight,
    ).toBe(80);
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
        .map((date) => {
          if (date === '2024-01-31') return bar(date, 100, 110);
          if (date === '2024-02-05') return bar(date, 110, 110);
          return bar(date, 100, 100);
        }),
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
          baseLeveragedWeight: 50,
          highLeveragedWeight: 50,
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
    const dailyStrategy = legacySchedulingStrategy('daily');
    const result = runBacktest(
      input({
        prototype: seriesForDates('BASE', dates),
        leveraged: pathSeries('LEV', [
          ['2024-01-01', 100, 110],
          ['2024-01-02', 110, 120],
          ['2024-01-03', 120, 120],
        ]),
        strategy: {
          ...dailyStrategy,
          baseLeveragedWeight: 50,
          highLeveragedWeight: 50,
        },
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
    const weeklyStrategy = legacySchedulingStrategy('weekly');
    const result = runBacktest(
      input({
        prototype: seriesForDates('BASE', dates),
        leveraged: pathSeries('LEV', [
          ['2024-01-01', 100, 100],
          ['2024-01-05', 100, 110],
          ['2024-01-08', 110, 110],
        ]),
        endDate: '2024-01-08',
        strategy: {
          ...weeklyStrategy,
          baseLeveragedWeight: 50,
          highLeveragedWeight: 50,
        },
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
        leveraged: pathSeries('LEV', [
          ['2024-01-01', 100, 110],
          ['2024-01-20', 110, 110],
        ]),
        endDate: '2024-01-20',
        strategy: {
          ...strategy,
          allocationPolicy: 'exact-target',
          baseLeveragedWeight: 50,
          highLeveragedWeight: 50,
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
    const reinvestment = result.trades.find(
      (trade) => trade.reason === 'DIVIDEND_REINVEST',
    );
    expect(reinvestment).toMatchObject({
      prototypeValueBefore: 800,
      leveragedValueBefore: 0,
      cashBefore: 100,
    });
  });

  it('invests target-allocation cash without selling a leveraged winner', () => {
    const result = runBacktest(cashAboveFloorInput());
    const reinvestment = result.trades.find(
      (trade) => trade.reason === 'DIVIDEND_REINVEST',
    );

    expect(reinvestment).toMatchObject({
      prototypeValueBefore: 400,
      leveragedValueBefore: 1_200,
      cashBefore: 100,
      tradedValue: 100,
      cost: 0,
    });
    expect(result.points.at(-1)).toMatchObject({
      prototypeValue: 500,
      leveragedValue: 1_200,
      cash: 0,
    });
    expect(result.points.at(-1)?.leveragedWeight).toBeGreaterThan(70);
  });

  it('uses available cash for leveraged shares when the floor is underfunded', () => {
    const result = runBacktest(
      input({
        strategy: profitRunStrategy({
          baseLeveragedWeight: 60,
          highLeveragedWeight: 60,
          drawdownRules: [],
          recoveryRules: [],
          dividendMode: 'cash',
        }),
        prototype: {
          ...pathSeries('BASE', [
            ['2024-01-01', 100, 100],
            ['2024-01-02', 100, 100],
            ['2024-01-03', 100, 100],
          ]),
          dividends: [{ date: '2024-01-02', amountPerShare: 25 }],
        },
        leveraged: pathSeries('LEV', [
          ['2024-01-01', 100, 100],
          ['2024-01-02', 100, 50],
          ['2024-01-03', 50, 50],
        ]),
        endDate: '2024-01-03',
        dividendReinvestments: [
          { date: '2024-01-03', target: 'target-allocation' },
        ],
      }),
    );
    const reinvestment = result.trades.find(
      (trade) => trade.reason === 'DIVIDEND_REINVEST',
    );

    expect(reinvestment).toMatchObject({
      prototypeValueBefore: 400,
      leveragedValueBefore: 300,
      cashBefore: 100,
      tradedValue: 100,
    });
    expect(result.points.at(-1)).toMatchObject({
      prototypeValue: 400,
      leveragedValue: 400,
      cash: 0,
      leveragedWeight: 50,
    });
  });

  it('records actual cash purchases and cost for floor-aware reinvestment', () => {
    const result = runBacktest(
      cashAboveFloorInput({
        costs: {
          enabled: true,
          commissionRate: 0,
          sellTaxRate: 0,
          slippageRate: 0,
          minimumCommission: 5,
        },
      }),
    );
    const reinvestment = result.trades.find(
      (trade) => trade.reason === 'DIVIDEND_REINVEST',
    );

    expect(reinvestment).toMatchObject({
      cashBefore: 99.5,
      tradedValue: 94.5,
      cost: 5,
    });
    expect(result.points.at(-1)).toMatchObject({
      prototypeValue: 492.5,
      leveragedValue: 1_194,
      cash: 0,
      value: 1_686.5,
    });
    expect(result.metrics).toMatchObject({
      tradeCount: 2,
      turnover: 109.45,
      totalCosts: 10,
    });
  });

  it('leaves cash untouched when costs make a reinvestment impossible', () => {
    const shared: Partial<BacktestInput> = {
      strategy: profitRunStrategy({
        baseLeveragedWeight: 0,
        highLeveragedWeight: 0,
        drawdownRules: [],
        recoveryRules: [],
        dividendMode: 'cash',
        costs: {
          enabled: true,
          commissionRate: 0,
          sellTaxRate: 0,
          slippageRate: 0,
          minimumCommission: 1,
        },
      }),
      prototype: {
        ...seriesForDates('BASE', [
          '2024-01-01',
          '2024-01-02',
          '2024-01-03',
        ]),
        dividends: [{ date: '2024-01-02', amountPerShare: 0.05 }],
      },
      leveraged: seriesForDates('LEV', [
        '2024-01-01',
        '2024-01-02',
        '2024-01-03',
      ]),
      endDate: '2024-01-03',
    };
    const baseline = runBacktest(input(shared));
    const result = runBacktest(
      input({
        ...shared,
        dividendReinvestments: [
          { date: '2024-01-03', target: 'target-allocation' },
        ],
      }),
    );

    expect(
      result.trades.filter(
        (trade) => trade.reason === 'DIVIDEND_REINVEST',
      ),
    ).toHaveLength(0);
    expect(result.points.at(-1)).toEqual(baseline.points.at(-1));
    expect(result.points.at(-1)?.cash).toBeGreaterThan(0);
    expect(result.metrics).toMatchObject({
      tradeCount: baseline.metrics.tradeCount,
      turnover: baseline.metrics.turnover,
      totalCosts: baseline.metrics.totalCosts,
      finalValue: baseline.metrics.finalValue,
    });
  });

  it('keeps exact-target dividend allocation behavior for legacy strategies', () => {
    const result = runBacktest(
      cashAboveFloorInput({ allocationPolicy: 'exact-target' }),
    );

    expect(result.points.at(-1)?.leveragedWeight).toBeCloseTo(70);
  });

  it('does not record or mutate a sub-tolerance dividend reinvestment', () => {
    const dates: IsoDate[] = ['2024-01-01', '2024-01-02', '2024-01-03'];
    const tinyDividendPrototype: MarketSeries = {
      ...seriesForDates('BASE', dates),
      dividends: [{ date: '2024-01-02', amountPerShare: 1e-12 }],
    };
    const tinyDividendStrategy: StrategyConfig = {
      ...profitRunStrategy({
        baseLeveragedWeight: 0,
        highLeveragedWeight: 0,
        drawdownRules: [],
        recoveryRules: [],
        dividendMode: 'cash',
      }),
      costs: {
        enabled: true,
        commissionRate: 0,
        sellTaxRate: 0,
        slippageRate: 0,
        minimumCommission: 1,
      },
    };
    const shared = {
      prototype: tinyDividendPrototype,
      leveraged: seriesForDates('LEV', dates),
      strategy: tinyDividendStrategy,
      endDate: '2024-01-03' as IsoDate,
    };
    const baseline = runBacktest(input(shared));
    const withReinvestment = runBacktest(
      input({
        ...shared,
        dividendReinvestments: [
          { date: '2024-01-03', target: 'prototype' },
        ],
      }),
    );

    expect(
      withReinvestment.trades.filter(
        (trade) => trade.reason === 'DIVIDEND_REINVEST',
      ),
    ).toHaveLength(0);
    expect(
      withReinvestment.trades.every((trade) => trade.tradedValue > 0),
    ).toBe(true);
    expect(withReinvestment.metrics).toMatchObject({
      tradeCount: baseline.metrics.tradeCount,
      turnover: baseline.metrics.turnover,
      totalCosts: baseline.metrics.totalCosts,
      finalValue: baseline.metrics.finalValue,
    });
    expect(withReinvestment.points.at(-1)).toMatchObject({
      cash: baseline.points.at(-1)?.cash,
      prototypeValue: baseline.points.at(-1)?.prototypeValue,
      leveragedValue: baseline.points.at(-1)?.leveragedValue,
      value: baseline.points.at(-1)?.value,
    });
  });

  it.each(['price-only', 'total-return'] as const)(
    'keeps %s non-dividend capital fully invested',
    (dividendMode) => {
      const result = runBacktest(
        input({
          strategy: {
            ...strategy,
            dividendMode,
          },
        }),
      );
      for (const point of result.points) {
        expect(point.prototypeWeight + point.leveragedWeight).toBeCloseTo(100);
      }
    },
  );
});
