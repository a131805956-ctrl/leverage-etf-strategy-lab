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
import {
  createOptimizationCandidate,
  gridSearch,
} from '../optimization/gridSearch';
import { paretoFront } from '../optimization/pareto';
import { IndexedDbScenarioRepository } from '../storage/indexedDbRepository';
import { migrateSavedScenario } from '../storage/migrateScenario';
import {
  MemoryScenarioRepository,
  createPortableFile,
  isPortableScenarioFile,
  type ScenarioRepository,
} from '../storage/repository';
import {
  createWorkbenchChart,
  type ChartEvent,
  type WorkbenchChart,
} from './chart';
import {
  resolveReductionFormState,
  resolveRebalanceSelection,
  resolveStrategyFormState,
} from './strategyForm';

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

type ReductionReference =
  | 'new-high-decline'
  | 'prototype-rebound'
  | 'leveraged-rebound';

const ruleRowMarkup = (
  kind: 'drawdown' | 'reduction',
  index: number,
  threshold: number,
  leveragedWeight: number,
): string => {
  const label = kind === 'drawdown' ? '下跌幅度' : '觸發幅度';
  const prefix = kind === 'drawdown' ? 'dd' : 'reduction';
  return `<div class="rule-row" data-rule="${kind}" data-index="${index}">
    <input id="${prefix}-${index}" name="${prefix}-threshold-${index}" type="number" value="${threshold}" min="0" max="100" step="0.5" aria-label="${label} ${index + 1}" autocomplete="off">
    <span class="rule-arrow" aria-hidden="true">→</span>
    <input id="${prefix}w-${index}" name="${prefix}-weight-${index}" type="number" value="${leveragedWeight}" min="0" max="100" step="1" aria-label="槓桿比例 ${index + 1}" autocomplete="off">
  </div>`;
};

export class StrategyLabApp {
  private bundle?: MarketDataBundle;
  private pairId = 'tw50';
  private current?: BacktestResult;
  private portfolio?: PortfolioResult;
  private chart?: WorkbenchChart;
  private saved: SavedScenario[] = [];
  private optimizerCandidates = new Map<string, BacktestResult>();
  private lastEventTrigger?: HTMLElement;
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
      this.get('data-status').textContent = '資料快取已載入';
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
          <div class="data-chip"><i class="status-dot"></i><span id="data-status" role="status" aria-live="polite">載入資料中</span><span>月度快取</span></div>
          <button class="icon-button" id="theme-toggle" title="切換深色模式" aria-label="切換深色模式"><span aria-hidden="true">◐</span></button>
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
              </section>
              <div class="lower-grid operation-grid">
                <section class="panel"><div class="panel-head"><div class="panel-title">操作與再平衡紀錄 <span class="panel-title-en">Operations &amp; Rebalances</span></div><div class="subtitle" id="trade-count"></div></div><div class="table-wrap" id="trade-table"><div class="empty">尚未執行回測</div></div></section>
              </div>
            </section>

            <section class="view" id="view-portfolio">
              <div class="page-head"><div><div class="eyebrow">Portfolio of strategies</div><h1>多組策略組合</h1><p class="subtitle">每組選用不同策略，再控制跨組資金與再平衡</p></div></div>
              <div class="portfolio-builder">
                <section class="panel card-body">
                  <h2>組合設定</h2>
                  <div class="field"><label for="portfolio-tw">台股策略</label><select id="portfolio-tw" name="portfolio-tw" autocomplete="off"></select></div>
                  <div class="field"><label for="portfolio-tw-weight">台股目標權重</label><input id="portfolio-tw-weight" name="portfolio-tw-weight" type="number" value="40" min="0" max="100" autocomplete="off"></div>
                  <div class="field"><label for="portfolio-us">美股策略</label><select id="portfolio-us" name="portfolio-us" autocomplete="off"></select></div>
                  <div class="field"><label for="portfolio-us-weight">美股目標權重</label><input id="portfolio-us-weight" name="portfolio-us-weight" type="number" value="60" min="0" max="100" autocomplete="off"></div>
                  <div class="field"><label for="portfolio-rebalance">跨組再平衡</label><select id="portfolio-rebalance" name="portfolio-rebalance" autocomplete="off"><option value="annual">每年</option><option value="quarterly">每季</option><option value="monthly">每月</option><option value="drift">偏離門檻</option><option value="none">不再平衡</option></select></div>
                  <div class="field"><label for="portfolio-drift">偏離門檻（百分點）</label><input id="portfolio-drift" name="portfolio-drift" type="number" value="10" min="1" max="50" autocomplete="off"></div>
                  <button class="button primary" id="run-portfolio">建立組合回測</button>
                </section>
                <section class="panel card-body" id="portfolio-result"><div class="empty">先在兩個交易對各儲存至少一個方案，再建立跨組組合。</div></section>
              </div>
            </section>

