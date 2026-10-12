import { afterEach, describe, expect, it } from 'vitest';
import grapesjs from 'grapesjs';
import { evaluatePlugin } from '../src/runtime/loader';
import { getRegistry } from '../src/core/builtin';
import { normalizeRecord } from '../src/storage/repository';
import type { PluginRecord } from '../src/types';
import { globalBundle, registeringBundle } from './helpers/zip';

(window as unknown as { grapesjs: typeof grapesjs }).grapesjs = grapesjs;
const registry = getRegistry(grapesjs);
const w = window as unknown as Record<string, unknown>;
const rec = (id: string, code: string, extra: Partial<PluginRecord> = {}): PluginRecord => normalizeRecord({ id, code, ...extra });

let uid = 0;
const id = (): string => `ldr-${++uid}`;

afterEach(() => {
  Object.keys(w).filter((k) => k.startsWith('ldrGlobal')).forEach((k) => delete w[k]);
});

describe('evaluatePlugin (script)', () => {
  it('takes the function registered under the record id', async () => {
    const pid = id();
    const fn = await evaluatePlugin(rec(pid, registeringBundle(pid)), registry);
    expect(fn).toBe(grapesjs.plugins.get(pid));
  });

  it('takes a re-registered function on reinstall (same id, new code)', async () => {
    const pid = id();
    const first = await evaluatePlugin(rec(pid, registeringBundle(pid, 'v1')), registry);
    const second = await evaluatePlugin(rec(pid, registeringBundle(pid, 'v2')), registry);
    expect(second).not.toBe(first);
    expect(second).toBe(grapesjs.plugins.get(pid));
  });

  it('uses the manifest global', async () => {
    const fn = await evaluatePlugin(rec(id(), globalBundle('ldrGlobalA'), { global: 'ldrGlobalA' }), registry);
    expect(fn).toBe((w.ldrGlobalA as { default: unknown }).default);
  });

  it('takes a plugin registered under another id', async () => {
    const other = id();
    const fn = await evaluatePlugin(rec(id(), registeringBundle(other)), registry);
    expect(fn).toBe(grapesjs.plugins.get(other));
  });

  it('finds a new window global without a manifest', async () => {
    const fn = await evaluatePlugin(rec(id(), globalBundle('ldrGlobalB')), registry);
    expect(fn).toBe((w.ldrGlobalB as { default: unknown }).default);
  });

  it('finds a REPLACED window global (reinstall of a global bundle)', async () => {
    await evaluatePlugin(rec(id(), globalBundle('ldrGlobalC')), registry);
    const before = (w.ldrGlobalC as { default: unknown }).default;
    const fn = await evaluatePlugin(rec(id(), globalBundle('ldrGlobalC')), registry);
    expect(fn).not.toBe(before);
    expect(fn).toBe((w.ldrGlobalC as { default: unknown }).default);
  });

  it('fails with notRegistered when nothing appeared', async () => {
    await expect(evaluatePlugin(rec(id(), 'var nothingHere = 1;'), registry)).rejects.toMatchObject({ code: 'notRegistered' });
  });

  it('fails with script when the bundle throws', async () => {
    await expect(evaluatePlugin(rec(id(), 'throw new Error("boom")'), registry)).rejects.toMatchObject({ code: 'script', detail: 'boom' });
  });
});

describe('evaluatePlugin (module)', () => {
  it('takes the default export', async () => {
    const fn = await evaluatePlugin(rec(id(), 'export default function plug(editor){ editor.__m = 1; }', { format: 'module' }), registry);
    expect(typeof fn).toBe('function');
  });

  it('takes the single exported function when there is no default', async () => {
    const fn = await evaluatePlugin(rec(id(), 'export function onlyOne(editor){}', { format: 'module' }), registry);
    expect(fn.name).toBe('onlyOne');
  });

  it('fails without a usable export', async () => {
    await expect(evaluatePlugin(rec(id(), 'export const x = 1;', { format: 'module' }), registry)).rejects.toMatchObject({ code: 'notRegistered' });
  });
});

describe('reinstall of a plugin registered under another id', () => {
  it('drops the old registration so the new code is picked', async () => {
    const recId = id();
    const regId = id();
    const first = await evaluatePlugin(rec(recId, registeringBundle(regId, 'v1')), registry);
    const second = await evaluatePlugin(rec(recId, registeringBundle(regId, 'v2')), registry);
    expect(second).not.toBe(first);
    expect(grapesjs.plugins.get(regId)).toBe(second);
  });
});
