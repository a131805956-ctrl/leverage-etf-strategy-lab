import type {
  RegimeSnapshot,
  StrategyConfig,
  TradeReason,
} from './types';

export interface AllocationRuleEvent {
  ruleKey: string;
  leveragedWeight: number;
  reason: Extract<TradeReason, 'NEW_HIGH' | 'DRAWDOWN' | 'RECOVERY'>;
}

const deepestDrawdownRule = (
  strategy: StrategyConfig,
  drawdownPct: number,
): StrategyConfig['drawdownRules'][number] | undefined =>
  [...strategy.drawdownRules]
    .sort((a, b) => a.threshold - b.threshold)
    .filter((rule) => drawdownPct + 1e-9 >= rule.threshold)
    .at(-1);

export function resolveAllocationRule(
  strategy: StrategyConfig,
  state: RegimeSnapshot,
): AllocationRuleEvent | undefined {
  if (state.regime === 'AT_HIGH') {
    return {
      ruleKey: 'new-high',
      leveragedWeight: strategy.highLeveragedWeight,
      reason: 'NEW_HIGH',
    };
  }

  if (state.regime === 'DECLINE') {
    const rule = deepestDrawdownRule(strategy, state.drawdownPct);
    if (!rule) return undefined;

    return {
      ruleKey: `drawdown:${rule.threshold}`,
      leveragedWeight: rule.leveragedWeight,
      reason: 'DRAWDOWN',
    };
  }

  const recoveryRule = [...strategy.recoveryRules]
    .sort((a, b) => a.distanceToHigh - b.distanceToHigh)
    .find(
      (rule) => state.distanceToHighPct <= rule.distanceToHigh + 1e-9,
    );
  if (!recoveryRule) return undefined;

  return {
    ruleKey: `recovery:${recoveryRule.distanceToHigh}`,
    leveragedWeight: recoveryRule.leveragedWeight,
    reason: 'RECOVERY',
  };
}
