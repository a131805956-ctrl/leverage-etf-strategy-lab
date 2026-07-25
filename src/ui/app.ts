import { createAnalysisBundle, createChatGptPrompt, resultToCsv } from '../analysis/export';
import { runBacktest } from '../core/backtest';
import { runPortfolioBacktest } from '../core/portfolio';
import type {
  BacktestResult,
  IsoDate,
  MarketDataBundle,
  PairDefinition,
  PortfolioResult,
  SavedScenario,
  StrategyConfig,
} from '../core/types';
import { PAIRS, pairById } from '../config/pairs';
import { loadMarketData } from '../data/client';
import { needsRefresh, requiredTradingCutoff } from '../data/freshness';
import { gridSearch } from '../optimization/gridSearch';
import { paretoFront } from '../optimization/pareto';
import { IndexedDbScenarioRepository } from '../storage/indexedDbRepository';
import {
  MemoryScenarioRepository,
  createPortableFile,
  isPortableScenarioFile,
  type ScenarioRepository,
} from '../storage/repository';
import { createWorkbenchChart, type WorkbenchChart } from './chart';

const money = new Intl.NumberFormat('zh-TW', {
  style: 'currency',
  currency: 'TWD',
  maximumFractionDigits: 0,
});

const percent = (value: number, digits = 1): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[
        character
      ] ?? character,
  );

const download = (name: string, content: string, type: string): void => {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob([content], { type }));
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
};

export class StrategyLabApp {
  private bundle?: MarketDataBundle;
  private pairId = 'tw50';
  private current?: BacktestResult;
  private portfolio?: PortfolioResult;
  private chart?: WorkbenchChart;
  private saved: SavedScenario[] = [];
  private repository: ScenarioRepository;

  constructor(private readonly root: HTMLElement) {
    this.repository =
      typeof indexedDB === 'undefined'
        ? new MemoryScenarioRepository()
        : new IndexedDbScenarioRepository();
  }

