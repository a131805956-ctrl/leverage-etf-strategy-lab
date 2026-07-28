import { describe, expect, it } from 'vitest';

import { calculateMetrics, findDrawdownEpisodes } from '../src/core/metrics';
import type { DailyPoint, IsoDate, TradeRecord } from '../src/core/types';

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

const points = [
  point('2024-01-01', 100),
  point('2024-01-02', 120),
  point('2024-01-03', 90),
  point('2024-01-04', 130),
];

describe('calculateMetrics', () => {
  it('calculates total return and maximum drawdown', () => {
    const metrics = calculateMetrics(points, [], 100, 0);
    expect(metrics.totalReturn).toBeCloseTo(30);
    expect(metrics.maxDrawdown).toBeCloseTo(25);
    expect(metrics.finalValue).toBe(130);
  });

  it('reports exposure and trade metadata', () => {
    const metrics = calculateMetrics(points, [], 100, 0);
    expect(metrics.averageExposure).toBe(100);
    expect(metrics.tradeCount).toBe(0);
    expect(metrics.totalCosts).toBe(0);
    expect(metrics.returnObservationCount).toBe(3);
    expect(metrics.maxDrawdownPeakDate).toBe('2024-01-02');
    expect(metrics.maxDrawdownTroughDate).toBe('2024-01-03');
    expect(metrics.maxDrawdownRecoveryDate).toBe('2024-01-04');
  });

  it('calculates Sharpe from daily excess returns and exposes its inputs', () => {
    const metrics = calculateMetrics(points, [], 100, 0.05);
    const dailyRf = (1.05 ** (1 / 252)) - 1;
    const returns = [0.2, -0.25, 130 / 90 - 1].map((value) => value - dailyRf);
    const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const standardDeviation = Math.sqrt(
      returns.reduce((sum, value) => sum + (value - average) ** 2, 0) /
        (returns.length - 1),
    );
    expect(metrics.sharpe).toBeCloseTo((average / standardDeviation) * Math.sqrt(252), 10);
    expect(metrics.sharpeRiskFreeRate).toBe(0.05);
    expect(metrics.sharpeAnnualizedVolatility).toBeGreaterThan(0);
  });

  it('counts one dividend reinvestment from its actual purchase and cost', () => {
    const reinvestment: TradeRecord = {
      date: '2024-01-04',
      reason: 'DIVIDEND_REINVEST',
      prototypeValueBefore: 400,
      leveragedValueBefore: 1_200,
      cashBefore: 100,
      targetLeveragedWeight: 70,
      tradedValue: 95,
      cost: 5,
      note: 'Dividend reinvestment',
    };

    const metrics = calculateMetrics(points, [reinvestment], 100, 0);

    expect(metrics.tradeCount).toBe(1);
    expect(metrics.turnover).toBe(95);
    expect(metrics.totalCosts).toBe(5);
  });
});

describe('findDrawdownEpisodes', () => {
  it('records peak, trough, recovery and duration', () => {
    const episodes = findDrawdownEpisodes(points);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      peakDate: '2024-01-02',
      troughDate: '2024-01-03',
      recoveryDate: '2024-01-04',
      depth: 25,
    });
  });
});
