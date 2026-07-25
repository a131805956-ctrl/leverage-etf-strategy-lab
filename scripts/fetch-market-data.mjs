import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const symbols = ['0050.TW', '00631L.TW', '00646.TW', '00647L.TW'];
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDirectory, '../public/data/market.json');

const iso = (date) => date.toISOString().slice(0, 10);
const cutoffDate = new Date();
cutoffDate.setUTCDate(1);
cutoffDate.setUTCHours(0, 0, 0, 0);
cutoffDate.setUTCDate(0);
const requiredCutoff = iso(cutoffDate);
const period1 = Math.floor(Date.UTC(2003, 0, 1) / 1000);
const period2 = Math.floor((cutoffDate.getTime() + 2 * 86_400_000) / 1000);

const tradingDate = (timestamp) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp * 1000));

async function fetchSeries(symbol) {
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
  );
  url.searchParams.set('period1', String(period1));
  url.searchParams.set('period2', String(period2));
  url.searchParams.set('interval', '1d');
  url.searchParams.set('events', 'div,splits');
  url.searchParams.set('includeAdjustedClose', 'true');
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 StrategyLab/0.1' },
  });
  if (!response.ok) throw new Error(`${symbol}: HTTP ${response.status}`);
  const payload = await response.json();
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error(`${symbol}: Yahoo 沒有回傳資料`);
  const quote = result.indicators?.quote?.[0];
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const timestamps = result.timestamp ?? [];
  const bars = timestamps.flatMap((timestamp, index) => {
    const open = quote?.open?.[index];
    const high = quote?.high?.[index];
    const low = quote?.low?.[index];
    const close = quote?.close?.[index];
    if (![open, high, low, close].every(Number.isFinite)) return [];
    return [{
      date: tradingDate(timestamp),
      open,
      high,
      low,
      close,
      adjustedClose: Number.isFinite(adjusted[index]) ? adjusted[index] : close,
      volume: Number.isFinite(quote?.volume?.[index]) ? quote.volume[index] : 0,
    }];
  });
  const dividends = Object.values(result.events?.dividends ?? {})
    .filter((event) => Number.isFinite(event.amount))
    .map((event) => ({
      date: tradingDate(event.date),
      amountPerShare: event.amount,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { symbol, bars, dividends };
}

const entries = await Promise.all(
  symbols.map(async (symbol) => [symbol, await fetchSeries(symbol)]),
);
const bundle = {
  generatedAt: new Date().toISOString(),
  source: 'Yahoo Finance chart API',
  requiredCutoff,
  series: Object.fromEntries(entries),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(bundle)}\n`, 'utf8');
for (const [symbol, series] of entries) {
  const latest = series.bars.at(-1)?.date ?? 'none';
  console.log(`${symbol}: ${series.bars.length} bars, latest ${latest}`);
}
console.log(`Wrote ${outputPath}`);
