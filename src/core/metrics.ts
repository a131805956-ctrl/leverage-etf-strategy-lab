import type {
  DailyPoint,
  DrawdownEpisode,
  PerformanceMetrics,
  TradeRecord,
} from './types';

const mean = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const deviation = (values: number[]): number => {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
};

const percentile = (values: number[], probability: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(probability * sorted.length)),
  );
  return sorted[index] ?? 0;
};

const daysBetween = (start: string, end: string): number =>
  Math.max(
    1,
    Math.round(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
        86_400_000,
    ),
  );

export function findDrawdownEpisodes(points: DailyPoint[]): DrawdownEpisode[] {
  if (!points.length) return [];
  const episodes: DrawdownEpisode[] = [];
  let peak = points[0] as DailyPoint;
  let trough = peak;
  let active = false;

  for (const point of points.slice(1)) {
    if (point.value >= peak.value) {
      if (active) {
        episodes.push({
          peakDate: peak.date,
          troughDate: trough.date,
          recoveryDate: point.date,
          depth: (1 - trough.value / peak.value) * 100,
          durationDays: daysBetween(peak.date, point.date),
        });
      }
      peak = point;
      trough = point;
      active = false;
    } else {
      active = true;
      if (point.value < trough.value) trough = point;
    }
  }

  if (active) {
    const last = points.at(-1) as DailyPoint;
    episodes.push({
      peakDate: peak.date,
      troughDate: trough.date,
      depth: (1 - trough.value / peak.value) * 100,
      durationDays: daysBetween(peak.date, last.date),
    });
  }
  return episodes;
}

export function calculateMetrics(
  points: DailyPoint[],
  trades: TradeRecord[],
  initialCapital: number,
  annualRiskFreeRate = 0,
): PerformanceMetrics {
  if (!points.length) {
    return {
      finalValue: initialCapital,
      totalReturn: 0,
      cagr: 0,
      annualizedVolatility: 0,
      downsideVolatility: 0,
      sharpe: 0,
      sortino: 0,
      maxDrawdown: 0,
      calmar: 0,
      ulcerIndex: 0,
      valueAtRisk95: 0,
      conditionalValueAtRisk95: 0,
      averageExposure: 0,
      turnover: 0,
      tradeCount: trades.length,
      totalCosts: 0,
    };
  }

  const finalValue = (points.at(-1) as DailyPoint).value;
  const totalReturn = (finalValue / initialCapital - 1) * 100;
  const elapsedDays = daysBetween(
    (points[0] as DailyPoint).date,
    (points.at(-1) as DailyPoint).date,
  );
  const cagr =
    elapsedDays < 30
      ? 0
      : ((finalValue / initialCapital) ** (365.25 / elapsedDays) - 1) * 100;
  const returns = points.slice(1).map((point, index) => {
    const previous = points[index] as DailyPoint;
    return point.value / previous.value - 1;
  });
  const annualizedVolatility = deviation(returns) * Math.sqrt(252) * 100;
  const downside = returns.filter((value) => value < 0);
  const downsideVolatility = deviation(downside) * Math.sqrt(252) * 100;
  const annualizedReturn = mean(returns) * 252 * 100;
  const sharpe =
    annualizedVolatility > 0
      ? (annualizedReturn - annualRiskFreeRate * 100) / annualizedVolatility
      : 0;
  const sortino =
    downsideVolatility > 0
      ? (annualizedReturn - annualRiskFreeRate * 100) / downsideVolatility
      : 0;
  const episodes = findDrawdownEpisodes(points);
  const maxDrawdown = Math.max(0, ...episodes.map((episode) => episode.depth));
  const calmar = maxDrawdown > 0 ? cagr / maxDrawdown : 0;
  const drawdowns = points.map((point) => point.drawdown / 100);
  const ulcerIndex =
    Math.sqrt(mean(drawdowns.map((drawdown) => drawdown ** 2))) * 100;
  const valueAtRisk95 = -percentile(returns, 0.05) * 100;
  const cutoff = -valueAtRisk95 / 100;
  const tail = returns.filter((value) => value <= cutoff);
  const conditionalValueAtRisk95 = tail.length ? -mean(tail) * 100 : 0;
  const averageExposure = mean(points.map((point) => point.nominalExposure));
  const totalCosts = trades.reduce((sum, trade) => sum + trade.cost, 0);
  const turnover =
    initialCapital > 0
      ? (trades.reduce((sum, trade) => sum + trade.tradedValue, 0) /
          initialCapital) *
        100
      : 0;

  return {
    finalValue,
    totalReturn,
    cagr,
    annualizedVolatility,
    downsideVolatility,
    sharpe,
    sortino,
    maxDrawdown,
    calmar,
    ulcerIndex,
    valueAtRisk95,
    conditionalValueAtRisk95,
    averageExposure,
    turnover,
    tradeCount: trades.length,
    totalCosts,
  };
}
