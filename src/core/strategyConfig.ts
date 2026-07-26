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

  return {
    ...strategy,
    allocationPolicy: allocationPolicy ?? 'exact-target',
    rebalance: normalizeRebalance(rebalance),
  };
}
