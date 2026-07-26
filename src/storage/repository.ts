import { normalizeStrategyConfig } from '../core/strategyConfig';
import type {
  LegacyStrategyConfig,
  SavedScenario,
  StrategyConfig,
} from '../core/types';
import { validateStrategy } from '../core/validation';
import {
  migrateSavedScenario,
  type MigratableSavedScenario,
} from './migrateScenario';

export interface PortableScenarioFile {
  schemaVersion: 1;
  exportedAt: string;
  scenarios: MigratableSavedScenario[];
}

export interface ScenarioRepository {
  list(): Promise<SavedScenario[]>;
  save(scenario: SavedScenario): Promise<void>;
  remove(id: string): Promise<void>;
  get(id: string): Promise<SavedScenario | undefined>;
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const hasStrings = (value: UnknownRecord, keys: string[]): boolean =>
  keys.every((key) => typeof value[key] === 'string');

const hasNumbers = (value: UnknownRecord, keys: string[]): boolean =>
  keys.every((key) => isFiniteNumber(value[key]));

const isStringNumberRecord = (value: unknown): boolean =>
  isRecord(value) &&
  Object.entries(value).every(
    ([key, amount]) => key.length > 0 && isFiniteNumber(amount),
  );

const isRule = (
  value: unknown,
  thresholdKey: 'threshold' | 'distanceToHigh',
): boolean =>
  isRecord(value) &&
  hasNumbers(value, [thresholdKey, 'leveragedWeight']);

const isCostConfig = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.enabled === 'boolean' &&
  hasNumbers(value, [
    'commissionRate',
    'sellTaxRate',
    'slippageRate',
    'minimumCommission',
  ]);

const rebalanceModes = new Set([
  'event',
  'daily',
  'weekly',
  'calendar-interval',
  'monthly',
  'quarterly',
  'annual',
  'drift',
  'none',
]);

const isStrategy = (
  value: unknown,
): value is StrategyConfig | LegacyStrategyConfig => {
  if (
    !isRecord(value) ||
    !hasStrings(value, ['id', 'name', 'pairId']) ||
    !hasNumbers(value, [
      'baseLeveragedWeight',
      'highLeveragedWeight',
      'recoveryConfirmationPct',
    ]) ||
    !Array.isArray(value.drawdownRules) ||
    !value.drawdownRules.every((rule) => isRule(rule, 'threshold')) ||
    !Array.isArray(value.recoveryRules) ||
    !value.recoveryRules.every((rule) => isRule(rule, 'distanceToHigh')) ||
    !isRecord(value.rebalance) ||
    typeof value.rebalance.mode !== 'string' ||
    !rebalanceModes.has(value.rebalance.mode) ||
    !isFiniteNumber(value.rebalance.driftThreshold) ||
    !isCostConfig(value.costs) ||
    !['total-return', 'price-only', 'cash'].includes(
      value.dividendMode as string,
    ) ||
    value.execution !== 'next-open'
  ) {
    return false;
  }
  if (
    'allocationPolicy' in value &&
    value.allocationPolicy !== 'minimum-floor' &&
    value.allocationPolicy !== 'exact-target'
  ) {
    return false;
  }
  if (
    value.rebalance.mode === 'calendar-interval' &&
    (!Number.isInteger(value.rebalance.intervalDays) ||
      (value.rebalance.intervalDays as number) <= 0)
  ) {
    return false;
  }

  try {
    return validateStrategy(
      normalizeStrategyConfig(
        value as unknown as StrategyConfig | LegacyStrategyConfig,
      ),
    ).length === 0;
  } catch {
    return false;
  }
};

const metricKeys = [
  'finalValue',
  'totalReturn',
  'cagr',
  'annualizedVolatility',
  'downsideVolatility',
  'sharpe',
  'sortino',
  'maxDrawdown',
  'calmar',
  'ulcerIndex',
  'valueAtRisk95',
  'conditionalValueAtRisk95',
  'averageExposure',
  'turnover',
  'tradeCount',
  'totalCosts',
];

const isMetrics = (value: unknown): boolean =>
  isRecord(value) && hasNumbers(value, metricKeys);

const isDailyPoint = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, ['date']) &&
  hasNumbers(value, [
    'value',
    'prototypeValue',
    'leveragedValue',
    'cash',
    'prototypeWeight',
    'leveragedWeight',
    'targetLeveragedWeight',
    'nominalExposure',
    'drawdown',
    'benchmarkPrototype',
    'benchmarkLeveraged',
  ]) &&
  ['AT_HIGH', 'DECLINE', 'RECOVERY'].includes(value.regime as string);

