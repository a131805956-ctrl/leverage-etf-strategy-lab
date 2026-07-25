import type { PairDefinition } from '../core/types';

export const PAIRS: PairDefinition[] = [
  {
    id: 'tw50',
    name: '臺灣 50 曝險組',
    market: '臺灣',
    prototype: { symbol: '0050.TW', name: '元大台灣50' },
    leveraged: {
      symbol: '00631L.TW',
      name: '元大台灣50正2',
      nominalLeverage: 2,
    },
  },
  {
    id: 'sp500',
    name: 'S&P 500 曝險組',
    market: '美國／臺灣掛牌',
    prototype: { symbol: '00646.TW', name: '元大S&P500' },
    leveraged: {
      symbol: '00647L.TW',
      name: '元大S&P500正2',
      nominalLeverage: 2,
    },
  },
];

export const pairById = (id: string): PairDefinition => {
  const pair = PAIRS.find((candidate) => candidate.id === id);
  if (!pair) throw new Error(`未知交易對：${id}`);
  return pair;
};
