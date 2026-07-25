import { describe, expect, it } from 'vitest';

import { runPortfolioBacktest } from '../src/core/portfolio';
import type {
  BacktestResult,
  DailyPoint,
  IsoDate,
  PortfolioConfig,
} from '../src/core/types';

const point = (date: IsoDate, value: number): DailyPoint => ({
  date,
  value,
  prototypeValue: value,
  leveragedValue: 0,
  cash: 0,
  prototypeWeight: 100,
  leveragedWeight: 0,
  targetLeveragedWeight: 0,
  nominalExposure: 100,
  drawdown: 0,
  regime: 'AT_HIGH',
  benchmarkPrototype: value,
  benchmarkLeveraged: value,
});

const result = (
  id: string,
  values: Array<[IsoDate, number]>,
): BacktestResult =>
  ({
    id,
    points: values.map(([date, value]) => point(date, value)),
    trades: [],
    metrics: { totalCosts: 0 },
  }) as unknown as BacktestResult;

const strategies = [
  result('tw', [
    ['2023-01-02', 100],
    ['2023-12-29', 200],
    ['2024-01-02', 200],
  ]),
  result('us', [
    ['2023-01-02', 100],
    ['2023-12-29', 100],
    ['2024-01-02', 100],
  ]),
];

const config = (
  mode: PortfolioConfig['rebalance']['mode'],
  driftThreshold = 10,
): PortfolioConfig => ({
  id: `portfolio-${mode}`,
  name: '40 / 60',
  initialCapital: 1_000,
  allocations: [
    { backtestId: 'tw', label: '台股策略', targetWeight: 40 },
    { backtestId: 'us', label: '美股策略', targetWeight: 60 },
  ],
  rebalance: { mode, driftThreshold },
});

describe('runPortfolioBacktest', () => {
  it('starts with each strategy at its configured allocation', () => {
    const portfolio = runPortfolioBacktest(config('none'), strategies);
    expect(portfolio.points[0]?.weights.tw).toBeCloseTo(40);
    expect(portfolio.points[0]?.weights.us).toBeCloseTo(60);
  });

  it('allows weights to drift when rebalancing is disabled', () => {
    const portfolio = runPortfolioBacktest(config('none'), strategies);
    expect(portfolio.points[1]?.weights.tw).toBeCloseTo(57.142857, 4);
    expect(portfolio.transfers).toHaveLength(0);
  });

  it('rebalances at the first common date of a new year', () => {
    const portfolio = runPortfolioBacktest(config('annual'), strategies);
    expect(portfolio.points.at(-1)?.weights.tw).toBeCloseTo(40);
    expect(portfolio.transfers.at(-1)?.reason).toBe('SCHEDULED');
  });

  it('rebalances when allocation drift reaches the threshold', () => {
    const portfolio = runPortfolioBacktest(config('drift', 5), strategies);
    expect(portfolio.points[1]?.weights.tw).toBeCloseTo(40);
    expect(portfolio.transfers[0]?.reason).toBe('DRIFT');
  });
});
