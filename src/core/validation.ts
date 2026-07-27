import type { StrategyConfig } from './types';

const inPercentRange = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 100;

const hasDuplicates = (values: number[]): boolean =>
  new Set(values).size !== values.length;

export function validateStrategy(strategy: StrategyConfig): string[] {
  const errors: string[] = [];

  if (!strategy.name.trim()) errors.push('策略名稱不可空白');
  if (
    strategy.allocationPolicy !== 'minimum-floor' &&
    strategy.allocationPolicy !== 'exact-target'
  ) {
    errors.push('配置政策必須是最低底線或精確目標');
  }
  if (!inPercentRange(strategy.baseLeveragedWeight)) {
    errors.push('基礎槓桿 ETF 權重必須介於 0% 到 100%');
  }
  if (!inPercentRange(strategy.highLeveragedWeight)) {
    errors.push('創新高槓桿 ETF 權重必須介於 0% 到 100%');
  }
  if (
    strategy.normalLeveragedWeight !== undefined &&
    !inPercentRange(strategy.normalLeveragedWeight)
  ) {
    errors.push('Normal leverage must be between 0% and 100%');
  }
  if (hasDuplicates(strategy.drawdownRules.map((rule) => rule.threshold))) {
    errors.push('回撤門檻不可重複');
  }
  if (hasDuplicates(strategy.recoveryRules.map((rule) => rule.distanceToHigh))) {
    errors.push('反彈門檻不可重複');
  }
  if (
    strategy.drawdownRules.some(
      (rule) =>
        rule.threshold <= 0 ||
        rule.threshold > 100 ||
        !inPercentRange(rule.leveragedWeight),
    )
  ) {
    errors.push('回撤規則的門檻與權重必須介於有效範圍');
  }
  if (
    strategy.recoveryRules.some(
      (rule) =>
        rule.distanceToHigh < 0 ||
        rule.distanceToHigh > 100 ||
        !inPercentRange(rule.leveragedWeight),
    )
  ) {
    errors.push('反彈規則的門檻與權重必須介於有效範圍');
  }
  if (
    strategy.reductionRules &&
    hasDuplicates(strategy.reductionRules.map((rule) => rule.threshold))
  ) {
    errors.push('Reduction thresholds must be unique');
  }
  if (
    strategy.reductionRules?.some(
      (rule) =>
        rule.threshold <= 0 ||
        rule.threshold > 100 ||
        !inPercentRange(rule.leveragedWeight),
    )
  ) {
    errors.push('Reduction thresholds and weights must be within range');
  }
  if (
    strategy.reductionReference &&
    !['new-high-decline', 'prototype-rebound', 'leveraged-rebound'].includes(
      strategy.reductionReference,
    )
  ) {
    errors.push('Unknown reduction reference');
  }
  if (strategy.execution !== 'next-open') {
    errors.push('正式回測只允許下一交易日開盤成交');
  }
  if (
    strategy.rebalance.mode === 'calendar-interval' &&
    (!Number.isInteger(strategy.rebalance.intervalDays) ||
      (strategy.rebalance.intervalDays ?? 0) <= 0)
  ) {
    errors.push('日曆天再平衡必須是正整數');
  }
  if (
    !Number.isFinite(strategy.rebalance.driftThreshold) ||
    strategy.rebalance.driftThreshold <= 0 ||
    strategy.rebalance.driftThreshold > 50
  ) {
    errors.push('權重偏離門檻必須大於 0 且不超過 50 個百分點');
  }
  if (strategy.costs.enabled) {
    const costValues = [
      strategy.costs.commissionRate,
      strategy.costs.sellTaxRate,
      strategy.costs.slippageRate,
      strategy.costs.minimumCommission,
    ];
    if (costValues.some((value) => !Number.isFinite(value) || value < 0)) {
      errors.push('交易成本不可為負數');
    }
  }
  return errors;
}
