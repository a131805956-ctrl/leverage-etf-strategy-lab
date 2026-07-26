import { describe, expect, it } from 'vitest';

import type {
  BacktestResult,
  LegacyStrategyConfig,
  PortfolioResult,
  SavedScenario,
  StrategyConfig,
} from '../src/core/types';
import { IndexedDbScenarioRepository } from '../src/storage/indexedDbRepository';
import { migrateSavedScenario } from '../src/storage/migrateScenario';
import {
  isPortableScenarioFile,
  MemoryScenarioRepository,
} from '../src/storage/repository';

const metrics = {
  finalValue: 1_010_000,
  totalReturn: 1,
  cagr: 1,
  annualizedVolatility: 2,
  downsideVolatility: 1,
  sharpe: 0.5,
  sortino: 1,
  maxDrawdown: 3,
  calmar: 0.33,
  ulcerIndex: 1,
  valueAtRisk95: -1,
  conditionalValueAtRisk95: -2,
  averageExposure: 1.6,
  turnover: 4,
  tradeCount: 1,
  totalCosts: 20,
};

const point = {
  date: '2026-01-02',
  value: 1_010_000,
  prototypeValue: 404_000,
  leveragedValue: 606_000,
  cash: 0,
  prototypeWeight: 40,
  leveragedWeight: 60,
  targetLeveragedWeight: 60,
  nominalExposure: 1.6,
  drawdown: 0,
  regime: 'AT_HIGH',
  benchmarkPrototype: 1_005_000,
  benchmarkLeveraged: 1_020_000,
};

const trade = {
  date: '2026-01-02',
  reason: 'INITIAL',
  prototypeValueBefore: 0,
  leveragedValueBefore: 0,
  cashBefore: 1_000_000,
  targetLeveragedWeight: 60,
  tradedValue: 1_000_000,
  cost: 20,
  note: 'Initial allocation',
};

const drawdown = {
  peakDate: '2026-01-02',
  troughDate: '2026-01-02',
  recoveryDate: '2026-01-02',
  depth: 0,
  durationDays: 0,
};

const legacyStrategy = {
  id: 'legacy-strategy',
  name: 'Legacy exact-target strategy',
  pairId: 'tw50',
  baseLeveragedWeight: 60,
  highLeveragedWeight: 70,
  drawdownRules: [{ threshold: 10, leveragedWeight: 80 }],
  recoveryRules: [{ distanceToHigh: 5, leveragedWeight: 70 }],
  recoveryConfirmationPct: 3,
  rebalance: { mode: 'event', driftThreshold: 5 },
  dividendMode: 'total-return',
  execution: 'next-open',
  costs: {
    enabled: true,
    commissionRate: 0.001425,
    sellTaxRate: 0.001,
    slippageRate: 0.0005,
    minimumCommission: 20,
  },
} satisfies LegacyStrategyConfig;

const makeLegacyScenario = (
  id: string,
  mode: 'event' | 'daily' | 'weekly',
  updatedAt = '2026-07-25T00:00:00.000Z',
): SavedScenario => {
  const strategy = {
    ...legacyStrategy,
    id: `${id}-strategy`,
    rebalance: { mode, driftThreshold: 5 },
  } satisfies LegacyStrategyConfig;
  const result = {
    id: `${id}-result`,
    pairId: 'tw50',
    strategy,
    startDate: '2026-01-02',
    endDate: '2026-01-02',
    initialCapital: 1_000_000,
    points: [{ ...point }],
    trades: [{ ...trade }],
    drawdowns: [{ ...drawdown }],
    metrics: { ...metrics },
    fingerprint: `fnv1a-${id}`,
  } as unknown as BacktestResult;
  return {
    id,
    name: `Legacy ${mode}`,
    kind: 'pair',
    tags: ['legacy', mode],
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt,
    result,
  };
};

const currentScenario = (() => {
  const legacy = makeLegacyScenario('scenario-1', 'event');
  const legacyResult = legacy.result as BacktestResult;
  return {
    ...legacy,
    name: 'Current scenario',
    result: {
      ...legacyResult,
      strategy: {
        ...(legacyResult.strategy as unknown as LegacyStrategyConfig),
        allocationPolicy: 'minimum-floor',
        rebalance: { mode: 'none', driftThreshold: 5 },
      } satisfies StrategyConfig,
    },
  } satisfies SavedScenario;
})();

