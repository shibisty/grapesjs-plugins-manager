import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'grapesjs';
import pluginsManager, { EVENTS, loadPlugins, filterPlugins } from '../src/index';
import { MemoryRepository, normalizeRecord } from '../src/storage/repository';
import type { PluginFn } from '../src/types';
import { createEditor, destroyEditor } from './helpers/editor';
import { globalBundle, makeZip, ran, registeringBundle, resetRan, zipFile } from './helpers/zip';

let editor: Editor | undefined;
let uid = 0;
const uniq = (p: string): string => `${p}-${++uid}`;

beforeEach(() => resetRan());
afterEach(async () => {
  await destroyEditor(editor);
  editor = undefined;
});

/** Named spy plugins so ids are readable. */
function spyPlugin(name: string): PluginFn & { calls: number } {
  const fn = { [name]: function (this: unknown) { (fn as unknown as { calls: number }).calls++; } }[name] as unknown as PluginFn & { calls: number };
  fn.calls = 0;
  return fn;
}

describe('built-in plugins', () => {
  it('lists config.plugins (except itself) and remembers them', async () => {
    const pluginAlpha = spyPlugin('pluginAlpha');
    const s = await createEditor({ plugins: ['self', pluginAlpha, 'gjs-unknown-string'] });
    editor = s.editor;
    const list = s.api.list();
    expect(list.map((p) => p.id)).toEqual(['pluginAlpha', 'gjs-unknown-string']);
    expect(list[0]).toMatchObject({ kind: 'builtin', enabled: true, running: true, controllable: true, present: true });
    expect(JSON.parse(localStorage.getItem('gjs-plugin-manager:known')!)).toEqual(['pluginAlpha', 'gjs-unknown-string']);
  });

  it('disables in place plugins AFTER the manager (they never run)', async () => {
    localStorage.setItem('gjs-plugin-manager:disabled', JSON.stringify(['pluginAfter']));
    const pluginAfter = spyPlugin('pluginAfter');
    const s = await createEditor({ plugins: ['self', pluginAfter] });
    editor = s.editor;
    expect(pluginAfter.calls).toBe(0);
    expect(s.api.manager.get('pluginAfter')).toMatchObject({ enabled: false, running: false, controllable: true });
    expect(s.api.manager.needsReload).toBe(false);
  });

  it('plugins BEFORE the manager already ran: marked uncontrollable, no reload banner', async () => {
    localStorage.setItem('gjs-plugin-manager:disabled', JSON.stringify(['pluginBefore']));
    const pluginBefore = spyPlugin('pluginBefore');
    const s = await createEditor({ plugins: [pluginBefore, 'self'] });
    editor = s.editor;
    expect(pluginBefore.calls).toBe(1);
    expect(s.api.manager.get('pluginBefore')).toMatchObject({ enabled: false, running: true, controllable: false });
    expect(s.api.manager.needsReload).toBe(false);
  });

  it('disableInPlace: false leaves the array alone', async () => {
    localStorage.setItem('gjs-plugin-manager:disabled', JSON.stringify(['pluginKept']));
    const pluginKept = spyPlugin('pluginKept');
    const s = await createEditor({ plugins: ['self', pluginKept], options: { disableInPlace: false } });
    editor = s.editor;
    expect(pluginKept.calls).toBe(1);
  });

  it('filterPlugins(): filtered ones are listed as disabled & controllable', async () => {
    localStorage.setItem('gjs-plugin-manager:disabled', JSON.stringify(['pluginFiltered']));
    const pluginFiltered = spyPlugin('pluginFiltered');
    const pluginOther = spyPlugin('pluginOther');
    const plugins = filterPlugins([pluginFiltered, pluginsManager, pluginOther]);
    const s = await createEditor({ plugins });
    editor = s.editor;
    expect(pluginFiltered.calls).toBe(0);
    expect(pluginOther.calls).toBe(1);
    expect(s.api.manager.get('pluginFiltered')).toMatchObject({ enabled: false, running: false, controllable: true, present: true });
    await s.api.manager.setEnabled('pluginFiltered', true);
    expect(s.api.manager.needsReload).toBe(true);
  });

  it('toggling a running built-in asks for a reload; toggling back clears it', async () => {
    const pluginT = spyPlugin('pluginT');
    const s = await createEditor({ plugins: ['self', pluginT] });
    editor = s.editor;
    const toggles: unknown[] = [];
    s.editor.on(EVENTS.toggle, (p: unknown) => toggles.push(p));
    await s.api.manager.setEnabled('pluginT', false);
    expect(s.api.isDisabled('pluginT')).toBe(true);
    expect(s.api.manager.needsReload).toBe(true);
    await s.api.manager.setEnabled('pluginT', true);
    expect(s.api.manager.needsReload).toBe(false);
    expect(toggles).toEqual([{ id: 'pluginT', enabled: false }, { id: 'pluginT', enabled: true }]);
  });

  it('remembered plugins no longer in config are "missing" and can be forgotten', async () => {
    localStorage.setItem('gjs-plugin-manager:known', JSON.stringify(['gone', 'pluginHere']));
    localStorage.setItem('gjs-plugin-manager:disabled', JSON.stringify(['gone']));
    const s = await createEditor({ plugins: ['self', spyPlugin('pluginHere')] });
    editor = s.editor;
    expect(s.api.list().map((p) => p.id)).toEqual(['gone', 'pluginHere']);
    expect(s.api.manager.get('gone')).toMatchObject({ present: false });
    expect(s.api.manager.needsReload).toBe(false);
    s.api.manager.forget('gone');
    expect(s.api.list().map((p) => p.id)).toEqual(['pluginHere']);
    expect(localStorage.getItem('gjs-plugin-manager:disabled')).toBe('[]');
  });
});

