# Profit-Run Allocation Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default pair strategy treat rule weights as event-time minimum leveraged-weight floors, use the initial weight exactly once, and support optional exact rebalancing every N calendar days.

**Architecture:** Separate persistent rule-state resolution from trade execution. `rules.ts` emits keyed rule events without a fallback target, `rebalance.ts` owns calendar scheduling, and `backtest.ts` tracks the current floor plus active rule key and decides whether an event causes a real trade. A normalization boundary migrates old configurations while new UI configurations default to profit-run floor mode and no forced rebalance.

**Tech Stack:** TypeScript 5, Vitest, Vite, TradingView Lightweight Charts, IndexedDB, Playwright CLI.

## Global Constraints

- `baseLeveragedWeight` is the initial allocation only and must never be a post-start fallback.
- New strategies default to `allocationPolicy: 'minimum-floor'`.
- Rule floors are enforced only when a keyed rule event changes, not by daily micro-rebalancing.
- A lower floor never sells in minimum-floor mode.
- No forced rebalance is the default.
- Custom intervals use calendar days anchored to the actual first common trading date (`selected[0].date`); a closed-market due date executes on the first common trading day on or after the due date without shifting later anchors.
- Signals use close data and execute at the next common trading-day open.
- Only actual trades affect records, trade count, turnover, and costs.
- Total-return and price-only modes remain fully invested.
- Do not change cross-pair portfolio rebalancing.

---

### Task 1: Strategy configuration and legacy normalization

**Files:**
- Create: `src/core/strategyConfig.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/validation.ts`
- Modify: `tests/validation.test.ts`
- Create: `tests/strategy-config.test.ts`

**Interfaces:**
- Produces: `AllocationPolicy`, `StrategyRebalanceMode`, required `StrategyConfig.allocationPolicy`, optional `StrategyConfig.rebalance.intervalDays`.
- Produces: `normalizeStrategyConfig(value: StrategyConfig | LegacyStrategyConfig): StrategyConfig`.
- Consumes later: `runBacktest`, UI form builder, optimizer, and saved/imported configurations.

- [ ] **Step 1: Write failing configuration tests**

Add tests that express the desired migration and validation:

```ts
it('migrates event strategies to exact-target with no forced rebalance', () => {
  const normalized = normalizeStrategyConfig({
    ...legacyStrategy,
    rebalance: { mode: 'event', driftThreshold: 5 },
  });
  expect(normalized.allocationPolicy).toBe('exact-target');
  expect(normalized.rebalance).toEqual({
    mode: 'none',
    driftThreshold: 5,
  });
});

it.each([
  ['daily', 1],
  ['weekly', 7],
] as const)('migrates %s to a calendar interval', (mode, intervalDays) => {
  const normalized = normalizeStrategyConfig({
    ...legacyStrategy,
    rebalance: { mode, driftThreshold: 5 },
  });
  expect(normalized.rebalance).toMatchObject({
    mode: 'calendar-interval',
    intervalDays,
  });
});

it('rejects a non-positive calendar interval', () => {
  expect(
    validateStrategy({
      ...validStrategy,
      rebalance: {
        mode: 'calendar-interval',
        intervalDays: 0,
        driftThreshold: 5,
      },
    }),
  ).toContain('日曆天再平衡必須是正整數');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test -- --run tests/strategy-config.test.ts tests/validation.test.ts
```

Expected: failure because `normalizeStrategyConfig`, `allocationPolicy`, and `calendar-interval` do not exist.

- [ ] **Step 3: Add the types and normalizer**

Add these core types:

```ts
export type AllocationPolicy = 'minimum-floor' | 'exact-target';
export type StrategyRebalanceMode =
  | 'none'
  | 'calendar-interval'
  | 'monthly'
  | 'quarterly'
  | 'annual'
  | 'drift';

export interface StrategyConfig {
  allocationPolicy: AllocationPolicy;
  rebalance: {
    mode: StrategyRebalanceMode;
    intervalDays?: number;
    driftThreshold: number;
  };
}
```

Implement `normalizeStrategyConfig` so missing policies become `exact-target`, `event` becomes `none`, `daily` becomes a one-day calendar interval, and `weekly` becomes seven days. Preserve all other fields without mutation.

