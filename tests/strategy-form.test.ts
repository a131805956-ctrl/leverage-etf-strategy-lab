import { describe, expect, it } from 'vitest';

import {
  resolveRebalanceSelection,
  resolveStrategyFormState,
} from '../src/ui/strategyForm';

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
