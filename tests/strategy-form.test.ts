import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  resolveReductionFormState,
  resolveRebalanceSelection,
  resolveStrategyFormState,
} from '../src/ui/strategyForm';

const appSource = readFileSync(
  new URL('../src/ui/app.ts', import.meta.url),
  'utf8',
);
const cssSource = readFileSync(
  new URL('../src/styles/app.css', import.meta.url),
  'utf8',
);
const drawerSource = appSource.slice(
  appSource.indexOf('<aside class="drawer"'),
  appSource.indexOf('</aside>'),
);
const visibleFormControls = [
  ...appSource.matchAll(/<(?:input|select)\b[^>]*>/g),
]
  .map((match) => match[0])
  .filter((control) => !/\shidden(?:\s|>)/.test(control));

describe('resolveRebalanceSelection', () => {
  it.each([
    ['interval-30', 30],
    ['interval-180', 180],
    ['interval-365', 365],
  ] as const)('maps %s to calendar days', (selection, intervalDays) => {
    expect(resolveRebalanceSelection(selection, 45, 5)).toEqual({
      mode: 'calendar-interval',
      intervalDays,
      driftThreshold: 5,
    });
  });

  it('uses the custom calendar-day value', () => {
    expect(resolveRebalanceSelection('interval-custom', 45, 5)).toEqual({
      mode: 'calendar-interval',
      intervalDays: 45,
      driftThreshold: 5,
    });
  });

  it.each(['none', 'monthly', 'quarterly', 'annual', 'drift'] as const)(
    'preserves the %s advanced selection',
    (selection) => {
      expect(resolveRebalanceSelection(selection, 45, 7)).toEqual({
        mode: selection,
        driftThreshold: 7,
      });
    },
  );
});

describe('resolveStrategyFormState', () => {
  it('shows custom days only for the custom interval', () => {
    expect(
      resolveStrategyFormState('minimum-floor', 'interval-custom'),
    ).toMatchObject({
      showCustomDays: true,
      showDriftThreshold: false,
    });
    expect(
      resolveStrategyFormState('minimum-floor', 'interval-180'),
    ).toMatchObject({
      showCustomDays: false,
    });
  });

  it('shows the drift threshold only for drift rebalancing', () => {
    expect(resolveStrategyFormState('minimum-floor', 'drift')).toMatchObject({
      showCustomDays: false,
      showDriftThreshold: true,
    });
  });

  it('shows the floor note only in minimum-floor mode', () => {
    expect(resolveStrategyFormState('minimum-floor', 'none')).toMatchObject({
      showFloorNote: true,
      showWarning: false,
    });
    expect(resolveStrategyFormState('exact-target', 'none')).toMatchObject({
      showFloorNote: false,
      showWarning: true,
    });
  });

  it('warns when drift rebalancing can sell winners', () => {
    expect(resolveStrategyFormState('minimum-floor', 'drift')).toMatchObject({
      showWarning: true,
    });
  });
});

describe('reduction form state', () => {
  it('shows trough confirmation only for prototype or leveraged rebound references', () => {
    expect(resolveReductionFormState('new-high-decline')).toEqual({
      showConfirmation: false,
      helperText: '創高後立即回歸正常槓桿比例',
    });
    expect(resolveReductionFormState('prototype-rebound')).toMatchObject({
      showConfirmation: true,
    });
    expect(resolveReductionFormState('leveraged-rebound')).toMatchObject({
      showConfirmation: true,
    });
  });
});