const tradeReasons = new Set([
  'INITIAL',
  'NEW_HIGH',
  'DRAWDOWN',
  'RECOVERY',
  'SCHEDULED_REBALANCE',
  'DRIFT_REBALANCE',
  'DIVIDEND_REINVEST',
]);

const isTrade = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, ['date', 'note']) &&
  typeof value.reason === 'string' &&
  tradeReasons.has(value.reason) &&
  hasNumbers(value, [
    'prototypeValueBefore',
    'leveragedValueBefore',
    'cashBefore',
    'targetLeveragedWeight',
    'tradedValue',
    'cost',
  ]);

const isDrawdown = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, ['peakDate', 'troughDate']) &&
  (value.recoveryDate === undefined ||
    typeof value.recoveryDate === 'string') &&
  hasNumbers(value, ['depth', 'durationDays']);

const isBacktestResult = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, ['id', 'pairId', 'startDate', 'endDate', 'fingerprint']) &&
  isFiniteNumber(value.initialCapital) &&
  isStrategy(value.strategy) &&
  Array.isArray(value.points) &&
  value.points.every(isDailyPoint) &&
  Array.isArray(value.trades) &&
  value.trades.every(isTrade) &&
  Array.isArray(value.drawdowns) &&
  value.drawdowns.every(isDrawdown) &&
  isMetrics(value.metrics);

const portfolioRebalanceModes = new Set([
  'monthly',
  'quarterly',
  'annual',
  'drift',
  'none',
]);

const isPortfolioConfig = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, ['id', 'name']) &&
  isFiniteNumber(value.initialCapital) &&
  Array.isArray(value.allocations) &&
  value.allocations.every(
    (allocation) =>
      isRecord(allocation) &&
      hasStrings(allocation, ['backtestId', 'label']) &&
      isFiniteNumber(allocation.targetWeight),
  ) &&
  isRecord(value.rebalance) &&
  typeof value.rebalance.mode === 'string' &&
  portfolioRebalanceModes.has(value.rebalance.mode) &&
  isFiniteNumber(value.rebalance.driftThreshold);

const isPortfolioPoint = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, ['date']) &&
  hasNumbers(value, ['value', 'drawdown']) &&
  isStringNumberRecord(value.weights);

const isPortfolioTransfer = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, ['date']) &&
  (value.reason === 'SCHEDULED' || value.reason === 'DRIFT') &&
  isStringNumberRecord(value.amounts);

const isPortfolioResult = (value: unknown): boolean =>
  isRecord(value) &&
  hasStrings(value, ['id', 'fingerprint']) &&
  isPortfolioConfig(value.config) &&
  Array.isArray(value.points) &&
  value.points.every(isPortfolioPoint) &&
  Array.isArray(value.transfers) &&
  value.transfers.every(isPortfolioTransfer) &&
  isMetrics(value.metrics);

const isScenario = (value: unknown): value is MigratableSavedScenario => {
  if (
    !isRecord(value) ||
    !hasStrings(value, ['id', 'name', 'createdAt', 'updatedAt']) ||
    !Array.isArray(value.tags) ||
    !value.tags.every((tag) => typeof tag === 'string')
  ) {
    return false;
  }
  if (value.kind === 'pair') return isBacktestResult(value.result);
  if (value.kind === 'portfolio') return isPortfolioResult(value.result);
  return false;
};

export function isPortableScenarioFile(
  value: unknown,
): value is PortableScenarioFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<PortableScenarioFile>;
  return (
    file.schemaVersion === 1 &&
    typeof file.exportedAt === 'string' &&
    Array.isArray(file.scenarios) &&
    file.scenarios.every(isScenario)
  );
}

export class MemoryScenarioRepository implements ScenarioRepository {
  private readonly scenarios = new Map<string, SavedScenario>();

  async list(): Promise<SavedScenario[]> {
    return Promise.resolve(
      [...this.scenarios.values()]
        .map(migrateSavedScenario)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }

  async save(scenario: SavedScenario): Promise<void> {
    this.scenarios.set(scenario.id, scenario);
    return Promise.resolve();
  }

  async remove(id: string): Promise<void> {
    this.scenarios.delete(id);
    return Promise.resolve();
  }

  async get(id: string): Promise<SavedScenario | undefined> {
    const scenario = this.scenarios.get(id);
    return Promise.resolve(
      scenario ? migrateSavedScenario(scenario) : undefined,
    );
  }
}

export const createPortableFile = (
  scenarios: SavedScenario[],
): PortableScenarioFile => ({
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  scenarios,
});
