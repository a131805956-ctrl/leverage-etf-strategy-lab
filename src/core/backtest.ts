import { fingerprint } from './fingerprint';
import { calculateMetrics, findDrawdownEpisodes } from './metrics';
import { advanceRegime, initialRegime } from './regime';
import { scheduledRebalanceDue } from './rebalance';
import { resolveAllocationRule } from './rules';
import { normalizeStrategyConfig } from './strategyConfig';
import type {
  BacktestInput,
  BacktestResult,
  DailyPoint,
  IsoDate,
  PriceBar,
  RegimeSnapshot,
  StrategyConfig,
  TradeReason,
  TradeRecord,
} from './types';
import { validateStrategy } from './validation';

interface AlignedBar {
  date: IsoDate;
  prototype: PriceBar;
  leveraged: PriceBar;
}

interface Position {
  prototypeShares: number;
  leveragedShares: number;
  cash: number;
}

interface PendingTrade {
  targetLeveragedWeight: number;
  reason: TradeReason;
  note: string;
  policy: 'exact-target' | 'minimum-floor';
}

const TRADE_TOLERANCE = 1e-9;

const effectivePrice = (
  bar: PriceBar,
  field: 'open' | 'close',
  totalReturn: boolean,
): number => {
  if (!totalReturn) return bar[field];
  const adjustment = bar.close > 0 ? bar.adjustedClose / bar.close : 1;
  return field === 'close' ? bar.adjustedClose : bar.open * adjustment;
};