describe('strategy drawer rule controls', () => {
  it('ships three downside-add rows and two reduction rows with +/- controls', () => {
    expect(drawerSource).toContain("[[10,80],[20,90],[30,100]].map");
    expect(drawerSource).toContain("[[10,60],[20,50]].map");
    expect(drawerSource).toContain('data-action="add-rule"');
    expect(drawerSource).toContain('data-action="remove-rule"');
  });

  it('does not include the TradingView logo or data-health panel', () => {
    expect(appSource).not.toMatch(/TradingView|tradingview-logo/i);
    expect(appSource).not.toContain('id="data-health"');
    expect(appSource).not.toContain('id="exposure-track"');
  });

  it('keeps one normal leverage control with an accurate explanation', () => {
    expect((appSource.match(/id="base-weight"/g) ?? []).length).toBe(1);
    expect(appSource).not.toContain('id="high-weight"');
    expect(appSource).toContain('創新高持有正常比例');
    expect(appSource).toContain('只有回撤／反彈規則改變');
    expect(appSource).toContain('新高或反彈減碼會把多餘槓桿轉回原型');
  });

  it('hides the rebound reduction ladder while new-high normalization is selected', () => {
    expect(appSource).toContain('id="reduction-ladder-controls"');
    expect(appSource).toContain("reference === 'new-high-decline'");
  });

  it('lets the chart and overlays pass vertical touch scrolling through', () => {
    expect(cssSource).toMatch(/\.chart-host\s*\{[^}]*touch-action:\s*pan-y;/s);
    expect(cssSource).toMatch(/\.chart-event-layer\s*\{[^}]*touch-action:\s*pan-y;/s);
  });

  it('does not trap page scrolling inside the chart or strategy panel', () => {
    expect(cssSource).toMatch(/\.main\s*\{[^}]*overflow:\s*visible;/s);
    expect(cssSource).toMatch(/\.drawer\s*\{[^}]*overscroll-behavior:\s*auto;/s);
    expect(cssSource).toMatch(/\.drawer\s*\{[^}]*overflow:\s*visible;/s);
  });

  it('wires exposure event markers to a large detail modal', () => {
    expect(appSource).toContain('event-detail-modal');
    expect(appSource).toContain('onEventClick');
    expect(appSource).toContain('addTrades');
    expect(appSource).toContain('reductionTrades');
  });
});

describe('strategy drawer accessibility markup', () => {
  it('associates every drawer label with an existing control', () => {
    expect(
      [...drawerSource.matchAll(/<label(?![^>]*\bfor=")[^>]*>/g)],
    ).toEqual([]);

    const labelTargets = [
      ...drawerSource.matchAll(/<label[^>]*\bfor="([^"]+)"/g),
    ].map((match) => match[1]);

    expect(labelTargets.length).toBeGreaterThan(0);
    for (const target of labelTargets) {
      expect(drawerSource).toContain(`id="${target}"`);
    }
  });

  it('gives every visible input and select an accessible name', () => {
    const missingAccessibleNames = visibleFormControls
      .filter((control) => {
        if (/\baria-label="[^"]+"/.test(control)) return false;
        const id = control.match(/\bid="([^"]+)"/)?.[1];
        return !id || !appSource.includes(`for="${id}"`);
      })
      .map((control) => control.match(/\bid="([^"]+)"/)?.[1] ?? control);

    expect(missingAccessibleNames).toEqual([]);
  });

  it('gives every visible input and select form metadata', () => {
    const missingMetadata = visibleFormControls
      .filter(
        (control) =>
          !/\bname="[^"]+"/.test(control) ||
          !/\bautocomplete="off"/.test(control),
      )
      .map((control) => control.match(/\bid="([^"]+)"/)?.[1] ?? control);

    expect(missingMetadata).toEqual([]);
  });

  it('names icon buttons and exposes live status updates', () => {
    for (const id of ['theme-toggle', 'close-config']) {
      const button = appSource.match(
        new RegExp(`<button[^>]*id="${id}"[^>]*>`),
      )?.[0];
      expect(button).toMatch(/aria-label="[^"]+"/);
    }

    for (const id of ['data-status', 'optimizer-status']) {
      const status = appSource.match(
        new RegExp(`<[^>]*id="${id}"[^>]*>`),
      )?.[0];
      expect(status).toContain('role="status"');
      expect(status).toContain('aria-live="polite"');
    }
  });

  it('keeps drawer scrolling contained and toast feedback live', () => {
    expect(cssSource).toMatch(
      /\.drawer\s*\{[^}]*overscroll-behavior:\s*auto;/s,
    );
    expect(appSource).toContain(
      "toast.setAttribute('role', danger ? 'alert' : 'status');",
    );
    expect(appSource).toContain(
      "toast.setAttribute('aria-live', danger ? 'assertive' : 'polite');",
    );
  });
});
