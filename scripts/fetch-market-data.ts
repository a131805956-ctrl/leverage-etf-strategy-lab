import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORPORATE_ACTIONS } from '../src/config/corporateActions';
import type {
  IsoDate,
  MarketDataBundle,
  MarketSeries,
  PriceBar,
} from '../src/core/types';
import {
  coversCutoffMonth,
  requiredCutoff as calculateRequiredCutoff,
} from '../src/data/freshness';
import {
  buildAdjustedSeries,
  parseTwseDailyRows,
  parseTwseDividendHtml,
} from '../src/data/twse';

const symbols = ['0050.TW', '00631L.TW', '00646.TW', '00647L.TW'];
const firstSupportedMonth = '2014-10-01' as IsoDate;
const firstOfficialMonth: Record<string, IsoDate> = {
  '0050.TW': '2014-10-01',
  '00631L.TW': '2014-10-01',
  '00646.TW': '2015-12-01',
  '00647L.TW': '2015-12-01',
};
const rawSource =
  'TWSE-derived daily data (FinMind bulk snapshot; direct TWSE monthly updates)';
const derivedSource =
  'TWSE-derived daily data; split-adjusted with official ETF actions';
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rawOutputPath = resolve(
  scriptDirectory,
  '../public/data/market-raw.json',
);
const outputPath = resolve(scriptDirectory, '../public/data/market.json');
const requiredCutoff = calculateRequiredCutoff();

interface TwseDailyPayload {
  stat?: string;
  data?: unknown[][];
}

interface FinMindPayload<T> {
  msg?: string;
  status?: number;
  data?: T[];
}

interface FinMindPriceRow {
  date: IsoDate;
  Trading_Volume: number;
  open: number;
  max: number;
  min: number;
  close: number;
}

interface FinMindDividendRow {
  CashExDividendTradingDate: string;
  CashEarningsDistribution: number;
}

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });

const toDate = (date: IsoDate): Date => new Date(`${date}T00:00:00Z`);

const monthStartAfter = (date: IsoDate): IsoDate => {
  const value = toDate(date);
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1),
  )
    .toISOString()
    .slice(0, 10) as IsoDate;
};

const monthKeys = (start: IsoDate, end: IsoDate): string[] => {
  const cursor = toDate(start);
  cursor.setUTCDate(1);
  const final = toDate(end);
  const keys: string[] = [];
  while (cursor <= final) {
    keys.push(
      `${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}01`,
    );
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
};

async function request(url: URL, expectJson = false): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          referer: 'https://www.twse.com.tw/zh/trading/historical/stock-day.html',
          'user-agent': 'Mozilla/5.0 ExposureLab/0.1',
        },
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (response.ok && (!expectJson || contentType.includes('json'))) {
        return response;
      }
      if (response.ok && expectJson) {
        lastError = new Error(`Expected JSON, received ${contentType || 'unknown content type'}`);
        await wait(attempt * 500);
        continue;
      }
      lastError = new Error(`HTTP ${response.status}`);
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      ) {
        break;
      }
    } catch (error) {
      lastError = error;
    }
    await wait(attempt * 500);
  }
  throw new Error(`TWSE request failed: ${url.toString()}`, {
    cause: lastError,
  });
}

async function fetchMonth(symbol: string, month: string): Promise<PriceBar[]> {
  const code = symbol.replace('.TW', '');
  const url = new URL('https://www.twse.com.tw/exchangeReport/STOCK_DAY');
  url.searchParams.set('response', 'json');
  url.searchParams.set('date', month);
  url.searchParams.set('stockNo', code);
  const payload = (await (await request(url, true)).json()) as TwseDailyPayload;
  if (payload.stat !== 'OK') {
    const message = payload.stat ?? 'unknown response';
    if (message.includes('沒有符合條件的資料')) return [];
    throw new Error(`${symbol} ${month}: ${message}`);
  }
  return parseTwseDailyRows(payload.data ?? []);
}

