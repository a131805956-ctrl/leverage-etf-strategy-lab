import { describe, expect, it } from 'vitest';

import {
  createOptimizationCandidate,
  gridSearch,
} from '../src/optimization/gridSearch';
import { paretoFront } from '../src/optimization/pareto';
import type { StrategyConfig } from '../src/core/types';

const activeStrategy = {
  id: 'active',
  name: 'Active strategy',
  pairId: 'tw50',
  allocationPolicy: 'minimum-floor',
  baseLeveragedWeight: 60,
  highLeveragedWeight: 70,
  drawdownRules: [
    { threshold: 10, leveragedWeight: 80 },
    { threshold: 20, leveragedWeight: 90 },
    { threshold: 30, leveragedWeight: 100 },
  ],
  recoveryRules: [{ distanceToHigh: 5, leveragedWeight: 70 }],
  recoveryConfirmationPct: 3,
  rebalance: {
    mode: 'calendar-interval',
    intervalDays: 180,
    driftThreshold: 5,
  },
  dividendMode: 'total-return',
  execution: 'next-open',
  costs: {
    enabled: false,
    commissionRate: 0,
    sellTaxRate: 0,
    slippageRate: 0,
    minimumCommission: 0,
  },
} satisfies StrategyConfig;

describe('gridSearch', () => {
  it('evaluates every parameter combination in deterministic order', () => {
    const results = gridSearch(
      { base: [40, 60], step: [10, 20, 30] },
      (parameters) => {
        const base = parameters.base ?? 0;
        const step = parameters.step ?? 0;
        return {
          score: base + step,
          metrics: {
            cagr: base,
            maxDrawdown: step,
            sharpe: 1,
            calmar: 1,
          },
        };
      },
    );
    expect(results).toHaveLength(6);
    expect(results[0]?.parameters).toEqual({ base: 40, step: 10 });
    expect(results.at(-1)?.parameters).toEqual({ base: 60, step: 30 });
  });

  it('inherits policy and rebalance instead of optimizing them as axes', () => {
    const candidate = createOptimizationCandidate(activeStrategy, {
      base: 50,
      high: 60,
      dd10: 70,
      dd20: 80,
    });

    expect(candidate.allocationPolicy).toBe('minimum-floor');
    expect(candidate.rebalance).toEqual(activeStrategy.rebalance);
    expect(candidate.rebalance).not.toBe(activeStrategy.rebalance);
    expect(candidate.costs).not.toBe(activeStrategy.costs);
    expect(candidate.recoveryRules).not.toBe(activeStrategy.recoveryRules);
    expect(candidate.recoveryRules[0]).not.toBe(activeStrategy.recoveryRules[0]);
    expect(candidate).toMatchObject({
      baseLeveragedWeight: 50,
      highLeveragedWeight: 60,
      drawdownRules: [
        { threshold: 10, leveragedWeight: 70 },
        { threshold: 20, leveragedWeight: 80 },
        { threshold: 30, leveragedWeight: 100 },
      ],
    });

    candidate.rebalance.driftThreshold = 9;
    candidate.costs.commissionRate = 0.5;
    if (candidate.recoveryRules[0]) {
      candidate.recoveryRules[0].leveragedWeight = 10;
    }
    expect(activeStrategy.rebalance.driftThreshold).toBe(5);
    expect(activeStrategy.costs.commissionRate).toBe(0);
    expect(activeStrategy.recoveryRules[0]?.leveragedWeight).toBe(70);
  });
});

describe('paretoFront', () => {
  it('keeps candidates not dominated on return and drawdown', () => {
    const candidates = [
      { id: 'a', cagr: 20, maxDrawdown: 40 },
      { id: 'b', cagr: 18, maxDrawdown: 25 },
      { id: 'c', cagr: 15, maxDrawdown: 30 },
    ];
    expect(
      paretoFront(candidates, [
        { key: 'cagr', direction: 'maximize' },
        { key: 'maxDrawdown', direction: 'minimize' },
      ]).map((candidate) => candidate.id),
    ).toEqual(['a', 'b']);
  });
});
