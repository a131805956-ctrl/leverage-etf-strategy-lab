import { normalizeStrategyConfig } from '../core/strategyConfig';
import type {
  BacktestResult,
  LegacyStrategyConfig,
  SavedScenario,
  StrategyConfig,
} from '../core/types';

type ExecutableResult = BacktestResult & {
  strategy: StrategyConfig | LegacyStrategyConfig;
};

const hasExecutableStrategy = (
  result: SavedScenario['result'],
): result is ExecutableResult => {
  if (!('strategy' in result)) return false;
  const strategy = result.strategy as unknown;
  if (!strategy || typeof strategy !== 'object') return false;
  const rebalance = (strategy as { rebalance?: unknown }).rebalance;
  return Boolean(rebalance && typeof rebalance === 'object');
};

const needsStrategyMigration = (
  strategy: StrategyConfig | LegacyStrategyConfig,
): boolean => {
  const mode = strategy.rebalance.mode;
  return (
    !('allocationPolicy' in strategy) ||
    mode === 'event' ||
    mode === 'daily' ||
    mode === 'weekly'
  );
};

/**
 * Returns a current executable view of a saved scenario without rewriting any
 * persisted result series, trades, metrics, or fingerprint.
 */
export function migrateSavedScenario(scenario: SavedScenario): SavedScenario {
  if (!hasExecutableStrategy(scenario.result)) return scenario;
  if (!needsStrategyMigration(scenario.result.strategy)) return scenario;

  return {
    ...scenario,
    result: {
      ...scenario.result,
      strategy: normalizeStrategyConfig(scenario.result.strategy),
    },
  };
}
