import type { IsoDate, RegimeSnapshot } from './types';

const pct = (value: number): number =>
  Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(10));

export function initialRegime(price: number, date: IsoDate): RegimeSnapshot {
  if (!(price > 0)) throw new Error('市場價格必須大於零');
  return {
    regime: 'AT_HIGH',
    runningHigh: price,
    runningHighDate: date,
    trough: price,
    troughDate: date,
    drawdownPct: 0,
    reboundPct: 0,
    distanceToHighPct: 0,
  };
}

export function advanceRegime(
  previous: RegimeSnapshot,
  price: number,
  date: IsoDate,
  recoveryConfirmationPct: number,
): RegimeSnapshot {
  if (!(price > 0)) throw new Error('市場價格必須大於零');
  if (price >= previous.runningHigh) return initialRegime(price, date);

  const isNewTrough = price < previous.trough;
  const trough = isNewTrough ? price : previous.trough;
  const troughDate = isNewTrough ? date : previous.troughDate;
  const reboundPct = pct((price / trough - 1) * 100);
  const drawdownPct = pct((1 - price / previous.runningHigh) * 100);
  const distanceToHighPct = drawdownPct;

  let regime = previous.regime;
  if (isNewTrough || previous.regime === 'AT_HIGH') {
    regime = 'DECLINE';
  } else if (
    previous.regime === 'DECLINE' &&
    reboundPct + 1e-9 >= recoveryConfirmationPct
  ) {
    regime = 'RECOVERY';
  }

  return {
    regime,
    runningHigh: previous.runningHigh,
    runningHighDate: previous.runningHighDate,
    trough,
    troughDate,
    drawdownPct,
    reboundPct,
    distanceToHighPct,
  };
}