const alignBars = (input: BacktestInput): AlignedBar[] => {
  const leveraged = new Map(
    input.leveraged.bars.map((bar) => [bar.date, bar] as const),
  );
  return input.prototype.bars
    .filter((bar) => leveraged.has(bar.date))
    .map((bar) => ({
      date: bar.date,
      prototype: bar,
      leveraged: leveraged.get(bar.date) as PriceBar,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
};

const feeForTrade = (
  buyValue: number,
  sellValue: number,
  strategy: StrategyConfig,
): number => {
  const costs = strategy.costs;
  if (!costs.enabled) return 0;
  const gross = buyValue + sellValue;
  const commission =
    gross > 0
      ? Math.max(gross * costs.commissionRate, costs.minimumCommission)
      : 0;
  return (
    commission +
    sellValue * costs.sellTaxRate +
    gross * costs.slippageRate
  );
};

const rebalance = (
  position: Position,
  prototypeOpen: number,
  leveragedOpen: number,
  targetLeveragedWeight: number,
  strategy: StrategyConfig,
  useCash: number,
): { tradedValue: number; cost: number } => {
  const prototypeBefore = position.prototypeShares * prototypeOpen;
  const leveragedBefore = position.leveragedShares * leveragedOpen;
  const capital = prototypeBefore + leveragedBefore + useCash;
  const targetLeveragedBeforeCost = capital * (targetLeveragedWeight / 100);
  const targetPrototypeBeforeCost = capital - targetLeveragedBeforeCost;
  const buyValue =
    Math.max(0, targetLeveragedBeforeCost - leveragedBefore) +
    Math.max(0, targetPrototypeBeforeCost - prototypeBefore);
  const sellValue =
    Math.max(0, leveragedBefore - targetLeveragedBeforeCost) +
    Math.max(0, prototypeBefore - targetPrototypeBeforeCost);
  const tradedValue = buyValue + sellValue;
  if (tradedValue <= TRADE_TOLERANCE) {
    return { tradedValue: 0, cost: 0 };
  }

  const cost = Math.min(capital, feeForTrade(buyValue, sellValue, strategy));
  const afterCost = Math.max(0, capital - cost);
  const targetLeveraged = afterCost * (targetLeveragedWeight / 100);
  const targetPrototype = afterCost - targetLeveraged;
  position.prototypeShares = targetPrototype / prototypeOpen;
  position.leveragedShares = targetLeveraged / leveragedOpen;
  position.cash -= useCash;
  return { tradedValue, cost };
};

const historyState = (
  rows: AlignedBar[],
  strategy: StrategyConfig,
  startDate: IsoDate,
): RegimeSnapshot | undefined => {
  const totalReturn = strategy.dividendMode === 'total-return';
  let state: RegimeSnapshot | undefined;
  for (const row of rows.filter((item) => item.date < startDate)) {
    const price = effectivePrice(row.prototype, 'close', totalReturn);
    state = state
      ? advanceRegime(
          state,
          price,
          row.date,
          strategy.recoveryConfirmationPct,
        )
      : initialRegime(price, row.date);
  }
  return state;
};

export function runBacktest(input: BacktestInput): BacktestResult {
  const strategy = normalizeStrategyConfig(input.strategy);
  const errors = validateStrategy(strategy);
  if (errors.length) throw new Error(errors.join('；'));
  if (!(input.initialCapital > 0)) throw new Error('初始投入金額必須大於零');

  const aligned = alignBars(input);
  const selected = aligned.filter(
    (row) => row.date >= input.startDate && row.date <= input.endDate,
  );
  if (!selected.length) throw new Error('指定期間沒有共同交易日');

  const firstRow = selected[0] as AlignedBar;
  const effectiveStartDate = firstRow.date;
  const totalReturn = strategy.dividendMode === 'total-return';
  const prototypeDividends = new Map(
    input.prototype.dividends.map((event) => [event.date, event.amountPerShare]),
  );
  const leveragedDividends = new Map(
    input.leveraged.dividends.map((event) => [event.date, event.amountPerShare]),
  );
  const reinvestments = new Map(
    (input.dividendReinvestments ?? []).map((item) => [item.date, item.target]),
  );

  let regime = historyState(aligned, strategy, effectiveStartDate);
  let currentRuleFloor = strategy.baseLeveragedWeight;
  let activeRuleKey: string | undefined;
  let pending: PendingTrade | undefined = {
    targetLeveragedWeight: strategy.baseLeveragedWeight,
    reason: 'INITIAL',
    policy: 'exact-target',
    note: '依開始日前已知資料建立初始持倉',
  };
  const position: Position = {
    prototypeShares: 0,
    leveragedShares: 0,
    cash: input.initialCapital,
  };
  const points: DailyPoint[] = [];
  const trades: TradeRecord[] = [];
  let runningPeak = input.initialCapital;

  const firstPrototypeOpen = effectivePrice(
    firstRow.prototype,
    'open',
    totalReturn,
  );
  const firstLeveragedOpen = effectivePrice(
    firstRow.leveraged,
    'open',
    totalReturn,
  );

  selected.forEach((row, index) => {
    const prototypeOpen = effectivePrice(row.prototype, 'open', totalReturn);
    const leveragedOpen = effectivePrice(row.leveraged, 'open', totalReturn);
    const prototypeClose = effectivePrice(row.prototype, 'close', totalReturn);
    const leveragedClose = effectivePrice(row.leveraged, 'close', totalReturn);

    if (pending) {
      const prototypeBefore = position.prototypeShares * prototypeOpen;
      const leveragedBefore = position.leveragedShares * leveragedOpen;
      const cashBefore = position.cash;
      const useCash = pending.reason === 'INITIAL' ? position.cash : 0;
      const investedBefore = prototypeBefore + leveragedBefore;
      const actualLeveragedWeight =
        investedBefore > 0 ? (leveragedBefore / investedBefore) * 100 : 0;
      const shouldTrade =
        pending.reason === 'INITIAL' ||
        (pending.policy === 'exact-target'
          ? Math.abs(
              actualLeveragedWeight - pending.targetLeveragedWeight,
            ) > TRADE_TOLERANCE
          : actualLeveragedWeight + TRADE_TOLERANCE <
            pending.targetLeveragedWeight);

      if (shouldTrade) {
        const execution = rebalance(
          position,
          prototypeOpen,
          leveragedOpen,
          pending.targetLeveragedWeight,
          strategy,
          useCash,
        );
        if (execution.tradedValue > TRADE_TOLERANCE) {
          trades.push({
            date: row.date,
            reason: pending.reason,
            prototypeValueBefore: prototypeBefore,
            leveragedValueBefore: leveragedBefore,
            cashBefore,
            targetLeveragedWeight: pending.targetLeveragedWeight,
            tradedValue: execution.tradedValue,
            cost: execution.cost,
            note: pending.note,
          });
        }
      }
      pending = undefined;
    }

    const reinvestTarget = reinvestments.get(row.date);
    if (reinvestTarget && position.cash > 0) {
      const cashBefore = position.cash;
      let leveragedWeight = currentRuleFloor;
      if (reinvestTarget === 'prototype') leveragedWeight = 0;
      if (reinvestTarget === 'leveraged') leveragedWeight = 100;
      const execution = rebalance(
        position,
        prototypeOpen,
        leveragedOpen,
        leveragedWeight,
        strategy,
        position.cash,
      );
      trades.push({
        date: row.date,
        reason: 'DIVIDEND_REINVEST',
        prototypeValueBefore: position.prototypeShares * prototypeOpen,
        leveragedValueBefore: position.leveragedShares * leveragedOpen,
        cashBefore,
        targetLeveragedWeight: leveragedWeight,
        tradedValue: execution.tradedValue,
        cost: execution.cost,
        note: `待投入股息投入 ${reinvestTarget}`,
      });
    }

    if (strategy.dividendMode === 'cash') {
      position.cash +=
        position.prototypeShares * (prototypeDividends.get(row.date) ?? 0);
      position.cash +=
        position.leveragedShares * (leveragedDividends.get(row.date) ?? 0);
    }

    const prototypeValue = position.prototypeShares * prototypeClose;
    const leveragedValue = position.leveragedShares * leveragedClose;
    const investedValue = prototypeValue + leveragedValue;
    const value = investedValue + position.cash;
    const prototypeWeight =
      investedValue > 0 ? (prototypeValue / investedValue) * 100 : 0;
    const leveragedWeight =
      investedValue > 0 ? (leveragedValue / investedValue) * 100 : 0;
    runningPeak = Math.max(runningPeak, value);
    const drawdown = runningPeak > 0 ? (1 - value / runningPeak) * 100 : 0;

    regime = regime
      ? advanceRegime(
          regime,
          prototypeClose,
          row.date,
          strategy.recoveryConfirmationPct,
        )
      : initialRegime(prototypeClose, row.date);

    const decision = resolveAllocationRule(strategy, regime);
    const ruleChanged = decision?.ruleKey !== activeRuleKey;
    activeRuleKey = decision?.ruleKey;
    if (decision && ruleChanged) {
      currentRuleFloor = decision.leveragedWeight;
    }
    const next = selected[index + 1];

    points.push({
      date: row.date,
      value,
      prototypeValue,
      leveragedValue,
      cash: position.cash,
      prototypeWeight,
      leveragedWeight,
      targetLeveragedWeight: currentRuleFloor,
      nominalExposure:
        prototypeWeight +
        leveragedWeight * input.pair.leveraged.nominalLeverage,
      drawdown,
      regime: regime.regime,
      benchmarkPrototype:
        input.initialCapital * (prototypeClose / firstPrototypeOpen),
      benchmarkLeveraged:
        input.initialCapital * (leveragedClose / firstLeveragedOpen),
    });

    if (!next) return;

    const rebalanceConfig = strategy.rebalance;
    const mode = rebalanceConfig.mode;
    if (
      scheduledRebalanceDue(
        rebalanceConfig,
        effectiveStartDate,
        row.date,
        next.date,
      )
    ) {
      pending = {
        targetLeveragedWeight: currentRuleFloor,
        reason: 'SCHEDULED_REBALANCE',
        note: `${mode} 定期再平衡`,
        policy: 'exact-target',
      };
    } else if (decision && ruleChanged) {
      pending = {
        targetLeveragedWeight: decision.leveragedWeight,
        reason: decision.reason,
        note: `${regime.regime}：距前高 ${regime.distanceToHighPct.toFixed(2)}%`,
        policy: strategy.allocationPolicy,
      };
    } else if (
      mode === 'drift' &&
      Math.abs(leveragedWeight - currentRuleFloor) >=
        strategy.rebalance.driftThreshold
    ) {
      pending = {
        targetLeveragedWeight: currentRuleFloor,
        reason: 'DRIFT_REBALANCE',
        note: `實際權重偏離 ${Math.abs(leveragedWeight - currentRuleFloor).toFixed(2)} 個百分點`,
        policy: 'exact-target',
      };
    }
  });

  const drawdowns = findDrawdownEpisodes(points);
  const metrics = calculateMetrics(
    points,
    trades,
    input.initialCapital,
    input.annualRiskFreeRate,
  );
  const resultWithoutFingerprint = {
    id: `${strategy.id}-${input.startDate}-${input.endDate}`,
    pairId: input.pair.id,
    strategy,
    startDate: effectiveStartDate,
    endDate: (selected.at(-1) as AlignedBar).date,
    initialCapital: input.initialCapital,
    points,
    trades,
    drawdowns,
    metrics,
  };

  return {
    ...resultWithoutFingerprint,
    fingerprint: fingerprint(resultWithoutFingerprint),
  };
}
