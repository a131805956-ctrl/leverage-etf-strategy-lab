import type {
  LegacyStrategyConfig,
  StrategyConfig,
} from './types';

const normalizeRebalance = (
  rebalance: StrategyConfig['rebalance'] | LegacyStrategyConfig['rebalance'],
): StrategyConfig['rebalance'] => {
  if (rebalance.mode === 'event') {
    return { ...rebalance, mode: 'none' };
  }
  if (rebalance.mode === 'daily') {
    return {
      ...rebalance,
      mode: 'calendar-interval',
      intervalDays: 1,
    };
  }
  if (rebalance.mode === 'weekly') {
    return {
      ...rebalance,
      mode: 'calendar-interval',
      intervalDays: 7,
    };
  }

  return {
    ...rebalance,
    mode: rebalance.mode,
  };
};

export function normalizeStrategyConfig(
  value: StrategyConfig | LegacyStrategyConfig,
): StrategyConfig {
  const { rebalance, ...strategy } = value;
  const allocationPolicy =
    'allocationPolicy' in value ? value.allocationPolicy : undefined;

  const hasNewReductionRules = Array.isArray(
    (value as Partial<StrategyConfig>).reductionRules,
  );
  const reductionReference =
    (value as Partial<StrategyConfig>).reductionReference ??
    // Legacy scenarios used recoveryRules as prototype-distance rules. Keep
    // that behavior while new scenarios opt into the explicit high-decline
    // default through reductionRules or an explicit reference.
    (hasNewReductionRules ? 'new-high-decline' : 'prototype-rebound');

  const reductionRules = hasNewReductionRules
    ? ((value as Partial<StrategyConfig>).reductionRules ?? []).map((rule) => ({
        threshold: rule?.threshold ?? 0,
        leveragedWeight: rule?.leveragedWeight ?? 0,
      }))
    : undefined;

  return {
    ...strategy,
    allocationPolicy: allocationPolicy ?? 'exact-target',
    reductionReference,
    ...(reductionRules ? { reductionRules } : {}),
    rebalance: normalizeRebalance(rebalance),
  };
}