  async start(): Promise<void> {
    this.renderShell();
    this.bindShell();
    try {
      this.bundle = await loadMarketData();
      this.saved = await this.repository.list();
      this.setPair(this.pairId);
      this.renderDataHealth();
      this.renderLibrary();
      this.renderPortfolioOptions();
      this.toast('市場資料與策略引擎已就緒');
    } catch (error) {
      this.toast(error instanceof Error ? error.message : '初始化失敗', true);
    }
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <div class="shell">
        <header class="topbar">
          <div class="brand">
            <div class="brand-mark">EL</div>
            <div><div class="brand-name">Exposure Lab</div><div class="brand-sub">槓桿 ETF 策略實驗室</div></div>
          </div>
          <div class="pair-tabs">
            ${PAIRS.map((pair) => `<button class="pair-tab ${pair.id === this.pairId ? 'active' : ''}" data-pair="${pair.id}"><span class="long">${pair.prototype.symbol.replace('.TW', '')} × </span>${pair.leveraged.symbol.replace('.TW', '')}</button>`).join('')}
          </div>
          <div class="top-spacer"></div>
          <div class="data-chip"><i class="status-dot"></i><span id="data-status">載入資料中</span><span>月度快取</span></div>
          <button class="icon-button" id="theme-toggle" title="切換深色模式">◐</button>
          <button class="button mobile-config" id="open-config">策略設定</button>
        </header>
        <div class="workspace">
          <nav class="rail" aria-label="主要功能">
            <button class="active" data-view="backtest"><span>⌁</span>回測</button>
            <button data-view="portfolio"><span>◇</span>組合</button>
            <button data-view="optimizer"><span>⌘</span>最佳化</button>
            <button data-view="library"><span>▤</span>方案庫</button>
          </nav>
          <main class="main">
            <section class="view active" id="view-backtest">
              <div class="page-head">
                <div><div class="eyebrow">Pair strategy / 單組策略</div><h1 id="page-title">臺灣 50 曝險組</h1><p class="subtitle">訊號於收盤確認，下一交易日開盤成交 · 權重全數投入</p></div>
                <div class="action-row">
                  <button class="button" id="save-scenario">儲存方案</button>
                  <button class="button" id="export-json">分析包</button>
                  <button class="button" id="copy-ai">複製 AI 提示詞</button>
                </div>
              </div>
              <div class="metric-grid" id="metric-grid">
                ${['期末資產','年化報酬','最大回撤','Sharpe','平均曝險','交易次數'].map((label, index) => `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value" id="metric-${index}">—</div><div class="metric-foot">${index === 4 ? '原型 1×／槓桿 2×' : '完成回測後更新'}</div></div>`).join('')}
              </div>
              <section class="panel chart-panel">
                <div class="panel-head">
                  <div class="panel-title">淨值曲線</div>
                  <div class="legend"><span><i style="background:var(--teal)"></i>策略</span><span><i style="background:var(--blue)"></i>原型 ETF</span><span><i style="background:var(--orange)"></i>槓桿 ETF</span></div>
                  <div class="chart-tools">
                    <button data-range="1">1Y</button><button data-range="3">3Y</button><button data-range="all">ALL</button>
                    <button id="chart-log">LOG</button><button id="chart-fit">重設</button>
                  </div>
                </div>
                <div class="chart-host" id="chart-host"><div class="chart-tooltip" id="chart-tooltip"></div></div>
                <div class="exposure-strip">
                  <div class="exposure-head"><span>EXPOSURE RAIL · 名目曝險軌道</span><span>100% 原型 ← → 200% 全槓桿</span></div>
                  <div class="exposure-track" id="exposure-track"></div>
                </div>
              </section>
              <div class="lower-grid">
                <section class="panel"><div class="panel-head"><div class="panel-title">操作與再平衡紀錄</div><div class="subtitle" id="trade-count"></div></div><div class="table-wrap" id="trade-table"><div class="empty">尚未執行回測</div></div></section>
                <section class="panel"><div class="panel-head"><div class="panel-title">資料健康</div></div><div class="table-wrap" id="data-health"><div class="empty">檢查資料中</div></div></section>
              </div>
            </section>

            <section class="view" id="view-portfolio">
              <div class="page-head"><div><div class="eyebrow">Portfolio of strategies</div><h1>多組策略組合</h1><p class="subtitle">每組選用不同策略，再控制跨組資金與再平衡</p></div></div>
              <div class="portfolio-builder">
                <section class="panel card-body">
                  <h2>組合設定</h2>
                  <div class="field"><label>台股策略</label><select id="portfolio-tw"></select></div>
                  <div class="field"><label>台股目標權重</label><input id="portfolio-tw-weight" type="number" value="40" min="0" max="100"></div>
                  <div class="field"><label>美股策略</label><select id="portfolio-us"></select></div>
                  <div class="field"><label>美股目標權重</label><input id="portfolio-us-weight" type="number" value="60" min="0" max="100"></div>
                  <div class="field"><label>跨組再平衡</label><select id="portfolio-rebalance"><option value="annual">每年</option><option value="quarterly">每季</option><option value="monthly">每月</option><option value="drift">偏離門檻</option><option value="none">不再平衡</option></select></div>
                  <div class="field"><label>偏離門檻（百分點）</label><input id="portfolio-drift" type="number" value="10" min="1" max="50"></div>
                  <button class="button primary" id="run-portfolio">建立組合回測</button>
                </section>
                <section class="panel card-body" id="portfolio-result"><div class="empty">先在兩個交易對各儲存至少一個方案，再建立跨組組合。</div></section>
              </div>
            </section>

            <section class="view" id="view-optimizer">
              <div class="page-head"><div><div class="eyebrow">Local optimizer / 不需 API</div><h1>多目標策略搜尋</h1><p class="subtitle">同時看報酬、回撤、Sharpe 與 Calmar，不把單一最高值當答案</p></div><button class="button dark" id="run-optimizer">執行快速窮舉</button></div>
              <section class="panel"><div class="panel-head"><div class="panel-title">Pareto 候選策略</div><div class="subtitle" id="optimizer-status">等待執行</div></div><div class="table-wrap" id="optimizer-results"><div class="empty">搜尋會使用目前交易對與日期範圍，共 108 組參數。</div></div></section>
            </section>

            <section class="view" id="view-library">
              <div class="page-head"><div><div class="eyebrow">Reproducible research</div><h1>方案庫與版本</h1><p class="subtitle">每個結果保存策略、資料期間與結果指紋，可匯出後跨裝置移轉</p></div><div class="action-row"><button class="button" id="export-library">匯出全部</button><button class="button" id="import-library">匯入 JSON</button><input id="import-file" type="file" accept=".json" hidden></div></div>
              <section class="panel" id="library-list"><div class="empty">尚未儲存方案</div></section>
            </section>
          </main>

          <aside class="drawer" id="strategy-drawer">
            <div class="drawer-head"><div><div class="eyebrow">Strategy rules</div><h2>策略守則</h2></div><button class="icon-button" id="close-config">×</button></div>
            <div class="form-section">
              <div class="two-col">
                <div class="field"><label>開始日</label><input id="start-date" type="date"></div>
                <div class="field"><label>結束日</label><input id="end-date" type="date"></div>
              </div>
              <div class="field"><label>單次投入金額（TWD）</label><input id="capital" type="number" value="1000000" min="1000" step="10000"></div>
              <div class="two-col">
                <div class="field"><label>基礎槓桿比</label><input id="base-weight" type="number" value="60" min="0" max="100"></div>
                <div class="field"><label>創新高槓桿比</label><input id="high-weight" type="number" value="70" min="0" max="100"></div>
              </div>
            </div>
            <div class="form-section">
              <h3>下跌加碼階梯</h3>
              ${[[10,80],[20,90],[30,100]].map(([dd,w], index) => `<div class="rule-row"><input id="dd-${index}" type="number" value="${dd}" aria-label="回撤門檻"><span class="rule-arrow">→</span><input id="ddw-${index}" type="number" value="${w}" aria-label="槓桿權重"></div>`).join('')}
            </div>
            <div class="form-section">
              <h3>反彈減倉階梯</h3>
              ${[[20,90],[10,80],[5,70]].map(([distance,w], index) => `<div class="rule-row"><input id="rc-${index}" type="number" value="${distance}" aria-label="距前高"><span class="rule-arrow">→</span><input id="rcw-${index}" type="number" value="${w}" aria-label="槓桿權重"></div>`).join('')}
              <div class="field"><label>谷底反彈確認（%）</label><input id="recovery-confirm" type="number" value="5" min="0.1" max="50" step="0.5"></div>
            </div>
            <div class="form-section">
              <div class="field"><label>組內再平衡</label><select id="rebalance"><option value="event">僅規則事件</option><option value="monthly">每月</option><option value="quarterly">每季</option><option value="annual">每年</option><option value="drift">偏離門檻</option><option value="none">事件後不持續平衡</option></select></div>
              <div class="field"><label>權重偏離門檻</label><input id="drift-threshold" type="number" value="5" min="1" max="50"></div>
              <div class="field"><label>股息模式</label><select id="dividend-mode"><option value="total-return">總報酬（還原權息）</option><option value="price-only">純價格（不還原）</option><option value="cash">股息暫存現金</option></select></div>
              <div class="two-col" id="dividend-cash-fields" hidden>
                <div class="field"><label>股息投入日</label><input id="dividend-date" type="date"></div>
                <div class="field"><label>投入標的</label><select id="dividend-target"><option value="target-allocation">當時目標比例</option><option value="prototype">原型 ETF</option><option value="leveraged">槓桿 ETF</option></select></div>
              </div>
              <div class="switch-row"><span>啟用交易成本（國泰研究範例）</span><input class="switch" id="cost-enabled" type="checkbox"></div>
              <div id="cost-fields" hidden>
                <div class="two-col"><div class="field"><label>手續費率</label><input id="commission" type="number" value="0.000855" step="0.000001"></div><div class="field"><label>最低手續費</label><input id="minimum-fee" type="number" value="20"></div></div>
                <div class="two-col"><div class="field"><label>賣出稅率</label><input id="sell-tax" type="number" value="0.001" step="0.0001"></div><div class="field"><label>滑價率</label><input id="slippage" type="number" value="0.0005" step="0.0001"></div></div>
              </div>
            </div>
            <div class="notice">估計曝險 = 100% + 槓桿 ETF 權重。訊號只用當日以前資料，並於下一交易日開盤成交。</div>
            <div style="height:12px"></div>
            <button class="button primary" id="run-backtest">套用守則並回測</button>
          </aside>
        </div>
      </div>`;

    const host = this.get<HTMLElement>('chart-host');
    this.chart = createWorkbenchChart(host, this.get<HTMLElement>('chart-tooltip'));
  }

  private bindShell(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-pair]').forEach((button) =>
      button.addEventListener('click', () => this.setPair(button.dataset.pair ?? 'tw50')),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) =>
      button.addEventListener('click', () => this.setView(button.dataset.view ?? 'backtest')),
    );
    this.get('theme-toggle').addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      document.documentElement.dataset.theme = dark ? 'light' : 'dark';
      localStorage.setItem('exposure-lab-theme', dark ? 'light' : 'dark');
      this.renderCurrent();
    });
    const theme = localStorage.getItem('exposure-lab-theme');
    if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
    this.get('open-config').addEventListener('click', () => this.get('strategy-drawer').classList.add('open'));
    this.get('close-config').addEventListener('click', () => this.get('strategy-drawer').classList.remove('open'));
    this.get('run-backtest').addEventListener('click', () => this.runCurrent());
    this.get('save-scenario').addEventListener('click', () => void this.saveCurrent());
    this.get('export-json').addEventListener('click', () => this.exportCurrent());
    this.get('copy-ai').addEventListener('click', () => void this.copyAiPrompt());
    this.get('chart-fit').addEventListener('click', () => this.chart?.fit());
    document.querySelectorAll<HTMLButtonElement>('[data-range]').forEach((button) =>
      button.addEventListener('click', () => {
        const value = button.dataset.range;
        this.chart?.setRange(value === 'all' ? 'all' : value === '1' ? 1 : 3);
        document
          .querySelectorAll('[data-range]')
          .forEach((item) => item.classList.toggle('active', item === button));
      }),
    );
    let logarithmic = false;
    this.get('chart-log').addEventListener('click', () => {
      logarithmic = !logarithmic;
      this.chart?.setLogarithmic(logarithmic);
      this.get('chart-log').classList.toggle('active', logarithmic);
    });
    this.get<HTMLSelectElement>('dividend-mode').addEventListener('change', (event) => {
      this.get('dividend-cash-fields').hidden = (event.target as HTMLSelectElement).value !== 'cash';
    });
    this.get<HTMLInputElement>('cost-enabled').addEventListener('change', (event) => {
      this.get('cost-fields').hidden = !(event.target as HTMLInputElement).checked;
    });
    this.get('run-portfolio').addEventListener('click', () => this.runPortfolio());
    this.get('run-optimizer').addEventListener('click', () => this.runOptimizer());
    this.get('export-library').addEventListener('click', () => {
      download('exposure-lab-scenarios.json', JSON.stringify(createPortableFile(this.saved), null, 2), 'application/json');
    });
    this.get('import-library').addEventListener('click', () => this.get<HTMLInputElement>('import-file').click());
    this.get<HTMLInputElement>('import-file').addEventListener('change', (event) => {
      void this.importLibrary(event);
    });
  }

  private setView(view: string): void {
    document.querySelectorAll('.view').forEach((item) => item.classList.remove('active'));
    document.querySelectorAll('[data-view]').forEach((item) => item.classList.toggle('active', (item as HTMLElement).dataset.view === view));
    this.get(`view-${view}`).classList.add('active');
  }

  private setPair(pairId: string): void {
    if (!this.bundle) return;
    this.pairId = pairId;
    const pair = pairById(pairId);
    document.querySelectorAll('[data-pair]').forEach((item) => item.classList.toggle('active', (item as HTMLElement).dataset.pair === pairId));
    this.get('page-title').textContent = pair.name;
    const prototype = this.bundle.series[pair.prototype.symbol];
    const leveraged = this.bundle.series[pair.leveraged.symbol];
    if (!prototype || !leveraged) throw new Error(`缺少 ${pair.name} 資料`);
    const leveragedDates = new Set(leveraged.bars.map((bar) => bar.date));
    const common = prototype.bars.map((bar) => bar.date).filter((date) => leveragedDates.has(date));
    const first = common[0];
    const last = common.at(-1);
    if (!first || !last) throw new Error('交易對沒有共同日期');
    const defaultStart = common[Math.max(0, common.length - 1500)] ?? first;
    const startInput = this.get<HTMLInputElement>('start-date');
    const endInput = this.get<HTMLInputElement>('end-date');
    startInput.min = first;
    startInput.max = last;
    startInput.value = defaultStart;
    endInput.min = first;
    endInput.max = last;
    endInput.value = last;
    this.get<HTMLInputElement>('dividend-date').value = last;
    this.runCurrent();
  }

  private strategy(pair: PairDefinition): StrategyConfig {
    const number = (id: string): number => Number(this.get<HTMLInputElement>(id).value);
    return {
      id: `strategy-${pair.id}`,
      name: `${pair.name}回撤階梯`,
      pairId: pair.id,
      baseLeveragedWeight: number('base-weight'),
      highLeveragedWeight: number('high-weight'),
      drawdownRules: [0, 1, 2].map((index) => ({ threshold: number(`dd-${index}`), leveragedWeight: number(`ddw-${index}`) })),
      recoveryRules: [0, 1, 2].map((index) => ({ distanceToHigh: number(`rc-${index}`), leveragedWeight: number(`rcw-${index}`) })),
      recoveryConfirmationPct: number('recovery-confirm'),
      rebalance: {
        mode: this.get<HTMLSelectElement>('rebalance').value as StrategyConfig['rebalance']['mode'],
        driftThreshold: number('drift-threshold'),
      },
      dividendMode: this.get<HTMLSelectElement>('dividend-mode').value as StrategyConfig['dividendMode'],
      execution: 'next-open',
      costs: {
        enabled: this.get<HTMLInputElement>('cost-enabled').checked,
        commissionRate: number('commission'),
        sellTaxRate: number('sell-tax'),
        slippageRate: number('slippage'),
        minimumCommission: number('minimum-fee'),
      },
    };
  }

  private runCurrent(): void {
    if (!this.bundle) return;
    try {
      const pair = pairById(this.pairId);
      const strategy = this.strategy(pair);
      const reinvestDate = this.get<HTMLInputElement>('dividend-date').value as IsoDate;
      this.current = runBacktest({
        pair,
        strategy,
        prototype: this.bundle.series[pair.prototype.symbol] as NonNullable<MarketDataBundle['series'][string]>,
        leveraged: this.bundle.series[pair.leveraged.symbol] as NonNullable<MarketDataBundle['series'][string]>,
        startDate: this.get<HTMLInputElement>('start-date').value as IsoDate,
        endDate: this.get<HTMLInputElement>('end-date').value as IsoDate,
        initialCapital: Number(this.get<HTMLInputElement>('capital').value),
        dividendReinvestments:
          strategy.dividendMode === 'cash' && reinvestDate
            ? [{ date: reinvestDate, target: this.get<HTMLSelectElement>('dividend-target').value as 'prototype' | 'leveraged' | 'target-allocation' }]
            : [],
      });
      this.renderCurrent();
      this.get('strategy-drawer').classList.remove('open');
    } catch (error) {
      this.toast(error instanceof Error ? error.message : '回測失敗', true);
    }
  }

  private renderCurrent(): void {
    if (!this.current) return;
    const metrics = this.current.metrics;
    const values = [
      money.format(metrics.finalValue),
      percent(metrics.cagr),
      `-${metrics.maxDrawdown.toFixed(1)}%`,
      metrics.sharpe.toFixed(2),
      `${metrics.averageExposure.toFixed(0)}%`,
      String(metrics.tradeCount),
    ];
    values.forEach((value, index) => {
      const element = this.get(`metric-${index}`);
      element.textContent = value;
      element.classList.toggle('positive', index === 1 && metrics.cagr >= 0);
      element.classList.toggle('negative', index === 2);
    });
    this.chart?.destroy();
    this.chart = createWorkbenchChart(this.get('chart-host'), this.get('chart-tooltip'));
    this.chart.render(this.current);
    if (window.innerWidth <= 720) this.chart.setRange(3);
    this.renderExposure();
    this.renderTrades();
  }

  private renderExposure(): void {
    if (!this.current) return;
    const track = this.get('exposure-track');
    const stride = Math.max(1, Math.ceil(this.current.points.length / 360));
    track.innerHTML = this.current.points
      .filter((_, index) => index % stride === 0)
      .map((point) => {
        const ratio = Math.max(0, Math.min(1, (point.nominalExposure - 100) / 100));
        const hue = 170 - ratio * 145;
        return `<span class="exposure-segment" title="${point.date} · ${point.nominalExposure.toFixed(0)}%" style="background:hsl(${hue} 62% 48%)"></span>`;
      })
      .join('');
  }

  private renderTrades(): void {
    if (!this.current) return;
    this.get('trade-count').textContent = `${this.current.trades.length} 筆 · 成本 ${money.format(this.current.metrics.totalCosts)}`;
    const rows = this.current.trades.slice().reverse().slice(0, 120);
    this.get('trade-table').innerHTML = `<table><thead><tr><th>日期</th><th>原因</th><th>目標槓桿比</th><th>交易額</th><th>說明</th></tr></thead><tbody>${rows
      .map((trade) => `<tr><td>${trade.date}</td><td>${trade.reason}</td><td class="data">${trade.targetLeveragedWeight.toFixed(0)}%</td><td class="data">${money.format(trade.tradedValue)}</td><td>${escapeHtml(trade.note)}</td></tr>`)
      .join('')}</tbody></table>`;
  }

  private renderDataHealth(): void {
    if (!this.bundle) return;
    const cutoff = requiredTradingCutoff();
    const rows = PAIRS.flatMap((pair) => [pair.prototype.symbol, pair.leveraged.symbol]).map((symbol) => {
      const series = this.bundle?.series[symbol];
      const latest = series?.bars.at(-1)?.date;
      const stale = needsRefresh(latest);
      return `<tr><td>${symbol.replace('.TW', '')}</td><td class="data">${series?.bars.length ?? 0}</td><td>${latest ?? '—'}</td><td class="${stale ? 'danger' : ''}">${stale ? '需更新' : '完整'}</td></tr>`;
    });
    this.get('data-health').innerHTML = `<table><thead><tr><th>標的</th><th>筆數</th><th>最後資料</th><th>狀態</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
    this.get('data-status').textContent = `必要截止 ${cutoff}`;
  }

