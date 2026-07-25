# 槓桿 ETF 策略實驗室 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可公開部署、可重現、可擴充的槓桿 ETF 單組與多組策略回測網站。

**Architecture:** Vite/TypeScript 前端以純函數領域核心處理回測、規則、指標與跨組組合；UI、資料來源、儲存與圖表只透過型別化介面使用核心。Node 資料服務負責 TWSE 月度補抓、企業行動轉換與靜態發布，IndexedDB 保存訪客自己的方案。

**Tech Stack:** TypeScript 5、Vite、Vitest、ESLint、TradingView Lightweight Charts、Node.js、IndexedDB、GitHub Actions、Tailscale Funnel。

## Global Constraints

- 0050／00631L 與 00646／00647L 分開回測，訊號基準分別為 0050 與 00646。
- 訊號使用當日收盤資料，下一交易日開盤成交。
- 每組 ETF 權重合計 100%；只有待投入股息可暫存現金。
- 支援總報酬、純價格、股息現金三種模式。
- 交易成本預設零，啟用時提供可修改的國泰範本。
- 單組策略可組成任意數量的多組策略組合並跨組再平衡。
- 預設淺色，可切換深色；桌機完整、手機自適應。
- 所有結果含資料、策略、引擎與結果指紋。

---

### Task 1: 專案骨架與領域型別

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/core/types.ts`
- Create: `src/core/validation.ts`
- Test: `tests/validation.test.ts`

**Interfaces:**
- Produces: `PriceBar`, `DividendEvent`, `PairDefinition`, `StrategyConfig`, `BacktestResult`, `PortfolioConfig`, `validateStrategy()`.

- [ ] 寫入 `validateStrategy()` 的失敗測試，涵蓋權重不等於 100、重複門檻與非法日期。
- [ ] 執行 `npm test -- tests/validation.test.ts`，確認因模組不存在而失敗。
- [ ] 建立 TypeScript/Vite/Vitest 設定、領域型別與最小驗證實作。
- [ ] 再執行測試，確認通過。
- [ ] Commit：`chore: scaffold typed strategy lab`

### Task 2: 市場狀態與策略規則

**Files:**
- Create: `src/core/regime.ts`
- Create: `src/core/rules.ts`
- Test: `tests/rules.test.ts`

**Interfaces:**
- Consumes: `PriceBar`, `StrategyConfig`.
- Produces: `advanceRegime()`, `resolveTargetAllocation()`, `RegimeSnapshot`.

- [ ] 寫入新高、下跌、谷底更新、反彈與相同回撤不同方向的失敗測試。
- [ ] 執行單一測試檔，確認缺少實作而失敗。
- [ ] 實作只依當下與過去資料的狀態機及回撤／反彈階梯。
- [ ] 執行規則與驗證測試，確認通過。
- [ ] Commit：`feat: add stateful allocation rules`

### Task 3: 單組回測與績效

**Files:**
- Create: `src/core/backtest.ts`
- Create: `src/core/metrics.ts`
- Create: `src/core/fingerprint.ts`
- Test: `tests/backtest.test.ts`
- Test: `tests/metrics.test.ts`

**Interfaces:**
- Produces: `runBacktest(input): BacktestResult`, `calculateMetrics(points)`, `fingerprint(value)`.

- [ ] 寫入下一交易日開盤成交、三種股息模式、不留現金及交易紀錄的失敗測試。
- [ ] 執行測試並確認預期失敗。
- [ ] 實作每日估值、持倉漂移、再平衡、成本、股息與基準序列。
- [ ] 寫入 CAGR、波動率、最大回撤、Sharpe、Sortino、Calmar、Ulcer、VaR/CVaR 測試。
- [ ] 實作績效與穩定 JSON 指紋，執行全部核心測試。
- [ ] Commit：`feat: implement reproducible pair backtests`

### Task 4: 多組策略組合

**Files:**
- Create: `src/core/portfolio.ts`
- Test: `tests/portfolio.test.ts`

**Interfaces:**
- Consumes: 多個 `BacktestResult` 與 `PortfolioConfig`.
- Produces: `runPortfolioBacktest()`.

- [ ] 寫入 40／60 初始配置、年度再平衡、偏離門檻再平衡與不再平衡測試。
- [ ] 確認測試因缺少組合引擎而失敗。
- [ ] 實作共同日期對齊、子策略 NAV、跨組資金移轉與分離操作紀錄。
- [ ] 執行所有測試，確認通過。
- [ ] Commit：`feat: add multi-strategy portfolio layer`

### Task 5: 資料、快取與儲存

**Files:**
- Create: `server/yahoo.ts`
- Create: `server/cache.ts`
- Create: `server/index.ts`
- Create: `src/data/client.ts`
- Create: `src/storage/repository.ts`
- Create: `src/storage/indexedDbRepository.ts`
- Test: `tests/data-policy.test.ts`
- Test: `tests/storage.test.ts`

**Interfaces:**
- Produces: `requiredCutoff()`, `needsRefresh()`, `MarketDataClient`, `StrategyRepository`.

- [ ] 寫入上月月底、最近交易日、足夠資料不重抓及 JSON schema 驗證測試。
- [ ] 執行測試並確認失敗。
- [ ] 實作 TWSE adapter、原始／衍生檔案快取、API、CSV 匯入與 IndexedDB repository。
- [ ] 建立開發用快照資料，沒有網路時仍可展示。
- [ ] 執行測試，確認通過。
- [ ] Commit：`feat: add monthly market data pipeline`

### Task 6: 最佳化與 AI 分析包

**Files:**
- Create: `src/optimization/gridSearch.ts`
- Create: `src/optimization/pareto.ts`
- Create: `src/optimization/worker.ts`
- Create: `src/analysis/export.ts`
- Test: `tests/optimization.test.ts`
- Test: `tests/analysis-export.test.ts`

**Interfaces:**
- Produces: `gridSearch()`, `paretoFront()`, `createAnalysisBundle()`, `createChatGptPrompt()`.

- [ ] 寫入網格組合數、Pareto 支配關係、固定種子與分析包必要欄位測試。
- [ ] 確認測試因缺少模組而失敗。
- [ ] 實作可取消 Worker 搜尋、多目標排名及穩健度資料。
- [ ] 實作 JSON／CSV／提示詞匯出。
- [ ] 執行全部測試，確認通過。
- [ ] Commit：`feat: add local optimization and AI exports`

### Task 7: 專業工作台與圖表

**Files:**
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/ui/app.ts`
- Create: `src/ui/state.ts`
- Create: `src/ui/chart.ts`
- Create: `src/ui/components/*.ts`
- Create: `src/styles/tokens.css`
- Create: `src/styles/app.css`