- [ ] **Step 4: Validate allocation policy and interval days**

Validation must accept both policies and require a positive integer only when `mode === 'calendar-interval'`.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```powershell
npm test -- --run tests/strategy-config.test.ts tests/validation.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/core/types.ts src/core/strategyConfig.ts src/core/validation.ts tests/strategy-config.test.ts tests/validation.test.ts
git commit -m "feat: add profit-run strategy configuration"
```

---

### Task 2: Keyed rule events without an initial-weight fallback

**Files:**
- Modify: `src/core/rules.ts`
- Modify: `tests/rules.test.ts`

**Interfaces:**
- Produces:

```ts
export interface AllocationRuleEvent {
  ruleKey: string;
  leveragedWeight: number;
  reason: Extract<TradeReason, 'NEW_HIGH' | 'DRAWDOWN' | 'RECOVERY'>;
}

export function resolveAllocationRule(
  strategy: StrategyConfig,
  state: RegimeSnapshot,
): AllocationRuleEvent | undefined;
```

- Consumes: `StrategyConfig`, `RegimeSnapshot`.
- Used by: `runBacktest`.
- `runBacktest` must pass the actual first common trading date (`selected[0].date`) as `startDate`, not the requested date before market-data intersection.

- [ ] **Step 1: Write failing rule-event tests**

Cover these exact cases:

```ts
it('does not fall back to the initial weight below the first drawdown step', () => {
  const state = advanceRegime(initialRegime(100, date(1)), 95, date(2), 5);
  expect(resolveAllocationRule(strategy, state)).toBeUndefined();
});

it('emits a stable key for the deepest reached drawdown step', () => {
  const state = advanceRegime(initialRegime(100, date(1)), 80, date(2), 5);
  expect(resolveAllocationRule(strategy, state)).toEqual({
    ruleKey: 'drawdown:20',
    leveragedWeight: 100,
    reason: 'DRAWDOWN',
  });
});

it('emits a recovery key without a drawdown fallback', () => {
  const decline = advanceRegime(initialRegime(100, date(1)), 75, date(2), 5);
  const recovery = advanceRegime(decline, 80, date(3), 5);
  expect(resolveAllocationRule(strategy, recovery)).toEqual({
    ruleKey: 'recovery:20',
    leveragedWeight: 85,
    reason: 'RECOVERY',
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm test -- --run tests/rules.test.ts
```

Expected: failure because the current resolver always returns a target and has no `ruleKey`.

- [ ] **Step 3: Implement the keyed resolver**

Rules:

```ts
if (state.regime === 'AT_HIGH') {
  return {
    ruleKey: 'new-high',
    leveragedWeight: strategy.highLeveragedWeight,
    reason: 'NEW_HIGH',
  };
}
```

For decline, return the deepest reached drawdown rule or `undefined`. For recovery, return the nearest applicable recovery rule or `undefined`. Never return `baseLeveragedWeight`.

- [ ] **Step 4: Run tests and verify GREEN**

```powershell
npm test -- --run tests/rules.test.ts
```

Expected: all rule and regime tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/core/rules.ts tests/rules.test.ts
git commit -m "feat: emit persistent allocation rule events"
```

---

### Task 3: Calendar-interval scheduling

**Files:**
- Create: `src/core/rebalance.ts`
- Create: `tests/rebalance.test.ts`
- Modify: `src/core/backtest.ts`

**Interfaces:**
- Produces:

```ts
export function scheduledRebalanceDue(
  rebalance: StrategyConfig['rebalance'],
  startDate: IsoDate,
  currentDate: IsoDate,
  nextDate: IsoDate,
): boolean;
```

- Used by: `runBacktest`.

- [ ] **Step 1: Write failing calendar tests**

```ts
it('executes the first trading day after a weekend due date', () => {
  expect(
    scheduledRebalanceDue(
      { mode: 'calendar-interval', intervalDays: 30, driftThreshold: 5 },
      '2024-01-01',
      '2024-01-26',
      '2024-02-02',
    ),
  ).toBe(true);
});

it('does not drift later anchors after a delayed execution', () => {
  const config = {
    mode: 'calendar-interval',
    intervalDays: 30,
    driftThreshold: 5,
  } as const;
  expect(scheduledRebalanceDue(config, '2024-01-01', '2024-02-23', '2024-03-01')).toBe(true);
});

