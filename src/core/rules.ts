import type {
  RegimeSnapshot,
  StrategyConfig,
  TradeReason,
} from './types';

export interface AllocationDecision {
  leveragedWeight: number;
  reason: Extract<TradeReason, 'NEW_HIGH' | 'DRAWDOWN' | 'RECOVERY'>;
}

const drawdownWeight = (
  strategy: StrategyConfig,
  drawdownPct: number,
): number => {
  const reached = [...strategy.drawdownRules]
    .sort((a, b) => a.threshold - b.threshold)
    .filter((rule) => drawdownPct + 1e-9 >= rule.threshold);
  return reached.at(-1)?.leveragedWeight ?? strategy.baseLeveragedWeight;
};

export function resolveTargetAllocation(
  strategy: StrategyConfig,
  state: RegimeSnapshot,
): AllocationDecision {
  if (state.regime === 'AT_HIGH') {
    return {
      leveragedWeight: strategy.highLeveragedWeight,
      reason: 'NEW_HIGH',
    };
  }

  if (state.regime === 'DECLINE') {
    return {
      leveragedWeight: drawdownWeight(strategy, state.drawdownPct),
      reason: 'DRAWDOWN',
    };
  }

  const recoveryRule = [...strategy.recoveryRules]
    .sort((a, b) => a.distanceToHigh - b.distanceToHigh)
    .find(
      (rule) => state.distanceToHighPct <= rule.distanceToHigh + 1e-9,
    );

  return {
    leveragedWeight:
      recoveryRule?.leveragedWeight ??
      drawdownWeight(strategy, state.drawdownPct),
    reason: 'RECOVERY',
  };
}
