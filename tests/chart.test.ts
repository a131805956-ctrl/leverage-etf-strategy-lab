import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import type { DailyPoint } from '../src/core/types';
import {
  buildExposureRailSegments,
  clampTooltipPosition,
  formatChartPointTooltip,
  isClosedExposureEvent,
} from '../src/ui/chart';

const point = (overrides: Partial<DailyPoint> = {}): DailyPoint => ({
  date: '2024-01-02',
  value: 1_250_000,
  prototypeValue: 550_000,
  leveragedValue: 700_000,
  cash: 0,
  prototypeWeight: 44,
  leveragedWeight: 56,
  targetLeveragedWeight: 70,
  nominalExposure: 156,
  drawdown: 12.5,
  regime: 'DECLINE',
  benchmarkPrototype: 1_100_000,
  benchmarkLeveraged: 1_300_000,
  ...overrides,
});

describe('chart data presentation helpers', () => {
  it('creates one rail segment per point with a stable exposure value', () => {
    const segments = buildExposureRailSegments([
      point({ date: '2024-01-01', nominalExposure: 100 }),
      point({ date: '2024-01-02', nominalExposure: 175 }),
    ]);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ date: '2024-01-01', exposure: 100 });
    expect(segments[1]).toMatchObject({ date: '2024-01-02', exposure: 175 });
    expect(segments[0]?.color).toMatch(/^hsl\(/);
  });

  it('samples a long rail so dense daily data does not become a wall of bars', () => {
    const points = Array.from({ length: 500 }, (_, index) =>
      point({
        date: `2024-01-${String((index % 28) + 1).padStart(2, '0')}` as DailyPoint['date'],
        nominalExposure: 100 + (index % 5) * 10,
      }),
    );
    expect(buildExposureRailSegments(points, 50)).toHaveLength(50);
  });

  it('renders a complete bilingual hover payload, not only the headline value', () => {
    const html = formatChartPointTooltip(
      point({
        prototypeShares: 12.5,
        leveragedShares: 7.25,
        prototypePrice: 100.12,
        leveragedPrice: 48.6,
        runningHigh: 1_500,
        trough: 1_000,
        distanceToHighPct: 16,
        reboundPct: 4,
        activeRuleKey: 'DRAWDOWN_10',
      }),
    );

    expect(html).toContain('2024-01-02');
    expect(html).toContain('名目曝險');
    expect(html).toContain('Nominal exposure');
    expect(html).toContain('原型倉位');
    expect(html).toContain('槓桿倉位');
    expect(html).toContain('現值');
    expect(html).toContain('下跌幅度');
    expect(html).toContain('DECLINE');
    expect(html).toContain('持有股數');
    expect(html).toContain('原型價格');
    expect(html).toContain('歷史高點');
    expect(html).toContain('規則');
  });

  it('keeps event marker buttons above the chart canvas for pointer input', () => {
    const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.chart-event-layer\s*\{[^}]*z-index:\s*10;/s);
    expect(css).toMatch(/\.chart-event-layer\s*\{[^}]*pointer-events:\s*none;/s);
    expect(css).toMatch(/\.chart-exposure-overlay\s*\{[^}]*pointer-events:\s*none;/s);
  });

  it('gives the plot and exposure rail enough vertical room to read', () => {
    const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.chart-host\s*\{[^}]*height:\s*560px;/s);
    expect(css).toMatch(/\.chart-exposure-overlay\s*\{[^}]*height:\s*22px;/s);
  });

  it('keeps the tooltip within the chart even when the crosshair is at an edge', () => {
    expect(clampTooltipPosition(8, 4, 800, 500, 320, 220)).toEqual({ left: 10, top: 10 });
    expect(clampTooltipPosition(790, 496, 800, 500, 320, 220)).toEqual({ left: 470, top: 270 });
  });

  it('does not fill an unfinished add-on episode across the whole chart', () => {
    expect(isClosedExposureEvent({ id: 'open', startDate: '2024-01-01', endDate: '2024-01-04' })).toBe(false);
    expect(isClosedExposureEvent({ id: 'closed', startDate: '2024-01-01', endDate: '2024-01-04', reductionTrades: [{ date: '2024-01-04', reason: 'RECOVERY' } as never] })).toBe(true);
    expect(isClosedExposureEvent({ id: 'closed-stage', startDate: '2024-01-01', endDate: '2024-01-04', stages: [{ date: '2024-01-04', trigger: 'DELEVERAGE' }] })).toBe(true);
  });
});