  private async saveCurrent(): Promise<void> {
    if (!this.current) return;
    const now = new Date().toISOString();
    const scenario: SavedScenario = {
      id: crypto.randomUUID(),
      name: `${pairById(this.pairId).name} · ${this.current.strategy.baseLeveragedWeight}/${this.current.strategy.highLeveragedWeight}`,
      kind: 'pair',
      tags: [this.pairId, this.current.strategy.dividendMode],
      createdAt: now,
      updatedAt: now,
      result: this.current,
    };
    await this.repository.save(scenario);
    this.saved = await this.repository.list();
    this.renderLibrary();
    this.renderPortfolioOptions();
    this.toast('方案已儲存到這個瀏覽器');
  }

  private exportCurrent(): void {
    if (!this.current || !this.bundle) return;
    const bundle = createAnalysisBundle(this.current, { source: this.bundle.source, generatedAt: this.bundle.generatedAt });
    download(`${this.current.pairId}-${this.current.fingerprint}.json`, JSON.stringify(bundle, null, 2), 'application/json');
    download(`${this.current.pairId}-${this.current.fingerprint}.csv`, resultToCsv(this.current), 'text/csv;charset=utf-8');
  }

  private async copyAiPrompt(): Promise<void> {
    if (!this.current) return;
    await navigator.clipboard.writeText(createChatGptPrompt(this.current));
    this.toast('ChatGPT 分析提示詞已複製');
  }

