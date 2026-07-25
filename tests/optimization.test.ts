import { describe, expect, it } from 'vitest';

import { gridSearch } from '../src/optimization/gridSearch';
import { paretoFront } from '../src/optimization/pareto';

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
