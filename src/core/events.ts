import type {
  DailyPoint,
  ExposureEvent,
  ExposureEventStage,
  IsoDate,
  TradeRecord,
} from './types';

const day = (date: IsoDate): number => Date.parse(`${date}T00:00:00Z`);

const isReductionTrade = (trade: TradeRecord): boolean => {
  if (trade.reason === 'RECOVERY') {
    // New records carry share deltas. A rebound that has to buy the floor is
    // not a reduction; legacy records without deltas remain compatible.
    return (
      trade.leveragedSharesSold === undefined ||
      trade.leveragedSharesSold > 1e-9
    );
  }
  // Returning to the normal target now happens on NEW_HIGH. It is only a
  // reduction event when the execution actually sells leveraged shares; a
  // new-high signal below the floor must not close the pink episode.
  return (
    trade.reason === 'NEW_HIGH' &&
    (trade.leveragedSharesSold ?? 0) > 1e-9
  );
};

const stageForPoint = (
  point: DailyPoint,
  trigger: ExposureEventStage['trigger'],
): ExposureEventStage => ({
  date: point.date,
  trigger,
  capital: point.value,
  prototypeValue: point.prototypeValue,
  leveragedValue: point.leveragedValue,
  cash: point.cash,
  prototypeWeight: point.prototypeWeight,
  leveragedWeight: point.leveragedWeight,
  targetLeveragedWeight: point.targetLeveragedWeight,
  nominalExposure: point.nominalExposure,
});

/**
 * Derive chartable exposure episodes from the immutable backtest output.
 *
 * An episode starts at the last observed high before an add-on (DRAWDOWN)
 * trade and ends at the first subsequent reduction (RECOVERY or a NEW_HIGH
 * normalization sale) trade. If no reduction occurs before the sample ends,
 * the final chart point is used.
 */
export function buildExposureEvents(
  points: DailyPoint[],
  trades: TradeRecord[],
): ExposureEvent[] {
  if (!points.length || !trades.length) return [];
  const sortedTrades = [...trades].sort((a, b) => day(a.date) - day(b.date));
  const events: ExposureEvent[] = [];

  for (let tradeIndex = 0; tradeIndex < sortedTrades.length; tradeIndex += 1) {
    const addTrade = sortedTrades[tradeIndex];
    if (!addTrade || addTrade.reason !== 'DRAWDOWN') continue;
    const addPointIndex = points.findIndex((point) => point.date === addTrade.date);
    if (addPointIndex < 0) continue;

    // The marker is the most recent observed high before this add-on, not
    // the first day of a multi-day rising run. This keeps the pink band start
    // aligned with the actual pre-drawdown peak users care about.
    let startIndex = addPointIndex;
    for (let index = addPointIndex - 1; index >= 0; index -= 1) {
      if (points[index]?.regime === 'AT_HIGH') {
        startIndex = index;
        break;
      }
    }
    const peak = points[startIndex] ?? points[addPointIndex];
    if (!peak) continue;

    const reductionIndex = sortedTrades.findIndex(
      (candidate, index) =>
        index > tradeIndex &&
        candidate.date >= addTrade.date &&
        isReductionTrade(candidate),
    );
    const reductionTrade = reductionIndex >= 0 ? sortedTrades[reductionIndex] : undefined;
    const endIndex = reductionTrade
      ? Math.max(
          addPointIndex,
          points.findIndex((point) => point.date === reductionTrade.date),
        )
      : points.length - 1;
    if (endIndex < 0) continue;

    const startPoint = points[startIndex] ?? points[addPointIndex] ?? points[0];
    const endPoint = points[endIndex] ?? points.at(-1) ?? startPoint;
    if (!startPoint || !endPoint) continue;
    const startDate = startPoint.date;
    const endDate = endPoint.date;
    const alreadyOverlapping = events.some(
      (event) => event.startDate === startDate && event.endDate === endDate,
    );
    if (alreadyOverlapping) continue;

    const episodeTrades = sortedTrades.filter(
      (candidate) => candidate.date >= startDate && candidate.date <= endDate,
    );
    const addTrades = episodeTrades.filter((candidate) => candidate.reason === 'DRAWDOWN');
    const reductionTrades = episodeTrades.filter(
      isReductionTrade,
    );
    const stages = points
      .slice(startIndex, endIndex + 1)
      .filter((point, index) => {
        if (index === 0 || index === endIndex - startIndex) return true;
        return episodeTrades.some((candidate) => candidate.date === point.date);
      })
      .map((point) => {
        const trigger = episodeTrades.find((candidate) => candidate.date === point.date);
        return stageForPoint(point, trigger?.reason ?? 'MARK');
      });

    events.push({
      id: `exposure-${startDate}-${endDate}`,
      startDate,
      endDate,
      peakDate: peak?.date ?? startDate,
      startIndex,
      endIndex,
      addTrades,
      reductionTrades,
      stages,
    });
  }

  return events.sort((a, b) => day(a.startDate) - day(b.startDate));
}

/** Alias with a descriptive name for API/AI callers. */
export const deriveExposureEvents = buildExposureEvents;