describe('installed plugins', () => {
  it('install(): runs right away with pluginsOpts[id], persists, emits events', async () => {
    const pid = uniq('inst');
    const s = await createEditor({ pluginsOpts: { [pid]: { color: 'red' } } });
    editor = s.editor;
    const events: string[] = [];
    s.editor.on(EVENTS.install, () => events.push('install'));
    s.editor.on(EVENTS.change, () => events.push('change'));
    const info = await s.api.manager.install(makeZip({ 'manifest.json': JSON.stringify({ id: pid, name: 'Inst', version: '1.0.0' }), 'index.js': registeringBundle(pid) }), 'x.zip');
    expect(info).toMatchObject({ id: pid, kind: 'installed', enabled: true, running: true, version: '1.0.0' });
    expect(ran()).toEqual([expect.objectContaining({ id: pid, opts: { color: 'red' } })]);
    expect((await s.repo.getAll()).map((r) => r.id)).toEqual([pid]);
    expect(events).toEqual(['install', 'change']);
    expect(s.api.manager.needsReload).toBe(false);
  });

  it('accepts a File (drop/picker) as well', async () => {
    const s = await createEditor();
    editor = s.editor;
    const info = await s.api.manager.install(zipFile('My Global.zip', { 'dist/plugin.umd.js': globalBundle('mgrGlobalFile') }), 'My Global.zip');
    expect(info.id).toBe('my-global');
    expect(info.running).toBe(true);
  });

  it('an installed plugin that fails is listed with its error', async () => {
    const s = await createEditor();
    editor = s.editor;
    const errors: unknown[] = [];
    s.editor.on(EVENTS.error, (e: unknown) => errors.push(e));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const info = await s.api.manager.install(makeZip({ 'manifest.json': '{"id":"broken-one"}', 'index.js': 'var x = 1;' }), 'b.zip');
    expect(info).toMatchObject({ running: false, enabled: true });
    expect(info.error).toMatch(/did not register/);
    expect(errors).toHaveLength(1);
    expect(s.api.manager.needsReload).toBe(false);
  });

  it('a plugin throwing at run time is caught (the editor survives)', async () => {
    const s = await createEditor();
    editor = s.editor;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = `window.grapesjs.plugins.add('thrower-x', function(){ throw new Error('kaboom'); });`;
    const info = await s.api.manager.install(makeZip({ 'manifest.json': '{"id":"thrower-x"}', 'index.js': code }), 't.zip');
    expect(info.error).toBe('kaboom');
  });

  it('loads installed plugins from the repository on start, in install order', async () => {
    const a = uniq('order-a');
    const b = uniq('order-b');
    const repo = new MemoryRepository([
      normalizeRecord({ id: b, code: registeringBundle(b), installedAt: 2 }),
      normalizeRecord({ id: a, code: registeringBundle(a), installedAt: 1 }),
    ]);
    const s = await createEditor({ repo });
    editor = s.editor;
    expect(ran().map((r) => r.id)).toEqual([a, b]);
    expect(s.api.list().map((p) => p.id)).toEqual([a, b]);
  });

  it('disabled installed plugins are listed but not run; enabling runs them immediately', async () => {
    const pid = uniq('later');
    localStorage.setItem('gjs-plugin-manager:disabled', JSON.stringify([pid]));
    const repo = new MemoryRepository([normalizeRecord({ id: pid, code: registeringBundle(pid), installedAt: 1 })]);
    const s = await createEditor({ repo });
    editor = s.editor;
    expect(ran()).toHaveLength(0);
    expect(s.api.manager.get(pid)).toMatchObject({ enabled: false, running: false });
    await s.api.manager.setEnabled(pid, true);
    expect(ran().map((r) => r.id)).toEqual([pid]);
    expect(s.api.manager.needsReload).toBe(false);
    await s.api.manager.setEnabled(pid, false);
    expect(s.api.manager.needsReload).toBe(true);
  });

  it('loadInstalled: false lists but does not run', async () => {
    const pid = uniq('noload');
    const repo = new MemoryRepository([normalizeRecord({ id: pid, code: registeringBundle(pid), installedAt: 1 })]);
    const s = await createEditor({ repo, options: { loadInstalled: false } });
    editor = s.editor;
    expect(ran()).toHaveLength(0);
    expect(s.api.list().map((p) => p.id)).toEqual([pid]);
  });

  it('reinstalling a running plugin keeps it and asks for a reload', async () => {
    const pid = uniq('re');
    const s = await createEditor();
    editor = s.editor;
    const zip = (v: string): Uint8Array => makeZip({ 'manifest.json': JSON.stringify({ id: pid, version: v }), 'index.js': registeringBundle(pid, v) });
    await s.api.manager.install(zip('1'), 'a.zip');
    const info = await s.api.manager.install(zip('2'), 'a.zip');
    expect(info).toMatchObject({ version: '2', running: true });
    expect(ran().map((r) => r.id)).toEqual(['1']);
    expect(s.api.manager.needsReload).toBe(true);
    expect(s.api.list().filter((p) => p.id === pid)).toHaveLength(1);
  });

  it('remove(): deletes from the repository; a running one asks for a reload', async () => {
    const pid = uniq('rm');
    const s = await createEditor();
    editor = s.editor;
    await s.api.manager.install(makeZip({ 'manifest.json': JSON.stringify({ id: pid }), 'index.js': registeringBundle(pid) }), 'a.zip');
    await s.api.manager.setEnabled(pid, true);
    await s.api.manager.remove(pid);
    expect(await s.repo.getAll()).toEqual([]);
    expect(s.api.manager.get(pid)).toBeUndefined();
    expect(s.api.manager.needsReload).toBe(true);
  });

  it('refuses an id taken by a built-in plugin', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = await createEditor({ plugins: ['self', 'gjs-taken'] });
    editor = s.editor;
    await expect(s.api.manager.install(makeZip({ 'manifest.json': '{"id":"gjs-taken"}', 'i.js': 'window.x=1' }), 'a.zip')).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('repository: null turns installing off', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const s = await createEditor({ options: { repository: null } });
    editor = s.editor;
    await expect(s.api.manager.install(new Uint8Array([1]), 'a.zip')).rejects.toMatchObject({ code: 'storage' });
  });

  it('an ES module plugin', async () => {
    const s = await createEditor();
    editor = s.editor;
    const code = 'export default function(editor, opts){ (window.__ran = window.__ran || []).push({ id: "esm", opts }); }';
    const info = await s.api.manager.install(makeZip({ 'manifest.json': '{"id":"esm-plugin","main":"index.mjs"}', 'index.mjs': code }), 'e.zip');
    expect(info.running).toBe(true);
    expect(ran().map((r) => r.id)).toEqual(['esm']);
  });
});

