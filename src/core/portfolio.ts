import { fingerprint } from './fingerprint';
import { calculateMetrics } from './metrics';
import type {
  BacktestResult,
  DailyPoint,
  IsoDate,
  PortfolioConfig,
  PortfolioPoint,
  PortfolioResult,
} from './types';

const scheduleDue = (
  mode: PortfolioConfig['rebalance']['mode'],
  previous: IsoDate,
  current: IsoDate,
): boolean => {
  const a = new Date(`${previous}T00:00:00Z`);
  const b = new Date(`${current}T00:00:00Z`);
  if (mode === 'monthly') {
    return (
      a.getUTCFullYear() !== b.getUTCFullYear() ||
      a.getUTCMonth() !== b.getUTCMonth()
    );
  }
  if (mode === 'quarterly') {
    return (
      a.getUTCFullYear() !== b.getUTCFullYear() ||
      Math.floor(a.getUTCMonth() / 3) !== Math.floor(b.getUTCMonth() / 3)
    );
  }
  if (mode === 'annual') return a.getUTCFullYear() !== b.getUTCFullYear();
  return false;
};

const commonDates = (results: BacktestResult[]): IsoDate[] => {
  if (!results.length) return [];
  const remaining = results.slice(1).map(
    (result) => new Set(result.points.map((point) => point.date)),
  );
  return results[0]?.points
    .map((point) => point.date)
    .filter((date) => remaining.every((dates) => dates.has(date))) ?? [];
};

export function runPortfolioBacktest(
  config: PortfolioConfig,
  availableResults: BacktestResult[],
): PortfolioResult {
  const allocationTotal = config.allocations.reduce(
    (sum, allocation) => sum + allocation.targetWeight,
    0,
  );
  if (Math.abs(allocationTotal - 100) > 1e-8) {
    throw new Error('多組策略的目標權重必須合計 100%');
  }
  if (!(config.initialCapital > 0)) throw new Error('初始投入金額必須大於零');

  const resultMap = new Map(
    availableResults.map((result) => [result.id, result] as const),
  );
  const results = config.allocations.map((allocation) => {
    const result = resultMap.get(allocation.backtestId);
    if (!result) throw new Error(`找不到子策略 ${allocation.backtestId}`);
    return result;
  });
  const dates = commonDates(results);
  if (!dates.length) throw new Error('子策略之間沒有共同交易日');

  const pointsByResult = new Map(
    results.map((result) => [
      result.id,
      new Map(result.points.map((point) => [point.date, point] as const)),
    ]),
  );
  const sleeveValues: Record<string, number> = {};
  const previousNav: Record<string, number> = {};
  for (const allocation of config.allocations) {
    const firstPoint = pointsByResult
      .get(allocation.backtestId)
      ?.get(dates[0] as IsoDate);
    if (!firstPoint) throw new Error('缺少子策略起始資料');
    sleeveValues[allocation.backtestId] =
      config.initialCapital * (allocation.targetWeight / 100);
    previousNav[allocation.backtestId] = firstPoint.value;
  }

  const portfolioPoints: PortfolioPoint[] = [];
  const metricPoints: DailyPoint[] = [];
  const transfers: PortfolioResult['transfers'] = [];
  let peak = config.initialCapital;

  dates.forEach((date, dateIndex) => {
    if (dateIndex > 0) {
      for (const allocation of config.allocations) {
        const point = pointsByResult.get(allocation.backtestId)?.get(date);
        if (!point) throw new Error(`缺少 ${date} 的子策略資料`);
        const prior = previousNav[allocation.backtestId];
        if (!(prior && prior > 0)) throw new Error('子策略 NAV 必須大於零');
        sleeveValues[allocation.backtestId] =
          (sleeveValues[allocation.backtestId] ?? 0) * (point.value / prior);
        previousNav[allocation.backtestId] = point.value;
      }
    }

    let total = Object.values(sleeveValues).reduce(
      (sum, value) => sum + value,
      0,
    );
    const weightsBefore = Object.fromEntries(
      config.allocations.map((allocation) => [
        allocation.backtestId,
        total > 0
          ? ((sleeveValues[allocation.backtestId] ?? 0) / total) * 100
          : 0,
      ]),
    );
    const previousDate = dates[dateIndex - 1];
    const scheduled =
      previousDate !== undefined &&
      scheduleDue(config.rebalance.mode, previousDate, date);
    const drifted =
      config.rebalance.mode === 'drift' &&
      config.allocations.some(
        (allocation) =>
          Math.abs(
            (weightsBefore[allocation.backtestId] ?? 0) -
              allocation.targetWeight,
          ) >= config.rebalance.driftThreshold,
      );

    if (scheduled || drifted) {
      const amounts: Record<string, number> = {};
      for (const allocation of config.allocations) {
        const target = total * (allocation.targetWeight / 100);
        amounts[allocation.backtestId] =
          target - (sleeveValues[allocation.backtestId] ?? 0);
        sleeveValues[allocation.backtestId] = target;
      }
      transfers.push({
        date,
        reason: scheduled ? 'SCHEDULED' : 'DRIFT',
        amounts,
      });
      total = Object.values(sleeveValues).reduce(
        (sum, value) => sum + value,
        0,
      );
    }

    const weights = Object.fromEntries(
      config.allocations.map((allocation) => [
        allocation.backtestId,
        total > 0
          ? ((sleeveValues[allocation.backtestId] ?? 0) / total) * 100
          : 0,
      ]),
    );
    peak = Math.max(peak, total);
    const drawdown = peak > 0 ? (1 - total / peak) * 100 : 0;
    portfolioPoints.push({ date, value: total, weights, drawdown });

    const weightedExposure = config.allocations.reduce((sum, allocation) => {
      const childPoint = pointsByResult
        .get(allocation.backtestId)
        ?.get(date);
      return (
        sum +
        (weights[allocation.backtestId] ?? 0) *
          ((childPoint?.nominalExposure ?? 100) / 100)
      );
    }, 0);
    metricPoints.push({
      date,
      value: total,
      prototypeValue: total,
      leveragedValue: 0,
      cash: 0,
      prototypeWeight: 100,
      leveragedWeight: 0,
      targetLeveragedWeight: 0,
      nominalExposure: weightedExposure,
      drawdown,
      regime: 'AT_HIGH',
      benchmarkPrototype: total,
      benchmarkLeveraged: total,
    });
  });

  const metrics = calculateMetrics(
    metricPoints,
    [],
    config.initialCapital,
    0,
  );
  const withoutFingerprint = {
    id: config.id,
    config,
    points: portfolioPoints,
    transfers,
    metrics,
  };
  return {
    ...withoutFingerprint,
    fingerprint: fingerprint(withoutFingerprint),
  };
}
