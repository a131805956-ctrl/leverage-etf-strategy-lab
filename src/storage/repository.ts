import type { SavedScenario } from '../core/types';

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
    (scenario.kind === 'pair' || scenario.kind === 'portfolio') &&
    Array.isArray(scenario.tags) &&
    Boolean(scenario.result)
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
    return [...this.scenarios.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  async save(scenario: SavedScenario): Promise<void> {
    this.scenarios.set(scenario.id, scenario);
  }

  async remove(id: string): Promise<void> {
    this.scenarios.delete(id);
  }

  async get(id: string): Promise<SavedScenario | undefined> {
    return this.scenarios.get(id);
  }
}

export const createPortableFile = (
  scenarios: SavedScenario[],
): PortableScenarioFile => ({
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  scenarios,
});
