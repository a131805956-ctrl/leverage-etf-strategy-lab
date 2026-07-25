import type { BacktestResult, PortfolioResult } from '../core/types';

type AnyResult = BacktestResult | PortfolioResult;

export interface AnalysisBundle {
  schemaVersion: 1;
  exportedAt: string;
  dataSource: string;
  dataGeneratedAt: string;
  resultFingerprint: string;
  resultType: 'pair' | 'portfolio';
  configuration: unknown;
  metrics: AnyResult['metrics'];
  drawdowns: BacktestResult['drawdowns'];
  trades: BacktestResult['trades'] | PortfolioResult['transfers'];
  annualReturns: Record<string, number>;
}

const annualReturns = (result: AnyResult): Record<string, number> => {
  const byYear = new Map<string, { first: number; last: number }>();
  for (const point of result.points) {
    const year = point.date.slice(0, 4);
    const existing = byYear.get(year);
    if (existing) existing.last = point.value;
    else byYear.set(year, { first: point.value, last: point.value });
  }
  return Object.fromEntries(
    [...byYear.entries()].map(([year, values]) => [
      year,
      (values.last / values.first - 1) * 100,
    ]),
  );
};

export function createAnalysisBundle(
  result: AnyResult,
  data: { source: string; generatedAt: string },
): AnalysisBundle {
  const pair = 'strategy' in result;
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    dataSource: data.source,
    dataGeneratedAt: data.generatedAt,
    resultFingerprint: result.fingerprint,
    resultType: pair ? 'pair' : 'portfolio',
    configuration: pair ? result.strategy : result.config,
    metrics: result.metrics,
    drawdowns: pair ? result.drawdowns : [],
    trades: pair ? result.trades : result.transfers,
    annualReturns: annualReturns(result),
  };
}

export function createChatGptPrompt(result: AnyResult): string {
  const metrics = JSON.stringify(result.metrics, null, 2);
  return [
    '你是嚴謹的量化研究助理。請分析我附上的槓桿 ETF 回測資料。',
    '',
    '回答時必須分成：',
    '1. 已觀察事實：只引用檔案中可驗證的數值。',
    '2. 推論：說明假設、可能原因與不確定性。',
    '3. 主要風險：回撤、波動、成本、參數敏感與資料限制。',
    '4. 樣本外驗證建議：列出下一步實驗及判定標準。',
    '',
    '不得把樣本內最佳結果視為未來保證，也不得省略最差區間。',
    `結果指紋：${result.fingerprint}`,
    '主要指標：',
    metrics,
  ].join('\n');
}

export function resultToCsv(result: AnyResult): string {
  const header = 'date,value,drawdown';
  const rows = result.points.map(
    (point) =>
      `${point.date},${point.value.toFixed(4)},${point.drawdown.toFixed(4)}`,
  );
  return [header, ...rows].join('\n');
}