it('does not fire twice inside the same interval', () => {
  expect(
    scheduledRebalanceDue(
      { mode: 'calendar-interval', intervalDays: 30, driftThreshold: 5 },
      '2024-01-01',
      '2024-02-02',
      '2024-02-05',
    ),
  ).toBe(false);
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm test -- --run tests/rebalance.test.ts
```

Expected: module/function missing.

- [ ] **Step 3: Implement schedule comparison**

For calendar intervals, compare completed interval counts:

```ts
const DAY = 86_400_000;
const elapsed = (date: IsoDate, start: IsoDate): number =>
  Math.floor(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      DAY,
  );

return (
  Math.floor(elapsed(nextDate, startDate) / intervalDays) >
  Math.floor(elapsed(currentDate, startDate) / intervalDays)
);
```

Move existing monthly, quarterly, and annual boundary checks into this module. `none` and `drift` return false.

- [ ] **Step 4: Run tests and verify GREEN**

```powershell
npm test -- --run tests/rebalance.test.ts
```

Expected: all schedule tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/core/rebalance.ts src/core/backtest.ts tests/rebalance.test.ts
git commit -m "feat: schedule calendar-day rebalances"
```

---

### Task 4: Profit-run execution in the backtest engine

**Files:**
- Modify: `src/core/backtest.ts`
- Modify: `src/core/types.ts`
- Modify: `tests/backtest.test.ts`

**Interfaces:**
- Consumes: `normalizeStrategyConfig`, `resolveAllocationRule`, `scheduledRebalanceDue`.
- Maintains internally: `currentRuleFloor`, `activeRuleKey`, and a pending execution policy.
- Produces: existing `BacktestResult` with `targetLeveragedWeight` representing the current rule floor.

- [ ] **Step 1: Write failing initial-only and no-fallback tests**

Add a price path where the first day starts at 60%, a new high raises the floor to 70%, and a later 5% decline does not return to 60%.

```ts
it('uses the initial weight once and never falls back after a new high', () => {
  const result = runBacktest(profitRunInput());
  expect(result.trades[0]).toMatchObject({
    reason: 'INITIAL',
    targetLeveragedWeight: 60,
  });
  expect(
    result.trades.some(
      (trade, index) =>
        index > 0 && trade.targetLeveragedWeight === 60,
    ),
  ).toBe(false);
});
```

- [ ] **Step 2: Write failing minimum-floor tests**

Use deterministic bars to prove:

```ts
it('does not sell when actual leveraged weight is above a higher floor', () => {
  const result = runBacktest(alreadyAboveFloorInput());
  expect(result.trades.filter((trade) => trade.reason === 'DRAWDOWN')).toHaveLength(0);
  expect(result.points.at(-1)?.targetLeveragedWeight).toBe(80);
});

it('buys only enough to reach a newly raised floor', () => {
  const result = runBacktest(belowRaisedFloorInput());
  const trade = result.trades.find((item) => item.reason === 'DRAWDOWN');
  expect(trade?.targetLeveragedWeight).toBe(90);
  expect(result.points.find((point) => point.date === trade?.date)?.leveragedWeight).toBeCloseTo(90);
});

it('updates a lower recovery floor without selling', () => {
  const result = runBacktest(recoveryFloorInput());
  expect(result.points.at(-1)?.targetLeveragedWeight).toBe(70);
  expect(result.trades.some((trade) => trade.reason === 'RECOVERY')).toBe(false);
});

it('does not micro-rebalance after weight drifts below an unchanged floor', () => {
  const result = runBacktest(unchangedFloorDriftInput());
  expect(result.trades.filter((trade) => trade.reason === 'DRAWDOWN')).toHaveLength(1);
});
```

- [ ] **Step 3: Run tests and verify RED**

```powershell
npm test -- --run tests/backtest.test.ts
```

Expected: current engine rebalances to exact targets and falls back to the initial weight.

- [ ] **Step 4: Implement pending execution policies**

Change pending orders to:

```ts
interface PendingTrade {
  targetLeveragedWeight: number;
  reason: TradeReason;
  note: string;
  policy: 'exact-target' | 'minimum-floor';
}
```

At the next open:

```ts
const actualWeight = invested > 0 ? (leveragedBefore / invested) * 100 : 0;
const shouldTrade =
  pending.policy === 'exact-target'
    ? Math.abs(actualWeight - pending.targetLeveragedWeight) > 1e-9
    : actualWeight + 1e-9 < pending.targetLeveragedWeight;
```

Always update `currentRuleFloor` when processing a rule event, but only call `rebalance` and append `TradeRecord` when `shouldTrade` and traded value exceeds tolerance. Initial and scheduled orders always use `exact-target`.

- [ ] **Step 5: Implement keyed event persistence**

After each close:

```ts
const rule = resolveAllocationRule(strategy, regime);
const changed = rule?.ruleKey !== activeRuleKey;
activeRuleKey = rule?.ruleKey;
if (rule && changed) {
  pending = {
    targetLeveragedWeight: rule.leveragedWeight,
    reason: rule.reason,
    note: `${regime.regime}：規則底線 ${rule.leveragedWeight}%`,
    policy: strategy.allocationPolicy,
  };
}
```

When no rule exists, clear only `activeRuleKey`; do not change `currentRuleFloor`.

- [ ] **Step 6: Give scheduled rebalances priority**

If a keyed rule event and scheduled due date coincide, first update the pending floor, then schedule one `SCHEDULED_REBALANCE` exact-target order to the new floor. Do not create two trades.

- [ ] **Step 7: Run focused and full core tests**

```powershell
npm test -- --run tests/backtest.test.ts tests/rules.test.ts tests/rebalance.test.ts tests/metrics.test.ts
```

Expected: all focused tests pass and no unchanged-floor event creates duplicate trades.

- [ ] **Step 8: Commit**

```powershell
git add src/core/backtest.ts src/core/types.ts tests/backtest.test.ts
git commit -m "feat: let leveraged profits run above allocation floors"
```

---

### Task 5: Cash reinvestment and actual-trade accounting

**Files:**
- Modify: `src/core/backtest.ts`
- Modify: `tests/backtest.test.ts`
- Modify: `tests/metrics.test.ts`

**Interfaces:**
- Produces an internal `investCashTowardFloor` helper that buys without selling.
- Preserves explicit `prototype` and `leveraged` dividend targets.

- [ ] **Step 1: Write failing cash-allocation tests**

```ts
it('invests target-allocation cash without selling a leveraged winner', () => {
  const result = runBacktest(cashAboveFloorInput());
  const reinvest = result.trades.find(
    (trade) => trade.reason === 'DIVIDEND_REINVEST',
  );
  expect(reinvest?.tradedValue).toBeGreaterThan(0);
  expect(result.points.at(-1)?.leveragedWeight).toBeGreaterThan(70);
});

it('does not count a no-op rule event as a trade or cost', () => {
  const result = runBacktest(costEnabledAboveFloorInput());
  expect(result.trades.filter((trade) => trade.reason === 'DRAWDOWN')).toHaveLength(0);
  expect(result.metrics.totalCosts).toBe(0);
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm test -- --run tests/backtest.test.ts tests/metrics.test.ts
```

Expected: target-allocation currently performs an exact rebalance and/or no-op events are recorded.

- [ ] **Step 3: Implement cash-only buying**

For `target-allocation` in minimum-floor mode:

1. Compute total value including cash.
2. Compute the leveraged value missing from the current floor.
3. Buy leveraged ETF with `min(cashAfterCost, missingLeveragedValue)`.
4. Put remaining cash into the prototype ETF.
5. Never reduce existing shares.

Record one dividend reinvestment trade containing actual purchases and cost.

- [ ] **Step 4: Run tests and verify GREEN**

```powershell
npm test -- --run tests/backtest.test.ts tests/metrics.test.ts
```

Expected: both tests pass; total-return and price-only tests remain fully invested.

- [ ] **Step 5: Commit**

```powershell
git add src/core/backtest.ts tests/backtest.test.ts tests/metrics.test.ts
git commit -m "feat: reinvest cash without trimming leveraged winners"
```

---

### Task 6: Default UI, calendar presets, and explanatory copy

**Files:**
- Create: `src/ui/strategyForm.ts`
- Create: `tests/strategy-form.test.ts`
- Modify: `src/ui/app.ts`
- Modify: `src/styles/app.css`
- Modify: `README.md`

**Interfaces:**
- Produces:

```ts
export function resolveRebalanceSelection(
  selection: string,
  customDays: number,
  driftThreshold: number,
): StrategyConfig['rebalance'];
```

- Consumed by: `StrategyLabApp.strategy`.

- [ ] **Step 1: Write failing form-mapping tests**

```ts
it.each([
  ['interval-30', 30],
  ['interval-180', 180],
  ['interval-365', 365],
] as const)('maps %s to calendar days', (selection, intervalDays) => {
  expect(resolveRebalanceSelection(selection, 45, 5)).toEqual({
    mode: 'calendar-interval',
    intervalDays,
    driftThreshold: 5,
  });
});

it('uses the custom calendar-day value', () => {
  expect(resolveRebalanceSelection('interval-custom', 45, 5)).toEqual({
    mode: 'calendar-interval',
    intervalDays: 45,
    driftThreshold: 5,
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm test -- --run tests/strategy-form.test.ts
```

Expected: module/function missing.

- [ ] **Step 3: Implement the form mapper**

Return `none`, calendar interval, monthly, quarterly, annual, or drift configurations with the provided drift threshold.

- [ ] **Step 4: Update strategy drawer defaults and copy**

Make these exact UI changes:

- Rename `基礎槓桿比` to `初始投入槓桿比`.
- Add `只用於開始日第一筆持倉，之後不會因離開新高而退回此比例。`
- Add `權重執行方式` with:
  - `讓利潤奔騰／最低持倉底線` selected.
  - `精確目標比例`.
- Rename `反彈減倉階梯` to `反彈最低槓桿底線`.
- Rename `組內再平衡` to `強制再平衡`.
- Select `永不` by default.
- Add 30, 180, 365, custom calendar-day choices plus existing advanced choices.
- Reveal `custom-rebalance-days` only for `interval-custom`.
- Show the approved floor explanation and a warning for exact-target or drift modes.

- [ ] **Step 5: Build `StrategyConfig` from the form**

Set:

```ts
allocationPolicy: this.get<HTMLSelectElement>('allocation-policy')
  .value as StrategyConfig['allocationPolicy'],
rebalance: resolveRebalanceSelection(
  this.get<HTMLSelectElement>('rebalance').value,
  number('custom-rebalance-days'),
  number('drift-threshold'),
),
```

The optimizer inherits these fields from the current UI strategy; rename its displayed `base` label to `initial`.

- [ ] **Step 6: Add focused styling**

Add reusable `.field-help`, `.mode-note`, and `.mode-warning` styles that work in light and dark themes without altering the existing layout system.

- [ ] **Step 7: Update README**

Document initial-only allocation, default profit-run floor mode, and optional N-calendar-day exact rebalancing.

- [ ] **Step 8: Run tests, typecheck, and build**

```powershell
npm test -- --run tests/strategy-form.test.ts tests/validation.test.ts
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

```powershell
git add src/ui/strategyForm.ts src/ui/app.ts src/styles/app.css tests/strategy-form.test.ts README.md
git commit -m "feat: make profit-run floors the default UI"
```

---

### Task 7: Saved results, exports, and regression coverage

**Files:**
- Create: `src/storage/migrateScenario.ts`
- Modify: `src/storage/repository.ts`
- Modify: `src/storage/indexedDbRepository.ts`
- Modify: `src/analysis/export.ts`
- Modify: `src/ui/app.ts`
- Modify: `tests/storage.test.ts`
- Modify: `tests/analysis-export.test.ts`
- Modify: `tests/optimization.test.ts`
- Modify: `docs/superpowers/specs/2026-07-26-leverage-etf-strategy-lab-design.md`

**Interfaces:**
- Consumes: `normalizeStrategyConfig`.
- Keeps existing saved `BacktestResult` values and fingerprints unchanged.
- Produces one centralized saved-scenario migration used by both portable-file imports and IndexedDB list/get paths.

- [ ] **Step 1: Write failing compatibility tests**

```ts
it('accepts a portable file containing a legacy pair result', () => {
  expect(isPortableScenarioFile(legacyPortableFile)).toBe(true);
});

it('exports the allocation policy and interval days', () => {
  const bundle = createAnalysisBundle(profitRunResult, dataMetadata);
  expect(bundle.configuration).toMatchObject({
    allocationPolicy: 'minimum-floor',
    rebalance: { mode: 'calendar-interval', intervalDays: 180 },
  });
});

it('migrates legacy IndexedDB and portable scenarios through one boundary', async () => {
  const migrated = migrateSavedScenario(legacySavedScenario);
  expect(migrated.pairResults[0].input.strategy).toMatchObject({
    allocationPolicy: 'exact-target',
    rebalance: { mode: 'none' },
  });
  expect(migrated.pairResults[0].result).toEqual(
    legacySavedScenario.pairResults[0].result,
  );
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm test -- --run tests/storage.test.ts tests/analysis-export.test.ts tests/optimization.test.ts
```

Expected: fixtures lack the new required strategy fields or export assertions fail.

- [ ] **Step 3: Preserve results and normalize only executable configs**

Create `migrateSavedScenario` and route both portable-file imports and IndexedDB `list`/`get` results through it. Normalize only executable strategy configurations; do not mutate saved result points, trades, metrics, or fingerprints. Catch invalid JSON imports in the UI and report how many scenarios were migrated. Update fixtures and optimizer candidates to carry explicit policies.

- JSON analysis bundles already carry the full strategy; keep that behavior.
- Add allocation policy, rebalance mode, and interval days to the CSV export metadata.
- Include the active strategy configuration in the ChatGPT analysis prompt.
- Keep optimizer candidates inheriting the active policy and rebalance configuration, and display both in optimizer results rather than optimizing them as extra axes.

- [ ] **Step 4: Update the main design**

Add the approved distinction between initial weight, event-time floor, actual weight, and forced rebalancing.

- [ ] **Step 5: Run the full automated suite**

```powershell
npm run verify
```

Expected: lint, typecheck, all tests, and production build pass.

- [ ] **Step 6: Commit**

```powershell
git add src/storage/migrateScenario.ts src/storage/repository.ts src/storage/indexedDbRepository.ts src/analysis/export.ts src/ui/app.ts tests/storage.test.ts tests/analysis-export.test.ts tests/optimization.test.ts docs/superpowers/specs/2026-07-26-leverage-etf-strategy-lab-design.md
git commit -m "test: cover profit-run compatibility and exports"
```

---

### Task 8: Real-data and browser acceptance

**Files:**
- Modify only if a verified defect is found.
- Browser artifacts: `output/playwright/profit-run-default.png`

**Interfaces:**
- Validates the complete browser behavior and public-ready build.

- [ ] **Step 1: Run fresh full verification**

```powershell
npm run verify
npm audit --omit=dev
```

Expected: all checks pass and production dependency audit reports zero vulnerabilities.

- [ ] **Step 2: Compare long-history transaction behavior**

Run the default 0050／00631L strategy from the earliest common date. Confirm from result data:

- Initial 60% appears only on the first trade.
- Leaving a high without crossing a configured rule does not generate a 60% trade.
- Floor decreases do not create recovery sales in minimum-floor mode.
- Every trade has positive traded value.

- [ ] **Step 3: Browser QA with Playwright CLI**

At 1440×1000:

1. Open the local production preview.
2. Confirm `讓利潤奔騰／最低持倉底線` and `永不` are selected.
3. Confirm the initial-weight help and renamed recovery section are visible.
4. Run the default backtest.
5. Select 180 calendar days and rerun.
6. Confirm transaction count changes only because scheduled rebalance records were added.
7. Save `output/playwright/profit-run-default.png`.
8. Confirm browser console has zero errors and warnings.

- [ ] **Step 4: Review diff and requirement checklist**

```powershell
git diff --check
git status --short
git log --oneline --decorate -10
```

Re-read every acceptance item in `docs/superpowers/specs/2026-07-26-profit-run-floor-design.md` and map it to an automated test or browser check.

- [ ] **Step 5: Publish**

Push `feat/profit-run-floor`, create a ready PR, wait for CI, merge to `main`, wait for GitHub Pages, verify both public JSON/UI routes with a cache-buster, and create release `v0.2.0`.
