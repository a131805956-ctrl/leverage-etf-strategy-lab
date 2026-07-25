import type {
  DividendEvent,
  IsoDate,
  MarketSeries,
  PriceBar,
} from '../core/types';

export interface SplitEvent {
  date: IsoDate;
  ratio: number;
}

const numeric = (value: unknown): number | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = Number(String(value).replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : undefined;
};

const rocDate = (value: string): IsoDate | undefined => {
  const match = value.trim().match(/^(\d{2,3})[年/](\d{2})[月/](\d{2})日?$/);
  if (!match) return undefined;
  const year = Number(match[1]) + 1911;
  return `${year}-${match[2]}-${match[3]}` as IsoDate;
};

export function parseTwseDailyRows(rows: unknown[][]): PriceBar[] {
  return rows
    .flatMap((row) => {
      const date = typeof row[0] === 'string' ? rocDate(row[0]) : undefined;
      const volume = numeric(row[1]);
      const open = numeric(row[3]);
      const high = numeric(row[4]);
      const low = numeric(row[5]);
      const close = numeric(row[6]);
      if (
        !date ||
        volume === undefined ||
        open === undefined ||
        high === undefined ||
        low === undefined ||
        close === undefined ||
        Math.min(open, high, low, close) <= 0
      ) {
        return [];
      }
      return [
        {
          date,
          open,
          high,
          low,
          close,
          adjustedClose: close,
          volume,
        },
      ];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

const stripHtml = (value: string): string =>
  value
    .replace(/<[^>]*>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .trim();

export function parseTwseDividendHtml(
  html: string,
  symbol: string,
): DividendEvent[] {
  const events = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .flatMap((rowMatch) => {
      const row = rowMatch[1] ?? '';
      const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
        (cellMatch) => stripHtml(cellMatch[1] ?? ''),
      );
      if (cells[0] !== symbol) return [];
      const date = cells[2] ? rocDate(cells[2]) : undefined;
      const amountPerShare = numeric(cells[5]);
      if (!date || amountPerShare === undefined || amountPerShare <= 0) return [];
      return [{ date, amountPerShare }];
    })
    .sort((left, right) => left.date.localeCompare(right.date));

  return events.filter(
    (event, index) =>
      index === 0 ||
      event.date !== events[index - 1]?.date ||
      event.amountPerShare !== events[index - 1]?.amountPerShare,
  );
}

const futureSplitFactor = (
  date: IsoDate,
  splits: SplitEvent[],
): number =>
  splits
    .filter((split) => split.date > date)
    .reduce((factor, split) => factor * split.ratio, 1);

export function buildAdjustedSeries(
  symbol: string,
  rawBars: PriceBar[],
  rawDividends: DividendEvent[],
  splits: SplitEvent[],
): MarketSeries {
  const orderedSplits = [...splits]
    .filter((split) => split.ratio > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const bars = [...rawBars]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((bar) => {
      const factor = futureSplitFactor(bar.date, orderedSplits);
      return {
        ...bar,
        open: bar.open / factor,
        high: bar.high / factor,
        low: bar.low / factor,
        close: bar.close / factor,
        adjustedClose: bar.close / factor,
        volume: bar.volume * factor,
      };
    });
  const dividends = [...rawDividends]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((event) => ({
      ...event,
      amountPerShare:
        event.amountPerShare / futureSplitFactor(event.date, orderedSplits),
    }));
  const dividendsByDate = new Map<IsoDate, number>();
  for (const event of dividends) {
    dividendsByDate.set(
      event.date,
      (dividendsByDate.get(event.date) ?? 0) + event.amountPerShare,
    );
  }

  let previousClose: number | undefined;
  let previousAdjustedClose: number | undefined;
  for (const bar of bars) {
    if (previousClose === undefined || previousAdjustedClose === undefined) {
      previousClose = bar.close;
      previousAdjustedClose = bar.close;
      continue;
    }
    bar.adjustedClose =
      previousAdjustedClose *
      ((bar.close + (dividendsByDate.get(bar.date) ?? 0)) / previousClose);
    previousClose = bar.close;
    previousAdjustedClose = bar.adjustedClose;
  }

  return { symbol, bars, dividends };
}
