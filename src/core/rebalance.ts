import type { IsoDate, StrategyConfig } from './types';

const DAY = 86_400_000;

const asUtcDate = (date: IsoDate): Date => new Date(`${date}T00:00:00Z`);

const elapsedDays = (date: IsoDate, start: IsoDate): number =>
  Math.floor(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      DAY,
  );

export function scheduledRebalanceDue(
  rebalance: StrategyConfig['rebalance'],
  startDate: IsoDate,
  currentDate: IsoDate,
  nextDate: IsoDate,
): boolean {
  if (rebalance.mode === 'calendar-interval') {
    const intervalDays = rebalance.intervalDays;
    if (!intervalDays) return false;

    return (
      Math.floor(elapsedDays(nextDate, startDate) / intervalDays) >
      Math.floor(elapsedDays(currentDate, startDate) / intervalDays)
    );
  }

  const current = asUtcDate(currentDate);
  const next = asUtcDate(nextDate);
  if (rebalance.mode === 'monthly') {
    return current.getUTCMonth() !== next.getUTCMonth();
  }
  if (rebalance.mode === 'quarterly') {
    return (
      current.getUTCFullYear() !== next.getUTCFullYear() ||
      Math.floor(current.getUTCMonth() / 3) !==
        Math.floor(next.getUTCMonth() / 3)
    );
  }
  if (rebalance.mode === 'annual') {
    return current.getUTCFullYear() !== next.getUTCFullYear();
  }

  return false;
}
