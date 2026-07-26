import { describe, expect, it } from 'vitest';

import {
  createAnalysisBundle,
  createChatGptPrompt,
  resultToCsv,
} from '../src/analysis/export';
import type { BacktestResult, PortfolioResult } from '../src/core/types';

const parseCsv = (csv: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (character !== '\r') {
      cell += character;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
};

const result = {
  id: 'result-1',
  pairId: 'tw50',
  startDate: '2020-01-01',
  endDate: '2026-06-30',
  fingerprint: 'fnv1a-12345678',
  strategy: {
    name: '回撤階梯',
    allocationPolicy: 'minimum-floor',
    rebalance: {
      mode: 'calendar-interval',
      intervalDays: 180,
      driftThreshold: 5,
    },
  },
  metrics: { cagr: 18, maxDrawdown: 42, sharpe: 0.9 },
  trades: [{ date: '2020-03-16', reason: 'DRAWDOWN' }],
  drawdowns: [{ peakDate: '2020-02-01', troughDate: '2020-03-20', depth: 35 }],
  points: [{ date: '2020-01-01', value: 1_000_000, drawdown: 0 }],
} as unknown as BacktestResult;

describe('AI analysis export', () => {
  it('includes reproducibility and risk fields', () => {
    const bundle = createAnalysisBundle(result, {
      source: 'Yahoo Finance',
      generatedAt: '2026-07-26T00:00:00.000Z',
    });
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.resultFingerprint).toBe('fnv1a-12345678');
    expect(bundle.drawdowns).toHaveLength(1);
    expect(bundle.trades).toHaveLength(1);
    expect(bundle.configuration).toMatchObject({
      allocationPolicy: 'minimum-floor',
      rebalance: { mode: 'calendar-interval', intervalDays: 180 },
    });
  });

  it('asks ChatGPT to separate facts from inference', () => {
    const prompt = createChatGptPrompt(result);
    expect(prompt).toContain('已觀察事實');
    expect(prompt).toContain('推論');
    expect(prompt).toContain('不得把樣本內最佳');
    expect(prompt).toContain('"allocationPolicy": "minimum-floor"');
    expect(prompt).toContain('"mode": "calendar-interval"');
    expect(prompt).toContain('"intervalDays": 180');
  });

  it('exports configuration as parseable columns with consistent row widths', () => {
    const rows = parseCsv(resultToCsv(result));

    expect(rows[0]).toEqual([
      'date',
      'value',
      'drawdown',
      'allocationPolicy',
      'rebalanceMode',
      'rebalanceIntervalDays',
    ]);
    expect(rows[1]).toEqual([
      '2020-01-01',
      '1000000.0000',
      '0.0000',
      'minimum-floor',
      'calendar-interval',
      '180',
    ]);
    expect(rows.every((row) => row.length === rows[0]?.length)).toBe(true);
  });

  it('leaves pair-only CSV columns blank for a portfolio result', () => {
    const portfolio = {
      config: { rebalance: { mode: 'annual' } },
      points: [{ date: '2020-01-01', value: 2_000_000, drawdown: 0 }],
    } as unknown as PortfolioResult;
    const rows = parseCsv(resultToCsv(portfolio));

    expect(rows[1]).toEqual([
      '2020-01-01',
      '2000000.0000',
      '0.0000',
      '',
      'annual',
      '',
    ]);
    expect(rows[1]?.length).toBe(rows[0]?.length);
  });
});
