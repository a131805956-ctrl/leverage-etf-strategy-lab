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
