import type { StrategyConfig } from '../core/types';

export interface OptimizationMetrics {
  cagr: number;
  maxDrawdown: number;
  sharpe: number;
  calmar: number;
}

export interface Evaluation {
  score: number;
  metrics: OptimizationMetrics;
}

export interface GridSearchResult {
  parameters: Record<string, number>;
  score: number;
  metrics: OptimizationMetrics;
}

export function createOptimizationCandidate(
  activeStrategy: StrategyConfig,
  parameters: Record<string, number>,
): StrategyConfig {
  return {
    ...activeStrategy,
    rebalance: { ...activeStrategy.rebalance },
    costs: { ...activeStrategy.costs },
    recoveryRules: activeStrategy.recoveryRules.map((rule) => ({ ...rule })),
    baseLeveragedWeight: parameters.base ?? 60,
    highLeveragedWeight: parameters.high ?? 70,
    drawdownRules: [
      { threshold: 10, leveragedWeight: parameters.dd10 ?? 80 },
      { threshold: 20, leveragedWeight: parameters.dd20 ?? 90 },
      { threshold: 30, leveragedWeight: 100 },
    ],
  };
}

export function gridSearch(
  grid: Record<string, number[]>,
  evaluate: (parameters: Record<string, number>) => Evaluation,
): GridSearchResult[] {
  const entries = Object.entries(grid);
  const combinations: Array<Record<string, number>> = [{}];

  for (const [key, values] of entries) {
    const expanded: Array<Record<string, number>> = [];
    for (const combination of combinations) {
      for (const value of values) {
        expanded.push({ ...combination, [key]: value });
      }
    }
    combinations.splice(0, combinations.length, ...expanded);
  }

  return combinations.map((parameters) => ({
    parameters,
    ...evaluate(parameters),
  }));
}
