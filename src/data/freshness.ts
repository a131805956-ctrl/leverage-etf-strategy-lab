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

export function coversCutoffMonth(
  latestDataDate: IsoDate | undefined,
  cutoff: IsoDate,
): boolean {
  if (!latestDataDate) return false;
  const monthStart = `${cutoff.slice(0, 7)}-01` as IsoDate;
  return latestDataDate >= monthStart;
}

export function needsRefresh(
  coveredThrough: IsoDate | undefined,
  now = new Date(),
): boolean {
  if (!coveredThrough) return true;
  return coveredThrough < requiredCutoff(now);
}
