import { describe, expect, it } from 'vitest';

import {
  isPortableScenarioFile,
  MemoryScenarioRepository,
} from '../src/storage/repository';
import { migrateSavedScenario } from '../src/storage/migrateScenario';
import type {
  BacktestResult,
  LegacyStrategyConfig,
  SavedScenario,
} from '../src/core/types';

const scenario = {
  id: 'scenario-1',
  name: '台股回撤策略',
  kind: 'pair',
  tags: ['核心'],
  createdAt: '2026-07-26T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z',
  result: { fingerprint: 'fnv1a-12345678' },
} as unknown as SavedScenario;

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

const legacyResult = {
  id: 'legacy-result',
  pairId: 'tw50',
  strategy: legacyStrategy,
  points: [{ date: '2026-01-02', value: 1_010_000 }],
  trades: [{ date: '2026-01-02', reason: 'INITIAL' }],
  metrics: { finalValue: 1_010_000 },
  fingerprint: 'fnv1a-legacy',
} as unknown as BacktestResult;

const legacyScenario = {
  id: 'legacy-scenario',
  name: 'Legacy scenario',
  kind: 'pair',
  tags: ['legacy'],
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-25T00:00:00.000Z',
  result: legacyResult,
} as unknown as SavedScenario;

describe('scenario repository', () => {
  it('saves, lists and removes scenarios', async () => {
    const repository = new MemoryScenarioRepository();
    await repository.save(scenario);
    expect(await repository.list()).toEqual([scenario]);
    await repository.remove(scenario.id);
    expect(await repository.list()).toEqual([]);
  });

  it('rejects portable files without a supported schema version', () => {
    expect(isPortableScenarioFile({ scenarios: [scenario] })).toBe(false);
    expect(
      isPortableScenarioFile({
        schemaVersion: 1,
        exportedAt: '2026-07-26T00:00:00.000Z',
        scenarios: [scenario],
      }),
    ).toBe(true);
  });

  it('rejects portable scenarios with an incomplete saved-scenario shape', () => {
    expect(
      isPortableScenarioFile({
        schemaVersion: 1,
        exportedAt: '2026-07-26T00:00:00.000Z',
        scenarios: [
          {
            id: 'incomplete',
            name: 'Incomplete scenario',
            kind: 'pair',
            tags: [],
            result: { fingerprint: 'fnv1a-incomplete' },
          },
        ],
      }),
    ).toBe(false);
  });

  it('accepts a portable file containing a legacy pair result', () => {
    expect(
      isPortableScenarioFile({
        schemaVersion: 1,
        exportedAt: '2026-07-26T00:00:00.000Z',
        scenarios: [legacyScenario],
      }),
    ).toBe(true);
  });

  it('migrates a legacy scenario without changing saved result payloads', () => {
    const migrated = migrateSavedScenario(legacyScenario);

    expect((migrated.result as BacktestResult).strategy).toMatchObject({
      allocationPolicy: 'exact-target',
      rebalance: { mode: 'none' },
    });
    expect((migrated.result as BacktestResult).points).toBe(
      legacyResult.points,
    );
    expect((migrated.result as BacktestResult).trades).toBe(
      legacyResult.trades,
    );
    expect((migrated.result as BacktestResult).metrics).toBe(
      legacyResult.metrics,
    );
    expect((migrated.result as BacktestResult).fingerprint).toBe(
      legacyResult.fingerprint,
    );
    expect(legacyResult.strategy).toBe(legacyStrategy);
  });

  it.each([
    ['daily', 1],
    ['weekly', 7],
  ] as const)(
    'maps legacy %s rebalance to a calendar interval',
    (mode, intervalDays) => {
      const migrated = migrateSavedScenario({
        ...legacyScenario,
        result: {
          ...legacyResult,
          strategy: {
            ...legacyStrategy,
            rebalance: { mode, driftThreshold: 5 },
          },
        } as unknown as BacktestResult,
      });

      expect(
        (migrated.result as BacktestResult).strategy.rebalance,
      ).toMatchObject({
        mode: 'calendar-interval',
        intervalDays,
      });
    },
  );
});
