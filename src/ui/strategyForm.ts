import type { StrategyConfig } from '../core/types';

export type ReductionReference =
  | 'new-high-decline'
  | 'prototype-rebound'
  | 'leveraged-rebound';

export interface ReductionFormState {
  showConfirmation: boolean;
  helperText: string;
}

/** The trough confirmation is meaningful only when a rebound series is selected. */
export function resolveReductionFormState(
  reference: ReductionReference,
): ReductionFormState {
  if (reference === 'prototype-rebound') {
    return {
      showConfirmation: true,
      helperText: '以原型 ETF 自谷底反彈幅度觸發減倉',
    };
  }
  if (reference === 'leveraged-rebound') {
    return {
      showConfirmation: true,
      helperText: '以槓桿 ETF 自谷底反彈幅度觸發減倉',
    };
  }
  return {
    showConfirmation: false,
    helperText: '創高後立即回歸正常槓桿比例',
  };
}

export interface StrategyFormState {
  showCustomDays: boolean;
  showDriftThreshold: boolean;
  showFloorNote: boolean;
  showWarning: boolean;
}

export function resolveStrategyFormState(
  allocationPolicy: StrategyConfig['allocationPolicy'],
  rebalanceSelection: string,
): StrategyFormState {
  return {
    showCustomDays: rebalanceSelection === 'interval-custom',
    showDriftThreshold: rebalanceSelection === 'drift',
    showFloorNote: allocationPolicy === 'minimum-floor',
    showWarning:
      allocationPolicy === 'exact-target' ||
      rebalanceSelection === 'drift',
  };
}

export function resolveRebalanceSelection(
  selection: string,
  customDays: number,
  driftThreshold: number,
): StrategyConfig['rebalance'] {
  const presetDays: Record<string, number> = {
    'interval-30': 30,
    'interval-180': 180,
    'interval-365': 365,
  };

  if (selection in presetDays || selection === 'interval-custom') {
    return {
      mode: 'calendar-interval',
      intervalDays:
        selection === 'interval-custom'
          ? customDays
          : presetDays[selection],
      driftThreshold,
    };
  }

  const mode =
    selection === 'monthly' ||
    selection === 'quarterly' ||
    selection === 'annual' ||
    selection === 'drift'
      ? selection
      : 'none';

  return { mode, driftThreshold };
}