  private renderLibrary(): void {
    const host = this.get('library-list');
    if (!this.saved.length) {
      host.innerHTML = '<div class="empty">在回測頁儲存方案後，會在此保留可重現版本。</div>';
      return;
    }
    host.innerHTML = this.saved
      .map((scenario) => {
        const result = scenario.result;
        return `<article class="scenario-card"><div><h3>${escapeHtml(scenario.name)}</h3><div class="scenario-meta">${scenario.kind.toUpperCase()} · ${result.fingerprint} · ${new Date(scenario.updatedAt).toLocaleString('zh-TW')}</div></div><div><button class="button" data-delete="${scenario.id}">刪除</button></div></article>`;
      })
      .join('');
    host.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((button) =>
      button.addEventListener('click', () => {
        void (async () => {
          await this.repository.remove(button.dataset.delete ?? '');
          this.saved = await this.repository.list();
          this.renderLibrary();
          this.renderPortfolioOptions();
        })();
      }),
    );
  }

  private renderPortfolioOptions(): void {
    const pairScenarios = this.saved.filter((scenario): scenario is SavedScenario & { result: BacktestResult } => scenario.kind === 'pair');
    const options = (pairId: string): string => {
      const rows = pairScenarios.filter((scenario) => scenario.result.pairId === pairId);
      return rows.length ? rows.map((scenario) => `<option value="${scenario.id}">${escapeHtml(scenario.name)}</option>`).join('') : '<option value="">尚無已儲存策略</option>';
    };
    this.get<HTMLSelectElement>('portfolio-tw').innerHTML = options('tw50');
    this.get<HTMLSelectElement>('portfolio-us').innerHTML = options('sp500');
  }

