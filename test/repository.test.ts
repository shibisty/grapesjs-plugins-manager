import { describe, expect, it } from 'vitest';
import { IdbRepository, MemoryRepository, normalizeRecord } from '../src/storage/repository';
import type { PluginRecord } from '../src/types';

let n = 0;
const dbName = (): string => `test-db-${++n}-${Date.now()}`;

const rec = (id: string, extra: Partial<PluginRecord> = {}): PluginRecord =>
  normalizeRecord({ id, code: `/*${id}*/`, installedAt: 1, ...extra });

describe('IdbRepository', () => {
  it('put / getAll / delete', async () => {
    const repo = new IdbRepository(dbName());
    await repo.put(rec('a'));
    await repo.put(rec('b', { version: '1.0.0' }));
    expect((await repo.getAll()).map((r) => r.id).sort()).toEqual(['a', 'b']);
    await repo.put(rec('b', { version: '2.0.0' }));
    expect((await repo.getAll()).find((r) => r.id === 'b')!.version).toBe('2.0.0');
    await repo.delete('a');
    expect((await repo.getAll()).map((r) => r.id)).toEqual(['b']);
    repo.close();
  });

  it('reads records written by 0.x (no format / entry) into the full shape', async () => {
    const name = dbName();
    // Simulate 0.x: same db/store/keyPath, record without the new fields.
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('plugins', { keyPath: 'id' });
      r.onsuccess = () => {
        const t = r.result.transaction('plugins', 'readwrite');
        t.objectStore('plugins').put({ id: 'legacy', name: 'Legacy', code: 'x', size: 1, installedAt: 5 });
        t.oncomplete = () => {
          r.result.close();
          resolve();
        };
        t.onerror = () => reject(t.error);
      };
    });
    const repo = new IdbRepository(name);
    const [r] = await repo.getAll();
    expect(r).toMatchObject({ id: 'legacy', name: 'Legacy', format: 'script', entry: '', version: '', storagePrefix: '' });
    repo.close();
  });

  it('rejects with a storage error when IndexedDB is missing', async () => {
    const repo = new IdbRepository('x', null);
    await expect(repo.getAll()).rejects.toMatchObject({ code: 'storage' });
  });
});

describe('MemoryRepository', () => {
  it('stores copies', async () => {
    const r = rec('a');
    const repo = new MemoryRepository([r]);
    r.name = 'changed';
    const [got] = await repo.getAll();
    expect(got.name).toBe('a');
    got.name = 'changed too';
    expect((await repo.getAll())[0].name).toBe('a');
  });
});

describe('normalizeRecord', () => {
  it('fills defaults and keeps module format', () => {
    expect(normalizeRecord({ id: 'x', code: 'abc' })).toEqual({
      id: 'x', name: 'x', version: '', description: '', global: '', storagePrefix: '', format: 'script', entry: '', code: 'abc', size: 3, installedAt: 0,
    });
    expect(normalizeRecord({ id: 'x', code: '', format: 'module' }).format).toBe('module');
  });
});