**Interfaces:**
- Consumes: 所有核心服務。
- Produces: 單頁工作台、策略編輯、方案庫、組合頁、最佳化頁與分析頁。

- [ ] 建立有真實內容的淺色研究終端版面與深色 tokens。
- [ ] 接入兩交易對、三種股息、規則階梯、再平衡與成本表單。
- [ ] 接入同步資產曲線、水下圖、曝險軌道、標記、區間、十字線與工具列。
- [ ] 接入方案儲存／比較、多組組合、最佳化、匯入匯出及資料健康。
- [ ] 完成 1440 × 900 與 412 × 915 響應式狀態、鍵盤焦點及 reduced motion。
- [ ] 執行 `npm run typecheck && npm test && npm run build`。
- [ ] Commit：`feat: build leverage strategy workbench`

### Task 8: 維護、部署與完整驗證

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `scripts/start.ps1`
- Create: `scripts/update-data.ps1`
- Create: `scripts/funnel.ps1`
- Create: `scripts/verify.ps1`
- Create: `README.md`
- Create: `.gitignore`

**Interfaces:**
- Produces: 一鍵本機啟動、資料更新、Funnel 路由、CI 與維護文件。

- [ ] 執行 lint、typecheck、測試與 production build。
- [ ] 用 Playwright CLI 驗證桌機與手機的回測、儲存、組合、主題切換和匯出流程。
- [ ] 檢查截圖，修正遮擋、溢位、對比與圖表可讀性。
- [ ] 建立 Public GitHub Repository，推送 feature branch，建立並合併 PR。
- [ ] 將既有英文單字服務改到 `/eng-vocabulary/`，將本專案發布到 `/leverage-etf/`。
- [ ] 從公開 URL 重跑核心 smoke test。
- [ ] 建立 `v0.1.0` tag 與 GitHub Release。

## Plan Self-Review

- 規格 15 節均有對應任務。
- 核心模組介面名稱一致。
- 無 `TBD`、`TODO` 或未定義必要行為。
- 外部發布只在完整驗證通過後執行。
