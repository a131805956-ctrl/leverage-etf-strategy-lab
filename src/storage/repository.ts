import type { SavedScenario } from '../core/types';
import { migrateSavedScenario } from './migrateScenario';

export interface PortableScenarioFile {
  schemaVersion: 1;
  exportedAt: string;
  scenarios: SavedScenario[];
}

export interface ScenarioRepository {
  list(): Promise<SavedScenario[]>;
  save(scenario: SavedScenario): Promise<void>;
  remove(id: string): Promise<void>;
  get(id: string): Promise<SavedScenario | undefined>;
}

const isScenario = (value: unknown): value is SavedScenario => {
  if (!value || typeof value !== 'object') return false;
  const scenario = value as Partial<SavedScenario>;
  return (
    typeof scenario.id === 'string' &&
    typeof scenario.name === 'string' &&
    typeof scenario.createdAt === 'string' &&
    typeof scenario.updatedAt === 'string' &&
    (scenario.kind === 'pair' || scenario.kind === 'portfolio') &&
    Array.isArray(scenario.tags) &&
    Boolean(
      scenario.result &&
        typeof scenario.result === 'object' &&
        'fingerprint' in scenario.result &&
        typeof scenario.result.fingerprint === 'string',
    )
  );
};

export function isPortableScenarioFile(
  value: unknown,
): value is PortableScenarioFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<PortableScenarioFile>;
  return (
    file.schemaVersion === 1 &&
    typeof file.exportedAt === 'string' &&
    Array.isArray(file.scenarios) &&
    file.scenarios.every(isScenario)
  );
}

export class MemoryScenarioRepository implements ScenarioRepository {
  private readonly scenarios = new Map<string, SavedScenario>();

  async list(): Promise<SavedScenario[]> {
    return Promise.resolve(
      [...this.scenarios.values()]
        .map(migrateSavedScenario)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }

  async save(scenario: SavedScenario): Promise<void> {
    this.scenarios.set(scenario.id, scenario);
    return Promise.resolve();
  }

  async remove(id: string): Promise<void> {
    this.scenarios.delete(id);
    return Promise.resolve();
  }

  async get(id: string): Promise<SavedScenario | undefined> {
    const scenario = this.scenarios.get(id);
    return Promise.resolve(
      scenario ? migrateSavedScenario(scenario) : undefined,
    );
  }
}

export const createPortableFile = (
  scenarios: SavedScenario[],
): PortableScenarioFile => ({
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  scenarios,
});
