export type IsoDate = `${number}-${number}-${number}`;

export interface PriceBar {
  date: IsoDate;
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose: number;
  volume: number;
}

export interface DividendEvent {
  date: IsoDate;
  amountPerShare: number;
}

export interface MarketSeries {
  symbol: string;
  bars: PriceBar[];
  dividends: DividendEvent[];
}

export interface PairDefinition {
  id: string;
  name: string;
  market: string;
  prototype: { symbol: string; name: string };
  leveraged: { symbol: string; name: string; nominalLeverage: number };
}

export type DividendMode = 'total-return' | 'price-only' | 'cash';
export type ExecutionModel = 'next-open';
export type RebalanceMode =
  | 'event'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'annual'
  | 'drift'
  | 'none';

export interface CostConfig {
  enabled: boolean;
  commissionRate: number;
  sellTaxRate: number;
  slippageRate: number;
  minimumCommission: number;
}

export interface DrawdownRule {
  threshold: number;
  leveragedWeight: number;
}

export interface RecoveryRule {
  distanceToHigh: number;
  leveragedWeight: number;
}

export interface StrategyConfig {
  id: string;
  name: string;
  pairId: string;
  baseLeveragedWeight: number;
  highLeveragedWeight: number;
  drawdownRules: DrawdownRule[];
  recoveryRules: RecoveryRule[];
  recoveryConfirmationPct: number;
  rebalance: {
    mode: RebalanceMode;
    driftThreshold: number;
  };
  dividendMode: DividendMode;
  execution: ExecutionModel;
  costs: CostConfig;
}

export type MarketRegime = 'AT_HIGH' | 'DECLINE' | 'RECOVERY';

export interface RegimeSnapshot {
  regime: MarketRegime;
  runningHigh: number;
  runningHighDate: IsoDate;
  trough: number;
  troughDate: IsoDate;
  drawdownPct: number;
  reboundPct: number;
  distanceToHighPct: number;
}

export type TradeReason =
  | 'INITIAL'
  | 'NEW_HIGH'
  | 'DRAWDOWN'
  | 'RECOVERY'
  | 'SCHEDULED_REBALANCE'
  | 'DRIFT_REBALANCE'
  | 'DIVIDEND_REINVEST';

export interface TradeRecord {
  date: IsoDate;
  reason: TradeReason;
  prototypeValueBefore: number;
  leveragedValueBefore: number;
  cashBefore: number;
  targetLeveragedWeight: number;
  tradedValue: number;
  cost: number;
  note: string;
}

export interface DailyPoint {
  date: IsoDate;
  value: number;
  prototypeValue: number;
  leveragedValue: number;
  cash: number;
  prototypeWeight: number;
  leveragedWeight: number;
  targetLeveragedWeight: number;
  nominalExposure: number;
  drawdown: number;
  regime: MarketRegime;
  benchmarkPrototype: number;
  benchmarkLeveraged: number;
}

export interface DrawdownEpisode {
  peakDate: IsoDate;
  troughDate: IsoDate;
  recoveryDate?: IsoDate;
  depth: number;
  durationDays: number;
}

export interface PerformanceMetrics {
  finalValue: number;
  totalReturn: number;
  cagr: number;
  annualizedVolatility: number;
  downsideVolatility: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  calmar: number;
  ulcerIndex: number;
  valueAtRisk95: number;
  conditionalValueAtRisk95: number;
  averageExposure: number;
  turnover: number;
  tradeCount: number;
  totalCosts: number;
}

export interface BacktestResult {
  id: string;
  pairId: string;
  strategy: StrategyConfig;
  startDate: IsoDate;
  endDate: IsoDate;
  initialCapital: number;
  points: DailyPoint[];
  trades: TradeRecord[];
  drawdowns: DrawdownEpisode[];
  metrics: PerformanceMetrics;
  fingerprint: string;
}

export interface BacktestInput {
  pair: PairDefinition;
  strategy: StrategyConfig;
  prototype: MarketSeries;
  leveraged: MarketSeries;
  startDate: IsoDate;
  endDate: IsoDate;
  initialCapital: number;
  annualRiskFreeRate?: number;
  dividendReinvestments?: Array<{
    date: IsoDate;
    target: 'prototype' | 'leveraged' | 'target-allocation';
  }>;
}

export interface PortfolioAllocation {
  backtestId: string;
  label: string;
  targetWeight: number;
}

export interface PortfolioConfig {
  id: string;
  name: string;
  initialCapital: number;
  allocations: PortfolioAllocation[];
  rebalance: {
    mode: Extract<RebalanceMode, 'monthly' | 'quarterly' | 'annual' | 'drift' | 'none'>;
    driftThreshold: number;
  };
}

export interface PortfolioPoint {
  date: IsoDate;
  value: number;
  weights: Record<string, number>;
  drawdown: number;
}

export interface PortfolioResult {
  id: string;
  config: PortfolioConfig;
  points: PortfolioPoint[];
  transfers: Array<{
    date: IsoDate;
    reason: 'SCHEDULED' | 'DRIFT';
    amounts: Record<string, number>;
  }>;
  metrics: PerformanceMetrics;
  fingerprint: string;
}

export interface SavedScenario {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  kind: 'pair' | 'portfolio';
  tags: string[];
  result: BacktestResult | PortfolioResult;
}

export interface MarketDataBundle {
  generatedAt: string;
  source: string;
  requiredCutoff: IsoDate;
  series: Record<string, MarketSeries>;
}