const portfolioScenario = {
  id: 'portfolio-scenario',
  name: 'Portfolio scenario',
  kind: 'portfolio',
  tags: ['portfolio'],
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z',
  result: {
    id: 'portfolio-result',
    config: {
      id: 'portfolio-config',
      name: 'Portfolio',
      initialCapital: 2_000_000,
      allocations: [
        {
          backtestId: 'scenario-1-result',
          label: 'TW strategy',
          targetWeight: 100,
        },
      ],
      rebalance: { mode: 'annual', driftThreshold: 5 },
    },
    points: [
      {
        date: '2026-01-02',
        value: 2_000_000,
        weights: { 'scenario-1-result': 100 },
        drawdown: 0,
      },
    ],
    transfers: [
      {
        date: '2026-01-02',
        reason: 'SCHEDULED',
        amounts: { 'scenario-1-result': 2_000_000 },
      },
    ],
    metrics: { ...metrics, finalValue: 2_000_000 },
    fingerprint: 'fnv1a-portfolio',
  } satisfies PortfolioResult,
} satisfies SavedScenario;

const portableFile = (scenarios: unknown[]) => ({
  schemaVersion: 1,
  exportedAt: '2026-07-26T00:00:00.000Z',
  scenarios,
});

const requestWithResult = <T>(result: T): IDBRequest<T> => {
  const request = { result, error: null } as unknown as IDBRequest<T>;
  Object.defineProperty(request, 'onsuccess', {
    set(handler: IDBRequest<T>['onsuccess']) {
      queueMicrotask(() => {
        if (typeof handler === 'function') {
          handler.call(request, {} as Event);
        }
      });
    },
  });
  return request;
};

describe('portable scenario validation', () => {
  it('accepts current pair and portfolio results', () => {
    expect(isPortableScenarioFile(portableFile([currentScenario]))).toBe(true);
    expect(isPortableScenarioFile(portableFile([portfolioScenario]))).toBe(
      true,
    );
  });

  it('rejects unsupported versions and malformed common fields', () => {
    expect(isPortableScenarioFile({ scenarios: [currentScenario] })).toBe(
      false,
    );
    expect(
      isPortableScenarioFile(
        portableFile([{ ...currentScenario, tags: ['valid', 42] }]),
      ),
    ).toBe(false);
  });

  it('rejects fingerprint-only and kind-mismatched result payloads', () => {
    expect(
      isPortableScenarioFile(
        portableFile([
          {
            ...currentScenario,
            result: { fingerprint: 'fnv1a-incomplete' },
          },
        ]),
      ),
    ).toBe(false);
    expect(
      isPortableScenarioFile(
        portableFile([{ ...currentScenario, result: portfolioScenario.result }]),
      ),
    ).toBe(false);
    expect(
      isPortableScenarioFile(
        portableFile([
          { ...portfolioScenario, result: currentScenario.result },
        ]),
      ),
    ).toBe(false);
  });

  it('rejects malformed nested pair and portfolio entries', () => {
    const pairResult = currentScenario.result as BacktestResult;
    const portfolioResult = portfolioScenario.result as PortfolioResult;
    expect(
      isPortableScenarioFile(
        portableFile([
          {
            ...currentScenario,
            result: {
              ...pairResult,
              points: [{ ...point, value: 'not-a-number' }],
            },
          },
        ]),
      ),
    ).toBe(false);
    expect(
      isPortableScenarioFile(
        portableFile([
          {
            ...portfolioScenario,
            result: {
              ...portfolioResult,
              transfers: [
                {
                  date: '2026-01-02',
                  reason: 'UNKNOWN',
                  amounts: { allocation: 2_000_000 },
                },
              ],
            },
          },
        ]),
      ),
    ).toBe(false);
  });

  it('safely rejects malformed strategies and accepts valid legacy ones', () => {
    const legacy = makeLegacyScenario('legacy-valid', 'daily');
    const malformed = {
      ...legacy,
      result: {
        ...(legacy.result as BacktestResult),
        strategy: { ...legacyStrategy, rebalance: null },
      },
    };
    expect(() =>
      isPortableScenarioFile(portableFile([malformed])),
    ).not.toThrow();
    expect(isPortableScenarioFile(portableFile([malformed]))).toBe(false);
    expect(isPortableScenarioFile(portableFile([legacy]))).toBe(true);
  });
});