  private runPortfolio(): void {
    try {
      const twId = this.get<HTMLSelectElement>('portfolio-tw').value;
      const usId = this.get<HTMLSelectElement>('portfolio-us').value;
      const child = [twId, usId].map((id) => this.saved.find((scenario) => scenario.id === id)?.result).filter((result): result is BacktestResult => Boolean(result && 'strategy' in result));
      if (child.length !== 2) throw new Error('請先在兩個交易對各儲存一個策略');
      const twWeight = Number(this.get<HTMLInputElement>('portfolio-tw-weight').value);
      const usWeight = Number(this.get<HTMLInputElement>('portfolio-us-weight').value);
      this.portfolio = runPortfolioBacktest(
        {
          id: crypto.randomUUID(),
          name: `台股 ${twWeight}%／美股 ${usWeight}%`,
          initialCapital: Number(this.get<HTMLInputElement>('capital').value),
          allocations: [
            { backtestId: child[0]?.id ?? '', label: '台股策略', targetWeight: twWeight },
            { backtestId: child[1]?.id ?? '', label: '美股策略', targetWeight: usWeight },
          ],
          rebalance: {
            mode: this.get<HTMLSelectElement>('portfolio-rebalance').value as 'monthly' | 'quarterly' | 'annual' | 'drift' | 'none',
            driftThreshold: Number(this.get<HTMLInputElement>('portfolio-drift').value),
          },
        },
        child,
      );
      const metrics = this.portfolio.metrics;
      this.get('portfolio-result').innerHTML = `<div class="result-callout"><div class="eyebrow">Combined result</div><h2>${escapeHtml(this.portfolio.config.name)}</h2><p>期末資產 <strong>${money.format(metrics.finalValue)}</strong> · 年化 ${percent(metrics.cagr)} · 最大回撤 -${metrics.maxDrawdown.toFixed(1)}%</p><p class="subtitle">${this.portfolio.transfers.length} 次跨組再平衡 · 指紋 ${this.portfolio.fingerprint}</p></div><div style="height:14px"></div><table><thead><tr><th>日期</th><th>原因</th><th>資金移轉</th></tr></thead><tbody>${this.portfolio.transfers.slice(-20).reverse().map((transfer) => `<tr><td>${transfer.date}</td><td>${transfer.reason}</td><td class="data">${Object.values(transfer.amounts).map((value) => money.format(value)).join(' / ')}</td></tr>`).join('')}</tbody></table>`;
    } catch (error) {
      this.toast(error instanceof Error ? error.message : '組合回測失敗', true);
    }
  }

