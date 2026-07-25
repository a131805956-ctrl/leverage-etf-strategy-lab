import type { IsoDate } from '../core/types';

const taipeiParts = (date: Date): { year: number; month: number } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);
  const value = (type: 'year' | 'month'): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month') };
};

const isoUtc = (date: Date): IsoDate =>
  date.toISOString().slice(0, 10) as IsoDate;

export function requiredCutoff(now = new Date()): IsoDate {
  const { year, month } = taipeiParts(now);
  return isoUtc(new Date(Date.UTC(year, month - 1, 0)));
}

export function requiredTradingCutoff(now = new Date()): IsoDate {
  const cutoff = new Date(`${requiredCutoff(now)}T00:00:00Z`);
  const day = cutoff.getUTCDay();
  if (day === 6) cutoff.setUTCDate(cutoff.getUTCDate() - 1);
  if (day === 0) cutoff.setUTCDate(cutoff.getUTCDate() - 2);
  return isoUtc(cutoff);
}

export function needsRefresh(
  latestDataDate: IsoDate | undefined,
  now = new Date(),
): boolean {
  if (!latestDataDate) return true;
  return latestDataDate < requiredTradingCutoff(now);
}
