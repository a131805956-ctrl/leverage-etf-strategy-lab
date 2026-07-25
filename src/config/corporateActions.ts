import type { SplitEvent } from '../data/twse';

export interface SourcedSplitEvent extends SplitEvent {
  source: string;
}

export const CORPORATE_ACTIONS: Record<string, SourcedSplitEvent[]> = {
  '0050.TW': [
    {
      date: '2025-06-18',
      ratio: 4,
      source:
        'https://www.twse.com.tw/zh/ETFortune/announcement?company=A00005&date=20250617&fund=0050&seq=1&type=all',
    },
  ],
  '00631L.TW': [
    {
      date: '2026-03-31',
      ratio: 22,
      source:
        'https://wwwc.twse.com.tw/zh/ETFortune/announcement?company=A00005&date=20260330&fund=00631L&seq=1&type=other',
    },
  ],
  '00646.TW': [],
  '00647L.TW': [],
};