  private runOptimizer(): void {
    if (!this.bundle) return;
    const button = this.get<HTMLButtonElement>('run-optimizer');
    button.disabled = true;
    this.get('optimizer-status').textContent = '搜尋中…';
    window.setTimeout(() => {
      try {
        const pair = pairById(this.pairId);
        const baseStrategy = this.strategy(pair);
        const grid = gridSearch(
          { base: [40, 50, 60, 70], high: [50, 60, 70], dd10: [70, 80, 90], dd20: [80, 90, 100] },
          (parameters) => {
            const candidate: StrategyConfig = {
              ...baseStrategy,
              baseLeveragedWeight: parameters.base ?? 60,
              highLeveragedWeight: parameters.high ?? 70,
              drawdownRules: [
                { threshold: 10, leveragedWeight: parameters.dd10 ?? 80 },
                { threshold: 20, leveragedWeight: parameters.dd20 ?? 90 },
                { threshold: 30, leveragedWeight: 100 },
              ],
            };
            const result = runBacktest({
              pair,
              strategy: candidate,
              prototype: this.bundle?.series[pair.prototype.symbol] as NonNullable<MarketDataBundle['series'][string]>,
              leveraged: this.bundle?.series[pair.leveraged.symbol] as NonNullable<MarketDataBundle['series'][string]>,
              startDate: this.get<HTMLInputElement>('start-date').value as IsoDate,
              endDate: this.get<HTMLInputElement>('end-date').value as IsoDate,
              initialCapital: 1_000_000,
            });
            return {
              score: result.metrics.cagr + result.metrics.sharpe * 2 - result.metrics.maxDrawdown * 0.2,
              metrics: {
                cagr: result.metrics.cagr,
                maxDrawdown: result.metrics.maxDrawdown,
                sharpe: result.metrics.sharpe,
                calmar: result.metrics.calmar,
              },
            };
          },
        ).filter((candidate) => (candidate.parameters.dd20 ?? 0) >= (candidate.parameters.dd10 ?? 0));
        const flat = grid.map((candidate, index) => ({ index, cagr: candidate.metrics.cagr, maxDrawdown: candidate.metrics.maxDrawdown }));
        const front = new Set(paretoFront(flat, [{ key: 'cagr', direction: 'maximize' }, { key: 'maxDrawdown', direction: 'minimize' }]).map((item) => item.index));
        const top = [...grid].sort((a, b) => b.score - a.score).slice(0, 20);
        this.get('optimizer-results').innerHTML = `<table><thead><tr><th>類型</th><th>基礎／新高</th><th>回撤10／20</th><th>CAGR</th><th>最大回撤</th><th>Sharpe</th><th>Calmar</th></tr></thead><tbody>${top.map((candidate) => {
          const index = grid.indexOf(candidate);
          return `<tr><td>${front.has(index) ? '<strong>Pareto</strong>' : '平衡分數'}</td><td class="data">${candidate.parameters.base}/${candidate.parameters.high}</td><td class="data">${candidate.parameters.dd10}/${candidate.parameters.dd20}</td><td class="data">${percent(candidate.metrics.cagr)}</td><td class="data">-${candidate.metrics.maxDrawdown.toFixed(1)}%</td><td class="data">${candidate.metrics.sharpe.toFixed(2)}</td><td class="data">${candidate.metrics.calmar.toFixed(2)}</td></tr>`;
        }).join('')}</tbody></table>`;
        this.get('optimizer-status').textContent = `${grid.length} 組完成 · ${front.size} 組 Pareto 前緣`;
      } catch (error) {
        this.toast(error instanceof Error ? error.message : '最佳化失敗', true);
      } finally {
        button.disabled = false;
      }
    }, 30);
  }

  private async importLibrary(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const parsed: unknown = JSON.parse(await file.text());
    if (!isPortableScenarioFile(parsed)) throw new Error('匯入檔案格式不正確');
    for (const scenario of parsed.scenarios) await this.repository.save(scenario);
    this.saved = await this.repository.list();
    this.renderLibrary();
    this.renderPortfolioOptions();
    this.toast(`已匯入 ${parsed.scenarios.length} 個方案`);
  }

  private toast(message: string, danger = false): void {
    document.querySelector('.toast')?.remove();
    const toast = document.createElement('div');
    toast.className = `toast ${danger ? 'danger' : ''}`;
    toast.textContent = message;
    document.body.append(toast);
    window.setTimeout(() => toast.remove(), 3500);
  }

  private get<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`找不到介面元素：${id}`);
    return element as T;
  }
}
