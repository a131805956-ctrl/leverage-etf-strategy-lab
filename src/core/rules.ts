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

    // A high-decline reduction is allowed as a fallback only when no
    // drawdown add-on step applies. This preserves the "at least this much
    // leveraged exposure" floor semantics of add-on rules.
    if (strategy.reductionReference === 'new-high-decline') {
      const reduction = deepestReductionRule(strategy, state.distanceToHighPct);
      if (reduction) {
        return {
          ruleKey: `reduction:${reduction.threshold}`,
          leveragedWeight: reduction.leveragedWeight,
          reason: 'RECOVERY',
        };
      }
    }
    return undefined;
  }

  const reference = strategy.reductionReference ?? 'prototype-rebound';
  if (strategy.reductionRules?.length) {
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
