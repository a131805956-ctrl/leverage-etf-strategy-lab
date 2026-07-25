import type { MarketDataBundle, MarketSeries } from '../core/types';

const isMarketSeries = (value: unknown): value is MarketSeries => {
  if (!value || typeof value !== 'object') return false;
  const series = value as Partial<MarketSeries>;
  return (
    typeof series.symbol === 'string' &&
    Array.isArray(series.bars) &&
    Array.isArray(series.dividends)
  );
};

export const isMarketDataBundle = (
  value: unknown,
): value is MarketDataBundle => {
  if (!value || typeof value !== 'object') return false;
  const bundle = value as Partial<MarketDataBundle>;
  return (
    typeof bundle.generatedAt === 'string' &&
    typeof bundle.source === 'string' &&
    typeof bundle.requiredCutoff === 'string' &&
    Boolean(bundle.series) &&
    Object.values(bundle.series ?? {}).every(isMarketSeries)
  );
};

export async function loadMarketData(
  url = `${import.meta.env.BASE_URL}data/market.json`,
): Promise<MarketDataBundle> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`市場資料載入失敗：HTTP ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (!isMarketDataBundle(payload)) {
    throw new Error('市場資料格式不正確');
  }
  return payload;
}