            <section class="view" id="view-optimizer">
              <div class="page-head"><div><div class="eyebrow">Local optimizer / 不需 API</div><h1>多目標策略搜尋</h1><p class="subtitle">同時看報酬、回撤、Sharpe 與 Calmar，不把單一最高值當答案</p></div><button class="button dark" id="run-optimizer">執行快速窮舉</button></div>
              <section class="panel"><div class="panel-head"><div class="panel-title">Pareto 候選策略</div><div class="subtitle" id="optimizer-status" role="status" aria-live="polite">等待執行</div></div><div class="table-wrap" id="optimizer-results"><div class="empty">搜尋目前交易對的正常槓桿與下跌加碼階梯；不納入初始比例，也不強制再平衡。</div></div></section>
            </section>

            <section class="view" id="view-library">
              <div class="page-head"><div><div class="eyebrow">Reproducible research</div><h1>方案庫與版本</h1><p class="subtitle">每個結果保存策略、資料期間與結果指紋，可匯出後跨裝置移轉</p></div><div class="action-row"><button class="button" id="export-library">匯出全部</button><button class="button" id="import-library">匯入 JSON</button><input id="import-file" type="file" accept=".json" hidden></div></div>
              <section class="panel" id="library-list"><div class="empty">尚未儲存方案</div></section>
            </section>
          </main>

