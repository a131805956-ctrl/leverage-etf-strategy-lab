import { describe, expect, it } from 'vitest';

import {
  isPortableScenarioFile,
  MemoryScenarioRepository,
} from '../src/storage/repository';
import type { SavedScenario } from '../src/core/types';

const scenario = {
  id: 'scenario-1',
  name: '台股回撤策略',
  kind: 'pair',
  tags: ['核心'],
  createdAt: '2026-07-26T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z',
  result: { fingerprint: 'fnv1a-12345678' },
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
});