async function fetchFinMind<T>(
  dataset: string,
  symbol: string,
): Promise<T[]> {
  const url = new URL('https://api.finmindtrade.com/api/v4/data');
  url.searchParams.set('dataset', dataset);
  url.searchParams.set('data_id', symbol.replace('.TW', ''));
  url.searchParams.set('start_date', firstOfficialMonth[symbol] ?? firstSupportedMonth);
  url.searchParams.set('end_date', requiredCutoff);
  const payload = (await (await request(url, true)).json()) as FinMindPayload<T>;
  if (payload.status !== 200 || payload.msg !== 'success') {
    throw new Error(`${symbol}: FinMind ${dataset} returned ${payload.msg ?? payload.status ?? 'unknown error'}`);
  }
  return payload.data ?? [];
}

async function fetchBulkBars(symbol: string): Promise<PriceBar[]> {
  const rows = await fetchFinMind<FinMindPriceRow>('TaiwanStockPrice', symbol);
  return rows
    .filter(
      (row) =>
        row.date <= requiredCutoff &&
        [row.open, row.max, row.min, row.close, row.Trading_Volume].every(
          Number.isFinite,
        ) &&
        Math.min(row.open, row.max, row.min, row.close) > 0,
    )
    .map((row) => ({
      date: row.date,
      open: row.open,
      high: row.max,
      low: row.min,
      close: row.close,
      adjustedClose: row.close,
      volume: row.Trading_Volume,
    }));
}

async function fetchBulkDividends(
  symbol: string,
): Promise<MarketSeries['dividends']> {
  const rows = await fetchFinMind<FinMindDividendRow>(
    'TaiwanStockDividend',
    symbol,
  );
  return rows.flatMap((row) => {
    const date = row.CashExDividendTradingDate;
    const amountPerShare = row.CashEarningsDistribution;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      date > requiredCutoff ||
      !Number.isFinite(amountPerShare) ||
      amountPerShare <= 0
    ) {
      return [];
    }
    return [{ date: date as IsoDate, amountPerShare }];
  });
}

async function fetchBars(
  symbol: string,
  start: IsoDate,
): Promise<PriceBar[]> {
  const bars: PriceBar[] = [];
  const months = monthKeys(start, requiredCutoff);
  for (let index = 0; index < months.length; index += 1) {
    const month = months[index];
    bars.push(...(await fetchMonth(symbol, month)));
    if ((index + 1) % 24 === 0) {
      console.log(`${symbol}: fetched ${index + 1}/${months.length} months`);
    }
    await wait(75);
  }
  return bars;
}

async function fetchDividends(symbol: string): Promise<MarketSeries['dividends']> {
  const code = symbol.replace('.TW', '');
  const url = new URL(
    'https://www.twse.com.tw/zh/ETFortune/dividendList',
  );
  url.searchParams.set('stkNo', code);
  url.searchParams.set(
    'startDate',
    String(toDate(firstSupportedMonth).getUTCFullYear()),
  );
  url.searchParams.set(
    'endDate',
    String(toDate(requiredCutoff).getUTCFullYear()),
  );
  const html = await (await request(url)).text();
  const dividends = parseTwseDividendHtml(html, code).filter(
    (event) => event.date <= requiredCutoff,
  );
  if (symbol === '0050.TW' && dividends.length === 0) {
    throw new Error('0050.TW: TWSE dividend history unexpectedly returned empty');
  }
  return dividends;
}

const deduplicateBars = (bars: PriceBar[]): PriceBar[] =>
  [
    ...new Map(
      bars
        .filter((bar) => bar.date <= requiredCutoff)
        .map((bar) => [bar.date, bar] as const),
    ).values(),
  ].sort((left, right) => left.date.localeCompare(right.date));

async function readRawCache(): Promise<MarketDataBundle | undefined> {
  try {
    const payload = JSON.parse(
      await readFile(rawOutputPath, 'utf8'),
    ) as MarketDataBundle;
    return payload.source === rawSource ? payload : undefined;
  } catch {
    return undefined;
  }
}