describe('saved-scenario migration', () => {
  it('migrates multiple legacy pair scenarios in the portable scenarios array', () => {
    const legacyEvent = makeLegacyScenario('legacy-event', 'event');
    const legacyWeekly = makeLegacyScenario('legacy-weekly', 'weekly');
    const source = [legacyEvent, legacyWeekly];

    expect(isPortableScenarioFile(portableFile(source))).toBe(true);
    const migrated = source.map(migrateSavedScenario);

    expect(
      (migrated[0]?.result as BacktestResult).strategy,
    ).toMatchObject({
      allocationPolicy: 'exact-target',
      rebalance: { mode: 'none' },
    });
    expect(
      (migrated[1]?.result as BacktestResult).strategy,
    ).toMatchObject({
      allocationPolicy: 'exact-target',
      rebalance: { mode: 'calendar-interval', intervalDays: 7 },
    });

    migrated.forEach((scenario, index) => {
      const sourceResult = source[index]?.result as BacktestResult;
      const migratedResult = scenario.result as BacktestResult;
      expect(migratedResult.points).toBe(sourceResult.points);
      expect(migratedResult.trades).toBe(sourceResult.trades);
      expect(migratedResult.drawdowns).toBe(sourceResult.drawdowns);
      expect(migratedResult.metrics).toBe(sourceResult.metrics);
      expect(migratedResult.fingerprint).toBe(sourceResult.fingerprint);
    });
  });

  it('maps legacy daily rebalance to one calendar day', () => {
    const migrated = migrateSavedScenario(
      makeLegacyScenario('legacy-daily', 'daily'),
    );
    expect(
      (migrated.result as BacktestResult).strategy.rebalance,
    ).toMatchObject({
      mode: 'calendar-interval',
      intervalDays: 1,
    });
  });

  it('routes repository list and get through migration without writeback', async () => {
    const repository = new MemoryScenarioRepository();
    const legacyEvent = makeLegacyScenario(
      'repo-event',
      'event',
      '2026-07-25T00:00:00.000Z',
    );
    const legacyWeekly = makeLegacyScenario(
      'repo-weekly',
      'weekly',
      '2026-07-26T00:00:00.000Z',
    );
    await repository.save(legacyEvent);
    await repository.save(legacyWeekly);

    const listed = await repository.list();
    const firstGet = await repository.get(legacyEvent.id);
    const secondGet = await repository.get(legacyEvent.id);

    expect(listed.map((scenario) => scenario.id)).toEqual([
      'repo-weekly',
      'repo-event',
    ]);
    expect(
      (listed[0]?.result as BacktestResult).strategy.rebalance,
    ).toMatchObject({ mode: 'calendar-interval', intervalDays: 7 });
    expect(
      (firstGet?.result as BacktestResult).strategy.rebalance.mode,
    ).toBe('none');
    expect(firstGet).not.toBe(secondGet);

    const rawResult = legacyEvent.result as BacktestResult;
    expect('allocationPolicy' in rawResult.strategy).toBe(false);
    expect(rawResult.strategy.rebalance.mode).toBe('event');
    expect((firstGet?.result as BacktestResult).points).toBe(rawResult.points);
    expect((firstGet?.result as BacktestResult).trades).toBe(rawResult.trades);
    expect((firstGet?.result as BacktestResult).metrics).toBe(
      rawResult.metrics,
    );
    expect((firstGet?.result as BacktestResult).fingerprint).toBe(
      rawResult.fingerprint,
    );
  });

  it('routes IndexedDB list and get through migration without writeback', async () => {
    const legacy = makeLegacyScenario('indexed-weekly', 'weekly');
    const store = {
      getAll: () => requestWithResult([legacy]),
      get: () => requestWithResult(legacy),
    };
    const database = {
      transaction: () => ({ objectStore: () => store }),
    } as unknown as IDBDatabase;
    const repository = new IndexedDbScenarioRepository(
      Promise.resolve(database),
    );

    const listed = await repository.list();
    const loaded = await repository.get(legacy.id);

    expect(
      (listed[0]?.result as BacktestResult).strategy.rebalance,
    ).toMatchObject({ mode: 'calendar-interval', intervalDays: 7 });
    expect(
      (loaded?.result as BacktestResult).strategy.rebalance,
    ).toMatchObject({ mode: 'calendar-interval', intervalDays: 7 });
    expect((loaded?.result as BacktestResult).points).toBe(
      (legacy.result as BacktestResult).points,
    );
    expect(
      'allocationPolicy' in (legacy.result as BacktestResult).strategy,
    ).toBe(false);
  });

  it('saves, lists and removes current scenarios', async () => {
    const repository = new MemoryScenarioRepository();
    await repository.save(currentScenario);
    expect(await repository.list()).toEqual([currentScenario]);
    await repository.remove(currentScenario.id);
    expect(await repository.list()).toEqual([]);
  });
});