describe('loadPlugins() — installed plugins run during init', () => {
  it('runs them inside grapesjs.init (load handlers fire), with pluginsOpts[id]', async () => {
    const pid = uniq('pre');
    const repo = new MemoryRepository([normalizeRecord({ id: pid, code: registeringBundle(pid), installedAt: 1 })]);
    localStorage.setItem('gjs-plugin-manager:disabled', JSON.stringify(['pluginOffPre']));
    const pluginOffPre = spyPlugin('pluginOffPre');
    const plugins = await loadPlugins([pluginsManager, pluginOffPre], { repository: repo });
    const s = await createEditor({ plugins, repo, pluginsOpts: { [pid]: { a: 1 } } });
    editor = s.editor;
    expect(pluginOffPre.calls).toBe(0);
    expect(ran()).toEqual([expect.objectContaining({ id: pid, opts: { a: 1 }, loaded: false })]);
    expect((window as unknown as { __loadSeen?: string[] }).__loadSeen).toEqual([pid]);
    // Not activated a second time, not listed as a built-in.
    expect(s.api.list().map((p) => `${p.kind}:${p.id}`)).toEqual(['builtin:pluginOffPre', `installed:${pid}`]);
    expect(s.api.manager.get(pid)).toMatchObject({ running: true });
  });

  it('a preloaded plugin that throws does not break init and shows its error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repo = new MemoryRepository([
      normalizeRecord({ id: 'pre-throw', code: `window.grapesjs.plugins.add('pre-throw', function(){ throw new Error('nope'); });`, installedAt: 1 }),
      normalizeRecord({ id: 'pre-bad', code: 'var nothing = 1;', installedAt: 2 }),
    ]);
    const plugins = await loadPlugins([pluginsManager], { repository: repo });
    const s = await createEditor({ plugins, repo });
    editor = s.editor;
    expect(s.api.manager.get('pre-throw')).toMatchObject({ running: false, error: 'nope' });
    expect(s.api.manager.get('pre-bad')!.error).toMatch(/did not register/);
  });

  it('skips disabled installed plugins and survives a broken repository', async () => {
    const pid = uniq('pre-off');
    localStorage.setItem('gjs-plugin-manager:disabled', JSON.stringify([pid]));
    const repo = new MemoryRepository([normalizeRecord({ id: pid, code: registeringBundle(pid), installedAt: 1 })]);
    const out = await loadPlugins(['a'], { repository: repo });
    expect(out).toEqual(['a']);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { getAll: () => Promise.reject(new Error('x')), put: async () => undefined, delete: async () => undefined };
    expect(await loadPlugins(['a'], { repository: broken })).toEqual(['a']);
  });
});

describe('loadPlugins() + a copied array', () => {
  it('preloaded plugins are not run twice even when the array lost its metadata', async () => {
    const pid = uniq('copy');
    const repo = new MemoryRepository([normalizeRecord({ id: pid, code: registeringBundle(pid), installedAt: 1 })]);
    const plugins = [...(await loadPlugins([pluginsManager], { repository: repo }))];
    const s = await createEditor({ plugins, repo });
    editor = s.editor;
    expect(ran().map((r) => r.id)).toEqual([pid]);
    expect(s.api.manager.get(pid)).toMatchObject({ running: true });
  });
});

describe('loadPlugins() error details', () => {
  it('keeps the cause of a script error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repo = new MemoryRepository([normalizeRecord({ id: 'pre-boom', code: 'throw new Error("deep cause")', installedAt: 1 })]);
    const plugins = await loadPlugins([pluginsManager], { repository: repo });
    const s = await createEditor({ plugins, repo });
    editor = s.editor;
    expect(s.api.manager.get('pre-boom')!.error).toBe('Plugin script failed: deep cause');
  });
});
