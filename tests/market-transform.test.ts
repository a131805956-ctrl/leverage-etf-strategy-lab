import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { MarketDataBundle, PriceBar } from '../src/core/types';
import {
  buildAdjustedSeries,
  parseTwseDailyRows,
  parseTwseDividendHtml,
} from '../src/data/twse';

const bar = (
  date: PriceBar['date'],
  open: number,
  close: number,
): PriceBar => ({
  date,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
  adjustedClose: close,
  volume: 100,
});

describe('TWSE market data transformation', () => {
  it('converts official ROC daily rows into numeric ISO bars', () => {
    const rows = [
      ['103/12/31', '1,369,000', '29,351,570', '21.45', '21.60', '21.40', '21.53'],
    ];

    expect(parseTwseDailyRows(rows)).toEqual([
      {
        date: '2014-12-31',
        open: 21.45,
        high: 21.6,
        low: 21.4,
        close: 21.53,
        adjustedClose: 21.53,
        volume: 1_369_000,
      },
    ]);
  });

  it('parses official ETF dividend rows and ignores other symbols', () => {
    const html = `
      <table><tbody>
        <tr><td>0050</td><td>元大台灣50</td><td>103年10月24日</td>
          <td>103年11月01日</td><td>103年11月27日</td><td>1.55</td></tr>
        <tr><td>0056</td><td>元大高股息</td><td>103年10月24日</td>
          <td>103年11月01日</td><td>103年11月27日</td><td>1.00</td></tr>
      </tbody></table>`;

    expect(parseTwseDividendHtml(html, '0050')).toEqual([
      { date: '2014-10-24', amountPerShare: 1.55 },
    ]);
  });

  it('keeps prices continuous across a split and adjusts prior dividends', () => {
    const series = buildAdjustedSeries(
      'TEST.TW',
      [
        bar('2025-01-01', 100, 100),
        bar('2025-01-02', 102, 102),
        bar('2025-01-03', 51, 51),
      ],
      [{ date: '2025-01-02', amountPerShare: 2 }],
      [{ date: '2025-01-03', ratio: 2 }],
    );

    expect(series.bars.map((item) => item.close)).toEqual([50, 51, 51]);
    expect(series.dividends).toEqual([
      { date: '2025-01-02', amountPerShare: 1 },
    ]);
    expect(series.bars.map((item) => item.adjustedClose)).toEqual([50, 52, 52]);
  });

  it('reinvests a dividend only in adjusted close', () => {
    const series = buildAdjustedSeries(
      'TEST.TW',
      [bar('2025-01-01', 100, 100), bar('2025-01-02', 98, 98)],
      [{ date: '2025-01-02', amountPerShare: 2 }],
      [],
    );

    expect(series.bars[1]?.close).toBe(98);
    expect(series.bars[1]?.adjustedClose).toBe(100);
  });
});

describe('published market bundle integrity', () => {
  it('uses official TWSE prices without corporate-action cliffs', () => {
    const path = new URL('../public/data/market.json', import.meta.url);
    const bundle = JSON.parse(readFileSync(path, 'utf8')) as MarketDataBundle;

    expect(bundle.source).toContain('TWSE');
    for (const series of Object.values(bundle.series)) {
      for (let index = 1; index < series.bars.length; index += 1) {
        const previous = series.bars[index - 1];
        const current = series.bars[index];
        expect(previous).toBeDefined();
        expect(current).toBeDefined();
        const ratio = (current as PriceBar).close / (previous as PriceBar).close;
        expect(ratio).toBeGreaterThanOrEqual(0.65);
        expect(ratio).toBeLessThanOrEqual(1.35);
      }
    }
  });
});