const validateSeries = (series: MarketSeries): void => {
  if (series.bars.length < 250) {
    throw new Error(`${series.symbol}: insufficient official history`);
  }
  for (let index = 1; index < series.bars.length; index += 1) {
    const previous = series.bars[index - 1];
    const current = series.bars[index];
    const ratio = current.close / previous.close;
    if (ratio < 0.65 || ratio > 1.35) {
      throw new Error(
        `${series.symbol}: implausible adjusted return ${previous.date} -> ${current.date} (${ratio.toFixed(4)})`,
      );
    }
  }
};

const officialCloseAnchors: Record<string, Record<IsoDate, number>> = {
  '0050.TW': {
    '2025-06-10': 188.65,
    '2025-06-18': 47.57,
  },
  '00631L.TW': {
    '2014-12-31': 21.53,
    '2015-01-05': 21.37,
    '2026-03-24': 443.15,
    '2026-03-31': 19.26,
  },
};

const validateOfficialAnchors = (series: MarketSeries): void => {
  const bars = new Map(series.bars.map((bar) => [bar.date, bar] as const));
  for (const [date, expectedClose] of Object.entries(
    officialCloseAnchors[series.symbol] ?? {},
  )) {
    if (date > requiredCutoff) continue;
    const actual = bars.get(date as IsoDate)?.close;
    if (actual === undefined || Math.abs(actual - expectedClose) > 0.005) {
      throw new Error(
        `${series.symbol}: official anchor ${date} expected ${expectedClose}, received ${actual ?? 'missing'}`,
      );
    }
  }
};

const cache = await readRawCache();
const rawEntries = await Promise.all(
  symbols.map(async (symbol) => {
    const listingMonth = firstOfficialMonth[symbol] ?? firstSupportedMonth;
    const fetchStart =
      cache && cache.requiredCutoff < requiredCutoff
        ? monthStartAfter(cache.requiredCutoff)
        : cache
          ? undefined
          : listingMonth;
    const cachedBars = cache?.series[symbol]?.bars ?? [];
    const newBars = cache
      ? fetchStart
        ? await fetchBars(symbol, fetchStart)
        : []
      : await fetchBulkBars(symbol);
    const bars = deduplicateBars([...cachedBars, ...newBars]);
    const dividends = cache
      ? fetchStart
        ? await fetchDividends(symbol)
        : cache.series[symbol]?.dividends ?? []
      : await fetchBulkDividends(symbol);
    const rawSeries = { symbol, bars, dividends } satisfies MarketSeries;
    validateOfficialAnchors(rawSeries);
    console.log(
      `${symbol}: ${bars.length} official bars, ${dividends.length} dividends`,
    );
    return [
      symbol,
      rawSeries,
    ] as const;
  }),
);

const generatedAt = new Date().toISOString();
const rawBundle: MarketDataBundle = {
  generatedAt,
  source: rawSource,
  requiredCutoff,
  series: Object.fromEntries(rawEntries),
};
const derivedEntries = rawEntries.map(([symbol, series]) => {
  const adjusted = buildAdjustedSeries(
    symbol,
    series.bars,
    series.dividends,
    CORPORATE_ACTIONS[symbol] ?? [],
  );
  validateSeries(adjusted);
  return [symbol, adjusted] as const;
});
for (const [symbol, series] of derivedEntries) {
  const latest = series.bars.at(-1)?.date;
  if (!coversCutoffMonth(latest, requiredCutoff)) {
    throw new Error(
      `${symbol}: latest ${latest ?? 'none'} does not cover cutoff month ${requiredCutoff.slice(0, 7)}`,
    );
  }
}

const bundle: MarketDataBundle = {
  generatedAt,
  source: derivedSource,
  requiredCutoff,
  series: Object.fromEntries(derivedEntries),
  normalization: {
    rawDataPath: 'data/market-raw.json',
    priceBasis:
      'Latest beneficiary-unit basis; cash distributions excluded from close and reinvested in adjustedClose',
    splits: CORPORATE_ACTIONS,
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(rawOutputPath, `${JSON.stringify(rawBundle)}\n`, 'utf8');
await writeFile(outputPath, `${JSON.stringify(bundle)}\n`, 'utf8');
console.log(`Required cutoff: ${requiredCutoff}`);
console.log(`Wrote ${rawOutputPath}`);
console.log(`Wrote ${outputPath}`);
