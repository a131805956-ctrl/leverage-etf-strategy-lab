import type {
  RegimeSnapshot,
  ReductionReference,
  ReductionRule,
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

const deepestReductionRule = (
  strategy: StrategyConfig,
  metricPct: number,
): ReductionRule | undefined =>
  [...(strategy.reductionRules ?? [])]
    .sort((a, b) => a.threshold - b.threshold)
    .filter((rule) => metricPct + 1e-9 >= rule.threshold)
    .at(-1);

const legacyRecoveryRule = (
  strategy: StrategyConfig,
  distanceToHighPct: number,
) =>
  [...strategy.recoveryRules]
    .sort((a, b) => a.distanceToHigh - b.distanceToHigh)
    .find((rule) => distanceToHighPct <= rule.distanceToHigh + 1e-9);

const reductionMetric = (
  reference: ReductionReference,
  state: RegimeSnapshot,
): number => {
  if (reference === 'leveraged-rebound') {
    return state.leveragedReboundPct ?? state.reboundPct;
  }
  if (reference === 'new-high-decline') return state.distanceToHighPct;
  return state.prototypeReboundPct ?? state.reboundPct;
};

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
    if (rule) {
      return {
        ruleKey: `drawdown:${rule.threshold}`,
        leveragedWeight: rule.leveragedWeight,
        reason: 'DRAWDOWN',
      };
    }

    // In new-high mode, a decline only evaluates the add-on ladder. Any
    // leveraged excess is normalized at the next NEW_HIGH exact-target event;
    // never sell into the drawdown itself.
    return undefined;
  }

  const reference = strategy.reductionReference ?? 'prototype-rebound';
  if (
    strategy.reductionRules?.length &&
    reference !== 'new-high-decline'
  ) {
    const reduction = deepestReductionRule(
      strategy,
      reductionMetric(reference, state),
    );
    if (!reduction) return undefined;
    return {
      ruleKey: `reduction:${reduction.threshold}`,
      leveragedWeight: reduction.leveragedWeight,
      reason: 'RECOVERY',
    };
  }

  if (reference === 'new-high-decline') return undefined;

  // Legacy recoveryRules are distance-to-high rules. They remain readable by
  // old saved scenarios and are not mutated while resolving a decision.
  const recoveryRule = legacyRecoveryRule(strategy, state.distanceToHighPct);
  if (!recoveryRule) return undefined;

  return {
    ruleKey: `recovery:${recoveryRule.distanceToHigh}`,
    leveragedWeight: recoveryRule.leveragedWeight,
    reason: 'RECOVERY',
  };
}
