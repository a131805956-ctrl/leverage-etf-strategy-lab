import type {
  LegacyStrategyConfig,
  StrategyConfig,
  StrategyRebalanceMode,
} from './types';

const normalizeRebalance = (
  rebalance: StrategyConfig['rebalance'] | LegacyStrategyConfig['rebalance'],
): StrategyConfig['rebalance'] => {
  if (rebalance.mode === 'event') {
    return { mode: 'none', driftThreshold: rebalance.driftThreshold };
  }
  if (rebalance.mode === 'daily') {
    return {
      mode: 'calendar-interval',
      intervalDays: 1,
      driftThreshold: rebalance.driftThreshold,
    };
  }
  if (rebalance.mode === 'weekly') {
    return {
      mode: 'calendar-interval',
      intervalDays: 7,
      driftThreshold: rebalance.driftThreshold,
    };
  }

  return {
    ...rebalance,
    mode: rebalance.mode as StrategyRebalanceMode,
  };
};

export function normalizeStrategyConfig(
  value: StrategyConfig | LegacyStrategyConfig,
): StrategyConfig {
  const { rebalance, ...strategy } = value;

  return {
    ...strategy,
    allocationPolicy:
      'allocationPolicy' in value ? value.allocationPolicy : 'exact-target',
    rebalance: normalizeRebalance(rebalance),
  };
}
