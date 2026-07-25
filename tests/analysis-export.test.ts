import { describe, expect, it } from 'vitest';

import {
  createAnalysisBundle,
  createChatGptPrompt,
} from '../src/analysis/export';
import type { BacktestResult } from '../src/core/types';

const result = {
  id: 'result-1',
  pairId: 'tw50',
  startDate: '2020-01-01',
  endDate: '2026-06-30',
  fingerprint: 'fnv1a-12345678',
  strategy: { name: '回撤階梯' },
  metrics: { cagr: 18, maxDrawdown: 42, sharpe: 0.9 },
  trades: [{ date: '2020-03-16', reason: 'DRAWDOWN' }],
  drawdowns: [{ peakDate: '2020-02-01', troughDate: '2020-03-20', depth: 35 }],
  points: [{ date: '2020-01-01', value: 1_000_000 }],
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
  });

  it('asks ChatGPT to separate facts from inference', () => {
    const prompt = createChatGptPrompt(result);
    expect(prompt).toContain('已觀察事實');
    expect(prompt).toContain('推論');
    expect(prompt).toContain('不得把樣本內最佳');
  });
});