          <aside class="drawer" id="strategy-drawer">
            <div class="drawer-head"><div><div class="eyebrow">Strategy rules</div><h2>策略守則</h2></div><button class="icon-button" id="close-config" aria-label="關閉策略設定"><span aria-hidden="true">×</span></button></div>
            <div class="mode-warning" id="optimizer-preview-note" hidden>目前為窮舉候選預覽（Optimizer preview）。參數已鎖定，僅供檢視。<button class="button" type="button" id="exit-optimizer-preview">返回可編輯策略</button></div>
            <div class="form-section">
              <div class="two-col">
                <div class="field"><label for="start-date">開始日</label><input id="start-date" name="start-date" type="date" autocomplete="off"></div>
                <div class="field"><label for="end-date">結束日</label><input id="end-date" name="end-date" type="date" autocomplete="off"></div>
              </div>
              <div class="field"><label for="capital">單次投入金額（TWD）</label><input id="capital" name="capital" type="number" value="1000000" min="1000" step="10000" autocomplete="off"></div>
              <div class="field"><label for="base-weight">正常槓桿比 <span class="label-en">Normal leverage</span></label><input id="base-weight" name="base-weight" type="number" value="70" min="0" max="100" autocomplete="off"><p class="field-help">創新高持有正常比例；只有回撤／反彈規則改變。</p></div>
              <div class="field"><label for="allocation-policy">權重執行方式</label><select id="allocation-policy" name="allocation-policy" autocomplete="off"><option value="minimum-floor" selected>讓利潤奔騰／最低持倉底線</option><option value="exact-target">精確目標比例</option></select></div>
              <div class="mode-note" id="floor-mode-note">回撤加碼是至少持有的槓桿底線；回撤加碼後，新高或反彈減碼會把多餘槓桿轉回原型，回到正常比例。</div>
            </div>
            <div class="form-section">
              <div class="rule-section-heading"><h3>下跌加碼階梯 <span class="label-en">Downside adds</span></h3><span class="rule-actions"><button class="icon-button" type="button" data-action="remove-rule" data-rule-kind="drawdown" aria-label="移除下跌加碼條件">−</button><button class="icon-button" type="button" data-action="add-rule" data-rule-kind="drawdown" aria-label="新增下跌加碼條件">＋</button></span></div>
              <div id="drawdown-rules">${[[10,80],[20,90],[30,100]].map(([dd,w], index) => ruleRowMarkup('drawdown', index, dd ?? 10, w ?? 80)).join('')}</div>
            </div>
            <div class="form-section">
              <div id="reduction-ladder-controls"><div class="rule-section-heading"><h3>減碼階梯 <span class="label-en">Reduction ladder</span></h3><span class="rule-actions"><button class="icon-button" type="button" data-action="remove-rule" data-rule-kind="reduction" aria-label="移除減碼條件">−</button><button class="icon-button" type="button" data-action="add-rule" data-rule-kind="reduction" aria-label="新增減碼條件">＋</button></span></div>
              <div id="reduction-rules">${[[10,60],[20,50]].map(([distance,w], index) => ruleRowMarkup('reduction', index, distance ?? 10, w ?? 60)).join('')}</div></div>
              <div class="field"><label for="reduction-reference">減碼參考 <span class="label-en">Reference</span></label><select id="reduction-reference" name="reduction-reference" autocomplete="off"><option value="new-high-decline" selected>創高後回歸正常（新高即減碼）</option><option value="prototype-rebound">原型 ETF 反彈</option><option value="leveraged-rebound">槓桿 ETF 反彈</option></select><p class="field-help" id="reduction-reference-help">創新高後把多餘槓桿部位轉回原型，回到正常槓桿比例。</p></div>
              <div class="field" id="recovery-confirm-field" hidden><label for="recovery-confirm">谷底反彈確認（%）</label><input id="recovery-confirm" name="recovery-confirm" type="number" value="5" min="0.1" max="50" step="0.5" autocomplete="off"><p class="field-help">只有選原型／槓桿反彈時才啟用。</p></div>
            </div>
            <div class="form-section">
              <div class="field"><label for="rebalance">強制再平衡</label><select id="rebalance" name="rebalance" autocomplete="off"><option value="none" selected>永不</option><option value="interval-30">每 30 日曆天</option><option value="interval-180">每 180 日曆天</option><option value="interval-365">每 365 日曆天</option><option value="interval-custom">自訂日曆天</option><optgroup label="進階選項"><option value="monthly">每月</option><option value="quarterly">每季</option><option value="annual">每年</option><option value="drift">偏離門檻</option></optgroup></select></div>
              <div class="field" id="custom-rebalance-days-field" hidden><label for="custom-rebalance-days">自訂日曆天數</label><input id="custom-rebalance-days" name="custom-rebalance-days" type="number" value="90" min="1" step="1" autocomplete="off"></div>
              <div class="field" id="drift-threshold-field" hidden><label for="drift-threshold">權重偏離門檻（百分點）</label><input id="drift-threshold" name="drift-threshold" type="number" value="5" min="1" max="50" autocomplete="off"></div>
              <div class="mode-warning" id="strategy-mode-warning" hidden>精確目標或偏離門檻會賣出高於目標的槓桿 ETF，可能增加週轉率與交易成本。</div>
              <div class="field"><label for="dividend-mode">股息模式</label><select id="dividend-mode" name="dividend-mode" autocomplete="off"><option value="total-return">總報酬（還原權息）</option><option value="price-only">純價格（不還原）</option><option value="cash">股息暫存現金</option></select></div>
              <div class="two-col" id="dividend-cash-fields" hidden>
                <div class="field"><label for="dividend-date">股息投入日</label><input id="dividend-date" name="dividend-date" type="date" autocomplete="off"></div>
                <div class="field"><label for="dividend-target">投入標的</label><select id="dividend-target" name="dividend-target" autocomplete="off"><option value="target-allocation">當時目標比例</option><option value="prototype">原型 ETF</option><option value="leveraged">槓桿 ETF</option></select></div>
              </div>
              <label class="switch-row" for="cost-enabled"><span>啟用交易成本（國泰研究範例）</span><input class="switch" id="cost-enabled" name="cost-enabled" type="checkbox" autocomplete="off"></label>
              <div id="cost-fields" hidden>
                <div class="two-col"><div class="field"><label for="commission">手續費率</label><input id="commission" name="commission" type="number" value="0.000855" step="0.000001" autocomplete="off"></div><div class="field"><label for="minimum-fee">最低手續費</label><input id="minimum-fee" name="minimum-fee" type="number" value="20" autocomplete="off"></div></div>
                <div class="two-col"><div class="field"><label for="sell-tax">賣出稅率</label><input id="sell-tax" name="sell-tax" type="number" value="0.001" step="0.0001" autocomplete="off"></div><div class="field"><label for="slippage">滑價率</label><input id="slippage" name="slippage" type="number" value="0.0005" step="0.0001" autocomplete="off"></div></div>
              </div>
            </div>
            <div class="notice">估計曝險 = 100% + 槓桿 ETF 權重。訊號只用當日以前資料，並於下一交易日開盤成交。</div>
            <div style="height:12px"></div>
            <button class="button primary" id="run-backtest">套用守則並回測</button>
           </aside>
           <div class="event-detail-modal" id="event-detail-modal" hidden role="dialog" aria-modal="true" aria-labelledby="event-detail-title">
             <div class="event-modal-card">
               <div class="event-modal-head"><div><div class="eyebrow">Exposure episode / 加倉事件</div><h2 id="event-detail-title">事件詳細資料</h2></div><button class="icon-button" id="close-event-modal" type="button" aria-label="關閉事件詳細資料">×</button></div>
               <div class="event-modal-body" id="event-detail-content"></div>
             </div>
           </div>
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
    this.get('close-event-modal').addEventListener('click', () => this.closeEventModal());
    this.get('event-detail-modal').addEventListener('click', (event) => {
      if (event.target === event.currentTarget) this.closeEventModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeEventModal();
    });
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
    const allocationPolicy = this.get<HTMLSelectElement>('allocation-policy');
    const rebalance = this.get<HTMLSelectElement>('rebalance');
    const updateStrategyForm = (): void => {
      const state = resolveStrategyFormState(
        allocationPolicy.value as StrategyConfig['allocationPolicy'],
        rebalance.value,
      );
      this.get('custom-rebalance-days-field').hidden = !state.showCustomDays;
      this.get('drift-threshold-field').hidden = !state.showDriftThreshold;
      this.get('floor-mode-note').hidden = !state.showFloorNote;
      this.get('strategy-mode-warning').hidden = !state.showWarning;
    };
    allocationPolicy.addEventListener('change', updateStrategyForm);
    rebalance.addEventListener('change', updateStrategyForm);
    updateStrategyForm();
    const updateReductionForm = (): void => {
      const reference = this.get<HTMLSelectElement>('reduction-reference').value as ReductionReference;
      const state = resolveReductionFormState(reference);
      this.get<HTMLInputElement>('recovery-confirm').closest('.field')?.toggleAttribute('hidden', !state.showConfirmation);
      this.get('reduction-ladder-controls').toggleAttribute('hidden', reference === 'new-high-decline');
      this.get('reduction-reference-help').textContent = state.helperText;
    };
    this.get<HTMLSelectElement>('reduction-reference').addEventListener('change', updateReductionForm);
    updateReductionForm();
    const renderRuleRows = (kind: 'drawdown' | 'reduction', rows: Array<{ threshold: number; leveragedWeight: number }>): void => {
      this.get(`${kind}-rules`).innerHTML = rows.map((row, index) => ruleRowMarkup(kind, index, row.threshold, row.leveragedWeight)).join('');
    };
    document.querySelectorAll<HTMLButtonElement>('[data-action="add-rule"], [data-action="remove-rule"]').forEach((button) => {
      button.addEventListener('click', () => {
        const kind = button.dataset.ruleKind as 'drawdown' | 'reduction';
        const rows = [...document.querySelectorAll<HTMLElement>(`[data-rule="${kind}"]`)]
          .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
          .map((row) => ({
            threshold: Number((row.querySelector('input:first-child') as HTMLInputElement).value),
            leveragedWeight: Number((row.querySelector('input:last-child') as HTMLInputElement).value),
          }));
        if (button.dataset.action === 'add-rule' && rows.length < 8) {
          const last = rows.at(-1) ?? { threshold: 10, leveragedWeight: kind === 'drawdown' ? 80 : 60 };
          rows.push({ threshold: Math.min(100, last.threshold + 10), leveragedWeight: Math.min(100, last.leveragedWeight + (kind === 'drawdown' ? 10 : -10)) });
        }
        if (button.dataset.action === 'remove-rule' && rows.length > 1) rows.pop();
        renderRuleRows(kind, rows);
      });
    });
    this.get('exit-optimizer-preview').addEventListener('click', () => {
      this.setStrategyControlsDisabled(false);
      this.get('optimizer-preview-note').setAttribute('hidden', '');
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

  private setStrategyControlsDisabled(disabled: boolean): void {
    this.get('strategy-drawer').querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button').forEach((control) => {
      if (control.id === 'close-config' || control.id === 'exit-optimizer-preview') return;
      control.disabled = disabled;
    });
    this.get('optimizer-preview-note').toggleAttribute('hidden', !disabled);
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
    // The default run should cover the complete common history. Users can still
    // narrow the range manually in the strategy drawer.
    const defaultStart = first;
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
    const readRows = (kind: 'drawdown' | 'reduction'): Array<{ threshold: number; leveragedWeight: number }> =>
      [...document.querySelectorAll<HTMLElement>(`[data-rule="${kind}"]`)]
        .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
        .map((row) => ({
          threshold: Number((row.querySelector('input:first-child') as HTMLInputElement).value),
          leveragedWeight: Number((row.querySelector('input:last-child') as HTMLInputElement).value),
        }));
    const drawdownRules = readRows('drawdown');
    const reductionRules = readRows('reduction');
    const reductionReference = this.get<HTMLSelectElement>('reduction-reference').value as ReductionReference;
    return {
      id: `strategy-${pair.id}`,
      name: `${pair.name}回撤階梯`,
      pairId: pair.id,
      allocationPolicy: this.get<HTMLSelectElement>('allocation-policy')
        .value as StrategyConfig['allocationPolicy'],
      normalLeveragedWeight: number('base-weight'),
      baseLeveragedWeight: number('base-weight'),
      // A new high keeps the same normal leverage; only drawdown/rebound
      // rules are allowed to change exposure.
      highLeveragedWeight: number('base-weight'),
      drawdownRules,
      reductionReference,
      reductionRules,
      // Keep the legacy recovery fields in saved scenarios and old engines.
      recoveryRules: reductionRules.map((rule) => ({ distanceToHigh: rule.threshold, leveragedWeight: rule.leveragedWeight })),
      recoveryConfirmationPct: number('recovery-confirm'),
      rebalance: resolveRebalanceSelection(
        this.get<HTMLSelectElement>('rebalance').value,
        number('custom-rebalance-days'),
        number('drift-threshold'),
      ),
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
      this.setStrategyControlsDisabled(false);
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
    this.chart.render(this.current, {
      onEventClick: (event) => this.openEventModal(event),
    });
    if (window.innerWidth <= 720) this.chart.setRange(3);
    this.renderTrades();
  }

  private renderTrades(): void {
    if (!this.current) return;
    this.get('trade-count').textContent = `${this.current.trades.length} 筆 · 成本 ${money.format(this.current.metrics.totalCosts)}`;
    // Keep every operation available for audit/export; the scroll container
    // handles long histories without dropping early trades.
    const rows = this.current.trades.slice().reverse();
    const value = (trade: typeof rows[number], key: string): number | undefined => {
      const candidate = (trade as unknown as Record<string, unknown>)[key];
      return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
    };
    const shareSummary = (trade: typeof rows[number], boughtKey: string, soldKey: string): string => {
      const bought = value(trade, boughtKey);
      const sold = value(trade, soldKey);
      if (bought === undefined && sold === undefined) return '—';
      return `買 ${bought?.toFixed(3) ?? '0.000'} ／ 賣 ${sold?.toFixed(3) ?? '0.000'}`;
    };
    const price = (trade: typeof rows[number], key: string): string => {
      const amount = value(trade, key);
      return amount === undefined ? '—' : money.format(amount);
    };
    this.get('trade-table').innerHTML = `<table><thead><tr><th>日期<br><span class="th-en">Date</span></th><th>原因<br><span class="th-en">Reason</span></th><th>標的</th><th>買／賣股數<br><span class="th-en">Shares ±</span></th><th>成交價<br><span class="th-en">Price</span></th><th>成交額<br><span class="th-en">Notional</span></th><th>手續費<br><span class="th-en">Cost</span></th><th>交易後現值<br><span class="th-en">Value after</span></th><th>目標槓桿</th><th>說明</th></tr></thead><tbody>${rows
      .map((trade) => `<tr><td>${trade.date}</td><td><span class="tag tag-${trade.reason.toLowerCase()}">${trade.reason}</span></td><td><div>原型</div><div>槓桿</div></td><td class="data"><div>${shareSummary(trade, 'prototypeSharesBought', 'prototypeSharesSold')}</div><div>${shareSummary(trade, 'leveragedSharesBought', 'leveragedSharesSold')}</div></td><td class="data"><div>${price(trade, 'prototypePrice')}</div><div>${price(trade, 'leveragedPrice')}</div></td><td class="data">${money.format(trade.tradedValue)}</td><td class="data">${money.format(trade.cost)}</td><td class="data"><div>${price(trade, 'prototypeValueAfter')}</div><div>${price(trade, 'leveragedValueAfter')}</div><strong>${price(trade, 'totalValueAfter')}</strong></td><td class="data">${trade.targetLeveragedWeight.toFixed(0)}%</td><td>${escapeHtml(trade.note)}</td></tr>`)
      .join('')}</tbody></table>`;
  }

  private openEventModal(event: ChartEvent): void {
    this.lastEventTrigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    const modal = this.get('event-detail-modal');
    const title = this.get('event-detail-title');
    const content = this.get('event-detail-content');
    title.textContent = `${event.startDate} → ${event.endDate}`;
    const tradeRows = [...(event.addTrades ?? []), ...(event.reductionTrades ?? [])]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((trade) => `<tr><td>${trade.date}</td><td>${trade.reason}</td><td>${trade.targetLeveragedWeight.toFixed(0)}%</td><td class="data">${money.format(trade.tradedValue)}</td><td class="data">${money.format(trade.totalValueAfter ?? 0)}</td><td>${escapeHtml(trade.note)}</td></tr>`)
      .join('');
    const stageRows = (event.stages ?? [])
      .map((stage) => `<tr><td>${stage.date}</td><td>${stage.trigger ?? stage.reason ?? 'MARK'}</td><td class="data">${money.format(stage.capital ?? stage.value ?? 0)}</td><td class="data">${(stage.prototypeWeight ?? 0).toFixed(1)}% / ${(stage.leveragedWeight ?? 0).toFixed(1)}%</td><td class="data">${(stage.nominalExposure ?? 0).toFixed(1)}%</td></tr>`)
      .join('');
    content.innerHTML = `<div class="event-summary"><div><span>起點 Peak</span><strong>${event.peakDate ?? event.startDate}</strong></div><div><span>區間 Duration</span><strong>${event.startDate} – ${event.endDate}</strong></div><div><span>加倉階段 Adds</span><strong>${event.addTrades?.length ?? 0}</strong></div><div><span>減碼階段 Reductions</span><strong>${event.reductionTrades?.length ?? 0}</strong></div></div><h3>完整操作紀錄 / Trade log</h3><div class="table-wrap event-table"><table><thead><tr><th>日期</th><th>原因</th><th>目標槓桿</th><th>成交額</th><th>交易後現值</th><th>說明</th></tr></thead><tbody>${tradeRows || '<tr><td colspan="6">無操作紀錄</td></tr>'}</tbody></table></div><h3>各階段資金與曝險 / Stages</h3><div class="table-wrap event-table"><table><thead><tr><th>日期</th><th>觸發</th><th>資金</th><th>權重</th><th>名目曝險</th></tr></thead><tbody>${stageRows || '<tr><td colspan="5">無階段資料</td></tr>'}</tbody></table></div>`;
    modal.removeAttribute('hidden');
    this.get('close-event-modal').focus();
  }

  private closeEventModal(): void {
    this.get('event-detail-modal').setAttribute('hidden', '');
    this.lastEventTrigger?.focus();
    this.lastEventTrigger = undefined;
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
      const portfolioMetrics: Array<[string, string, string]> = [
        ['總報酬 Total return', percent(metrics.totalReturn), '期末資產相對初始投入的累積報酬'],
        ['期末資產 Final value', money.format(metrics.finalValue), '回測最後一日組合市值'],
        ['年化報酬 CAGR', percent(metrics.cagr), '以日曆天年化的複合報酬率'],
        ['最大回撤 Max drawdown', `-${metrics.maxDrawdown.toFixed(1)}%`, '從歷史高點到谷底的最大跌幅'],
        ['年化波動 Volatility', `${metrics.annualizedVolatility.toFixed(1)}%`, '日報酬標準差年化'],
        ['下行波動 Downside vol.', `${metrics.downsideVolatility.toFixed(1)}%`, '只計算負報酬的波動'],
        ['Sharpe ratio', metrics.sharpe.toFixed(2), '每單位總波動換得的超額報酬'],
        ['Sortino ratio', metrics.sortino.toFixed(2), '每單位下行風險換得的超額報酬'],
        ['Calmar ratio', metrics.calmar.toFixed(2), '年化報酬除以最大回撤'],
        ['Ulcer index', metrics.ulcerIndex.toFixed(2), '衡量回撤深度與持續時間'],
        ['VaR 95%', `${metrics.valueAtRisk95.toFixed(2)}%`, '單日 95% 信賴區間的損失門檻'],
        ['CVaR 95%', `${metrics.conditionalValueAtRisk95.toFixed(2)}%`, '最差 5% 日子的平均損失'],
        ['平均名目曝險 Avg. exposure', `${metrics.averageExposure.toFixed(1)}%`, '期間每日名目曝險平均'],
        ['換手率 Turnover', `${metrics.turnover.toFixed(1)}%`, '交易金額相對初始資金'],
        ['交易／再平衡 Trades', String(metrics.tradeCount), '跨組資金轉移與子策略交易總數'],
        ['總成本 Total costs', money.format(metrics.totalCosts), '手續費、稅與滑價合計'],
      ];
      this.get('portfolio-result').innerHTML = `<div class="result-callout"><div class="eyebrow">Combined result / 組合結果</div><h2>${escapeHtml(this.portfolio.config.name)}</h2><div class="portfolio-hero"><div><span>總報酬 Total return</span><strong>${percent(metrics.totalReturn)}</strong></div><div><span>期末資產 Final value</span><strong>${money.format(metrics.finalValue)}</strong></div></div><p class="subtitle">${this.portfolio.transfers.length} 次跨組再平衡 · ${this.portfolio.config.rebalance.mode} · 指紋 ${this.portfolio.fingerprint}</p></div><div class="portfolio-metric-grid">${portfolioMetrics.map(([label, value, help]) => `<div class="portfolio-metric" title="${help}"><span>${label}</span><strong>${value}</strong><small>${help}</small></div>`).join('')}</div><div class="table-wrap portfolio-transfer-table"><table><thead><tr><th>日期 Date</th><th>原因 Reason</th><th>資金移轉 Amounts</th></tr></thead><tbody>${this.portfolio.transfers.slice(-30).reverse().map((transfer) => `<tr><td>${transfer.date}</td><td>${transfer.reason}</td><td class="data">${Object.values(transfer.amounts).map((value) => money.format(value)).join(' / ')}</td></tr>`).join('')}</tbody></table></div>`;
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
        const allocationPolicyLabel =
          baseStrategy.allocationPolicy === 'minimum-floor'
            ? '最低持倉底線'
            : '精確目標比例';
        const rebalanceLabel = '不再平衡／No rebalance';
        this.optimizerCandidates.clear();
        const optimizerBaseStrategy = {
          ...baseStrategy,
          rebalance: { mode: 'none' as const, driftThreshold: baseStrategy.rebalance.driftThreshold },
        };
        const grid = gridSearch(
          { normal: [50, 60, 70, 80], dd10: [70, 80, 90], dd20: [80, 90, 100] },
          (parameters) => {
            const candidate = createOptimizationCandidate(
              optimizerBaseStrategy,
              parameters,
            );
            const result = runBacktest({
              pair,
              strategy: candidate,
              prototype: this.bundle?.series[pair.prototype.symbol] as NonNullable<MarketDataBundle['series'][string]>,
              leveraged: this.bundle?.series[pair.leveraged.symbol] as NonNullable<MarketDataBundle['series'][string]>,
              startDate: this.get<HTMLInputElement>('start-date').value as IsoDate,
              endDate: this.get<HTMLInputElement>('end-date').value as IsoDate,
              initialCapital: 1_000_000,
            });
            this.optimizerCandidates.set(JSON.stringify(parameters), result);
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
        this.get('optimizer-results').innerHTML = `<table><thead><tr><th>檢視</th><th>類型</th><th>正常槓桿／Normal</th><th>回撤10／20</th><th>權重執行</th><th>再平衡</th><th>CAGR</th><th>最大回撤</th><th>Sharpe</th><th>Calmar</th></tr></thead><tbody>${top.map((candidate) => {
          const index = grid.indexOf(candidate);
          const key = escapeHtml(JSON.stringify(candidate.parameters));
          return `<tr class="optimizer-row"><td><button type="button" class="button optimizer-open" data-optimizer-key="${key}">開啟視覺化</button></td><td>${front.has(index) ? '<strong>Pareto</strong>' : '平衡分數'}</td><td class="data">${candidate.parameters.normal}%</td><td class="data">${candidate.parameters.dd10}%／${candidate.parameters.dd20}%</td><td>${allocationPolicyLabel}</td><td>${rebalanceLabel}</td><td class="data">${percent(candidate.metrics.cagr)}</td><td class="data">-${candidate.metrics.maxDrawdown.toFixed(1)}%</td><td class="data">${candidate.metrics.sharpe.toFixed(2)}</td><td class="data">${candidate.metrics.calmar.toFixed(2)}</td></tr>`;
        }).join('')}</tbody></table>`;
        this.get('optimizer-results').querySelectorAll<HTMLButtonElement>('[data-optimizer-key]').forEach((open) => {
          open.addEventListener('click', () => {
            const key = open.dataset.optimizerKey;
            const result = key ? this.optimizerCandidates.get(key) : undefined;
            if (!result) return;
            this.current = result;
            this.setStrategyControlsDisabled(true);
            this.setView('backtest');
            this.get('strategy-drawer').classList.add('open');
            this.renderCurrent();
          });
        });
        this.get('optimizer-status').textContent = `${grid.length} 組完成 · ${front.size} 組 Pareto 前緣 · ${allocationPolicyLabel} · ${rebalanceLabel}`;
      } catch (error) {
        this.toast(error instanceof Error ? error.message : '最佳化失敗', true);
      } finally {
        button.disabled = false;
      }
    }, 30);
  }

  private async importLibrary(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isPortableScenarioFile(parsed)) {
        throw new Error('匯入檔案格式不正確');
      }
      let migratedCount = 0;
      for (const scenario of parsed.scenarios) {
        const migrated = migrateSavedScenario(scenario);
        if (migrated !== scenario) migratedCount += 1;
        await this.repository.save(migrated);
      }
      this.saved = await this.repository.list();
      this.renderLibrary();
      this.renderPortfolioOptions();
      this.toast(
        `已匯入 ${parsed.scenarios.length} 個方案，其中 ${migratedCount} 個已遷移`,
      );
    } catch (error) {
      this.toast(
        error instanceof SyntaxError
          ? '匯入檔案不是有效的 JSON'
          : error instanceof Error
            ? error.message
            : '匯入檔案失敗',
        true,
      );
    } finally {
      input.value = '';
    }
  }

  private toast(message: string, danger = false): void {
    document.querySelector('.toast')?.remove();
    const toast = document.createElement('div');
    toast.className = `toast ${danger ? 'danger' : ''}`;
    toast.setAttribute('role', danger ? 'alert' : 'status');
    toast.setAttribute('aria-live', danger ? 'assertive' : 'polite');
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
