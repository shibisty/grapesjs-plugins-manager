import type { PluginRecord, PluginRepository } from '../types';
import { DEFAULT_DB_NAME } from '../options';
import { PluginsManagerError } from '../core/errors';

const STORE = 'plugins';

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Installed plugins in IndexedDB — database `gjs-plugin-manager`, store
 * `plugins`, keyPath `id`: the same layout as 0.x, existing installs survive.
 */
export class IdbRepository implements PluginRepository {
  private db: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly dbName: string = DEFAULT_DB_NAME,
    private readonly factory: IDBFactory | null = typeof indexedDB !== 'undefined' ? indexedDB : null
  ) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      const factory = this.factory;
      if (!factory) return Promise.reject(new PluginsManagerError('storage', 'IndexedDB is not available'));
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        const r = factory.open(this.dbName, 1);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' });
        };
        r.onsuccess = () => {
          // Another tab upgrading the schema must not be blocked by us.
          r.result.onversionchange = () => {
            r.result.close();
            this.db = null;
          };
          resolve(r.result);
        };
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new PluginsManagerError('storage', 'IndexedDB open is blocked by another tab'));
      }).catch((e) => {
        this.db = null;
        throw e;
      });
    }
    return this.db;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      let result: T;
      promisify(req).then((r) => (result = r), reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new PluginsManagerError('storage', 'IndexedDB transaction aborted'));
    });
  }

  async getAll(): Promise<PluginRecord[]> {
    const all = await this.tx('readonly', (s) => s.getAll() as IDBRequest<PluginRecord[]>);
    return (all || []).map(normalizeRecord);
  }

  async put(record: PluginRecord): Promise<void> {
    await this.tx('readwrite', (s) => s.put(record));
  }

  async delete(id: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(id));
  }

  close(): void {
    this.db?.then((d) => d.close()).catch(() => undefined);
    this.db = null;
  }
}

/** In-memory repository: tests, demos, or "install for this session only". */
export class MemoryRepository implements PluginRepository {
  private readonly items = new Map<string, PluginRecord>();

  constructor(initial: PluginRecord[] = []) {
    initial.forEach((r) => this.items.set(r.id, { ...r }));
  }

  async getAll(): Promise<PluginRecord[]> {
    return Array.from(this.items.values()).map((r) => ({ ...r }));
  }

  async put(record: PluginRecord): Promise<void> {
    this.items.set(record.id, { ...record });
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

/** Records written by 0.x have no `format`/`entry`. */
export function normalizeRecord(r: Partial<PluginRecord> & { id: string; code: string }): PluginRecord {
  return {
    id: r.id,
    name: r.name || r.id,
    version: r.version || '',
    description: r.description || '',
    global: r.global || '',
    storagePrefix: r.storagePrefix || '',
    format: r.format === 'module' ? 'module' : 'script',
    entry: r.entry || '',
    code: r.code,
    size: typeof r.size === 'number' ? r.size : r.code.length,
    installedAt: typeof r.installedAt === 'number' ? r.installedAt : 0,
  };
}
