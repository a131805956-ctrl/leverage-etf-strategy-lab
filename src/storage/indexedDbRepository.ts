import type { SavedScenario } from '../core/types';
import type { ScenarioRepository } from './repository';

const DATABASE = 'leverage-etf-strategy-lab';
const STORE = 'scenarios';

const requestAsPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 失敗'));
  });

export class IndexedDbScenarioRepository implements ScenarioRepository {
  private readonly database: Promise<IDBDatabase>;

  constructor() {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('無法開啟 IndexedDB'));
    });
  }

  async list(): Promise<SavedScenario[]> {
    const database = await this.database;
    const request = database.transaction(STORE).objectStore(STORE).getAll();
    const scenarios = await requestAsPromise(request);
    return scenarios.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(scenario: SavedScenario): Promise<void> {
    const database = await this.database;
    await requestAsPromise(
      database
        .transaction(STORE, 'readwrite')
        .objectStore(STORE)
        .put(scenario),
    );
  }

  async remove(id: string): Promise<void> {
    const database = await this.database;
    await requestAsPromise(
      database
        .transaction(STORE, 'readwrite')
        .objectStore(STORE)
        .delete(id),
    );
  }

  async get(id: string): Promise<SavedScenario | undefined> {
    const database = await this.database;
    const request = database.transaction(STORE).objectStore(STORE).get(id);
    return requestAsPromise(request);
  }
}
