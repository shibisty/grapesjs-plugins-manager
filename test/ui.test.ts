import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from 'grapesjs';
import { COMMAND_ID, getPluginsManager } from '../src/index';
import { MemoryRepository, normalizeRecord } from '../src/storage/repository';
import { LARGE_VALUE } from '../src/ui/settingsTab';
import { createEditor, destroyEditor, tick } from './helpers/editor';
import { makeZip, registeringBundle, resetRan, zipFile } from './helpers/zip';

let editor: Editor | undefined;
beforeEach(() => resetRan());
afterEach(async () => {
  await destroyEditor(editor);
  editor = undefined;
});

const modal = (): HTMLElement => document.querySelector('.gjs-pm') as HTMLElement;
const q = <T extends Element = HTMLElement>(sel: string): T => modal().querySelector(sel) as T;
const qa = (sel: string): HTMLElement[] => Array.from(modal().querySelectorAll(sel));
const click = (el: Element): void => void el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const setChecked = (input: HTMLInputElement, v: boolean): void => {
  input.checked = v;
  input.dispatchEvent(new Event('change'));
};
function named(name: string): () => void {
  return { [name]: () => undefined }[name];
}

describe('toolbar button & command', () => {
  it('adds a button to the options panel that opens the modal', async () => {
    const s = await createEditor();
    editor = s.editor;
    const btn = s.editor.Panels.getButton('options', 'plugin-manager');
    expect(btn).toBeTruthy();
    expect(btn!.get('command')).toBe(COMMAND_ID);
    s.editor.runCommand(COMMAND_ID);
    expect(s.api.isOpen).toBe(true);
    expect(modal()).toBeTruthy();
    expect(document.getElementById('gjs-pm-style')).toBeTruthy();
    expect(s.editor.Modal.getTitle()).toContain('Plugin Manager');
  });

  it('the command can open a given tab', async () => {
    const s = await createEditor();
    editor = s.editor;
    s.editor.runCommand(COMMAND_ID, { tab: 'settings' });
    expect(s.api.view!.activeTab).toBe('settings');
  });

  it('no panels rendered → floating button after load', async () => {
    const s = await createEditor({ panels: false });
    editor = s.editor;
    await tick(5);
    const float = document.querySelector('.gjs-pm-float') as HTMLButtonElement;
    expect(float).toBeTruthy();
    click(float);
    expect(s.api.isOpen).toBe(true);
  });

  it('buttonId: false — no button at all, the command still works', async () => {
    const s = await createEditor({ panels: false, options: { buttonId: false } });
    editor = s.editor;
    await tick(5);
    expect(document.querySelector('.gjs-pm-float')).toBeNull();
    s.editor.runCommand(COMMAND_ID);
    expect(s.api.isOpen).toBe(true);
  });

  it('destroy() removes the button, the floating button, the API', async () => {
    const s = await createEditor({ panels: false });
    editor = s.editor;
    await tick(5);
    s.api.destroy();
    expect(document.querySelector('.gjs-pm-float')).toBeNull();
    expect(getPluginsManager(s.editor)).toBeUndefined();
    expect((s.editor as unknown as Record<string, unknown>).PluginManager).toBeUndefined();
  });

  it('applying the plugin twice keeps one button and one API', async () => {
    const s = await createEditor();
    editor = s.editor;
    const first = s.api;
    const mod = await import('../src/index');
    mod.default(s.editor, { repository: new MemoryRepository() });
    const buttons = s.editor.Panels.getPanel('options')!.get('buttons')!.filter((b: { id: string }) => b.id === 'plugin-manager');
    expect(buttons).toHaveLength(1);
    expect(getPluginsManager(s.editor)).not.toBe(first);
  });
});

describe('Plugins tab', () => {
  it('renders built-in and installed rows with badges', async () => {
    const repo = new MemoryRepository([normalizeRecord({ id: 'ui-inst', name: 'UI Inst', version: '1.2.0', description: '<b>desc</b>', code: registeringBundle('ui-inst'), installedAt: 1 })]);
    const s = await createEditor({ plugins: ['self', named('pluginUiA')], repo });
    editor = s.editor;
    s.api.open();
    const rows = qa('.gjs-pm-row');
    expect(rows.map((r) => r.dataset.id)).toEqual(['pluginUiA', 'ui-inst']);
    expect(rows[0].textContent).toContain('built-in');
    expect(rows[1].textContent).toContain('UI Inst 1.2.0');
    expect(rows[1].textContent).toContain('installed');
    // Text, not HTML.
    expect(rows[1].querySelector('.gjs-pm-desc')!.textContent).toBe('<b>desc</b>');
    expect(rows[1].querySelector('b')).toBeNull();
  });

  it('switching a built-in off shows the reload banner; Reload calls options.reload', async () => {
    const reload = vi.fn();
    const s = await createEditor({ plugins: ['self', named('pluginUiB')], options: { reload } });
    editor = s.editor;
    s.api.open();
    const banner = q('.gjs-pm-banner');
    expect(banner.hidden).toBe(true);
    setChecked(q<HTMLInputElement>('[data-id="pluginUiB"] input'), false);
    await tick();
    expect(q('.gjs-pm-banner').hidden).toBe(false);
    expect(JSON.parse(localStorage.getItem('gjs-plugin-manager:disabled')!)).toEqual(['pluginUiB']);
    click(q('[data-action="reload"]'));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('an uncontrollable disabled plugin shows a warning and a hint, not the banner', async () => {
    localStorage.setItem('gjs-plugin-manager:disabled', JSON.stringify(['pluginUiFirst']));
    const s = await createEditor({ plugins: [named('pluginUiFirst'), 'self'] });
    editor = s.editor;
    s.api.open();
    const row = q('[data-id="pluginUiFirst"]');
    expect(row.textContent).toContain('cannot be disabled');
    expect(row.querySelector('.gjs-pm-warn')!.textContent).toMatch(/filterPlugins/);
    expect(q('.gjs-pm-banner').hidden).toBe(true);
  });

  it('a missing plugin has a Forget button', async () => {
    localStorage.setItem('gjs-plugin-manager:known', JSON.stringify(['ui-gone']));
    const s = await createEditor();
    editor = s.editor;
    s.api.open();
    expect(q('[data-id="ui-gone"]').textContent).toContain('not in config');
    click(q('[data-id="ui-gone"] [data-action="forget"]'));
    await tick();
    expect(q('[data-id="ui-gone"]')).toBeNull();
    expect(q('.gjs-pm-hint')!.textContent).toBe('No plugins found');
  });

  it('remove asks for confirmation (async confirm supported)', async () => {
    const repo = new MemoryRepository([normalizeRecord({ id: 'ui-rm', name: 'Removable', code: registeringBundle('ui-rm'), installedAt: 1 })]);
    let answer = false;
    const confirm = vi.fn(async () => answer);
    const s = await createEditor({ repo, options: { confirm } });
    editor = s.editor;
    s.api.open();
    click(q('[data-id="ui-rm"] [data-action="remove"]'));
    await tick();
    expect(confirm).toHaveBeenCalledWith('Remove the plugin "Removable"?');
    expect(await repo.getAll()).toHaveLength(1);
    answer = true;
    click(q('[data-id="ui-rm"] [data-action="remove"]'));
    await tick();
    expect(await repo.getAll()).toHaveLength(0);
    expect(q('[data-id="ui-rm"]')).toBeNull();
    expect(q('.gjs-pm-banner').hidden).toBe(false);
  });

  it('shows the error of a failed installed plugin', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repo = new MemoryRepository([normalizeRecord({ id: 'ui-bad', code: 'var z = 1;', installedAt: 1 })]);
    const s = await createEditor({ repo });
    editor = s.editor;
    s.api.open();
    expect(q('[data-id="ui-bad"] .gjs-pm-badge.err')).toBeTruthy();
    expect(q('[data-id="ui-bad"] .gjs-pm-err').textContent).toMatch(/did not register/);
  });
});

describe('Install tab', () => {
  it('installs dropped zips, logs results, refreshes the list', async () => {
    const s = await createEditor();
    editor = s.editor;
    s.api.open('install');
    const tab = s.api.view!.install!;
    await tab.handle([
      zipFile('good.zip', { 'manifest.json': '{"id":"ui-good","name":"Good","version":"3.1.0"}', 'index.js': registeringBundle('ui-good') }),
      new File(['x'], 'readme.txt'),
      zipFile('nojs.zip', { 'readme.md': 'no code' }),
      new File(['not really a zip'], 'fake.zip'),
    ]);
    const log = Array.from(tab.log.children).map((d) => `${d.className}|${d.textContent}`);
    expect(log).toEqual([
      'ok|✓ Installed: Good 3.1.0',
      'fail|✕ readme.txt: not a zip archive',
      'fail|✕ Installation failed (nojs.zip): no .js file in the archive',
      'fail|✕ Installation failed (fake.zip): not a zip archive',
    ]);
    s.api.view!.show('plugins');
    expect(q('[data-id="ui-good"]')).toBeTruthy();
  });

  it('a drop event installs too', async () => {
    const s = await createEditor();
    editor = s.editor;
    s.api.open('install');
    const drop = q('.gjs-pm-drop');
    const file = zipFile('d.zip', { 'manifest.json': '{"id":"ui-drop"}', 'index.js': registeringBundle('ui-drop') });
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
    ev.dataTransfer = { files: [file] };
    drop.dispatchEvent(ev);
    await tick(20);
    await s.api.view!.install!.handle([]);
    expect(s.api.manager.get('ui-drop')).toMatchObject({ running: true });
  });

  it('repository: null hides the Install tab', async () => {
    const s = await createEditor({ options: { repository: null } });
    editor = s.editor;
    s.api.open();
    expect(qa('.gjs-pm-tab').map((t) => t.dataset.tab)).toEqual(['plugins', 'settings']);
  });

  it('a single tab hides the tab bar', async () => {
    const s = await createEditor({ options: { repository: null, settingsTab: false } });
    editor = s.editor;
    s.api.open();
    expect(q('.gjs-pm-tabs').style.display).toBe('none');
  });
});

describe('Settings tab', () => {
  it('lists localStorage keys except the manager own, filters, saves, deletes', async () => {
    localStorage.setItem('beta', '2');
    localStorage.setItem('alpha', '1');
    localStorage.setItem('gjs-plugin-manager:disabled', '[]');
    const s = await createEditor({ options: { confirm: () => true } });
    editor = s.editor;
    s.api.open('settings');
    expect(qa('.gjs-pm-kv[data-key]').map((r) => r.dataset.key)).toEqual(['alpha', 'beta']);

    const filter = q<HTMLInputElement>('input[placeholder="Filter by key…"]');
    filter.value = 'ALP';
    filter.dispatchEvent(new Event('input'));
    expect(qa('.gjs-pm-kv[data-key]').map((r) => r.dataset.key)).toEqual(['alpha']);

    const row = q('[data-key="alpha"]');
    (row.querySelector('textarea') as HTMLTextAreaElement).value = 'changed';
    click(row.querySelector('[data-action="save"]')!);
    expect(localStorage.getItem('alpha')).toBe('changed');

    click(row.querySelector('[data-action="delete"]')!);
    await tick();
    expect(localStorage.getItem('alpha')).toBeNull();
  });

  it('adds a key', async () => {
    const s = await createEditor();
    editor = s.editor;
    s.api.open('settings');
    const [key, value] = Array.from(q('.gjs-pm-add').querySelectorAll('input, textarea')) as HTMLInputElement[];
    key.value = ' newKey ';
    value.value = '{"a":1}';
    click(q('[data-action="add"]'));
    expect(localStorage.getItem('newKey')).toBe('{"a":1}');
    expect(q('[data-key="newKey"]')).toBeTruthy();
  });

  it('settingsFilter option', async () => {
    localStorage.setItem('mine:a', '1');
    localStorage.setItem('other', '1');
    const s = await createEditor({ options: { settingsFilter: (k) => k.startsWith('mine:') } });
    editor = s.editor;
    s.api.open('settings');
    expect(qa('.gjs-pm-kv[data-key]').map((r) => r.dataset.key)).toEqual(['mine:a']);
  });

  it('large values are collapsed until "Show"', async () => {
    localStorage.setItem('gjsProject', 'x'.repeat(LARGE_VALUE + 1));
    const s = await createEditor();
    editor = s.editor;
    s.api.open('settings');
    const row = q('[data-key="gjsProject"]');
    const ta = row.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.readOnly).toBe(true);
    expect(ta.value).toBe('Large value (10 KB)');
    // Save is a no-op while collapsed (must not overwrite the project with the placeholder).
    click(row.querySelector('[data-action="save"]')!);
    expect(localStorage.getItem('gjsProject')!.length).toBe(LARGE_VALUE + 1);
    click(row.querySelector('[data-action="show"]')!);
    expect(ta.readOnly).toBe(false);
    expect(ta.value.length).toBe(LARGE_VALUE + 1);
  });

  it('chips narrow the list to an installed plugin storagePrefix', async () => {
    localStorage.setItem('cool:theme', 'dark');
    localStorage.setItem('zzz', '1');
    const repo = new MemoryRepository([normalizeRecord({ id: 'ui-cool', name: 'Cool', storagePrefix: 'cool:', code: registeringBundle('ui-cool'), installedAt: 1 })]);
    const s = await createEditor({ repo });
    editor = s.editor;
    s.api.open('settings');
    const chips = qa('.gjs-pm-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['All keys', 'Cool']);
    click(chips[1]);
    expect(qa('.gjs-pm-kv[data-key]').map((r) => r.dataset.key)).toEqual(['cool:theme']);
    expect(q('.gjs-pm-chip[data-prefix="cool:"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('works without storage', async () => {
    const s = await createEditor({ options: { storage: null as unknown as Storage } });
    editor = s.editor;
    s.api.open('settings');
    expect(q('.gjs-pm-hint').textContent).toBe('No matching keys in localStorage');
  });
});

describe('modal lifecycle', () => {
  it('closing the modal unsubscribes the view', async () => {
    const s = await createEditor({ plugins: ['self', named('pluginLife')] });
    editor = s.editor;
    s.api.open();
    const view = s.api.view!;
    const spy = vi.spyOn(view, 'refresh');
    s.api.close();
    expect(s.api.isOpen).toBe(false);
    await s.api.manager.setEnabled('pluginLife', false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('legacy editor.PluginManager API (0.x)', async () => {
    const pid = 'ui-legacy';
    const repo = new MemoryRepository([normalizeRecord({ id: pid, code: registeringBundle(pid), installedAt: 1 })]);
    const s = await createEditor({ plugins: ['self', named('pluginLegacy')], repo });
    editor = s.editor;
    const legacy = (s.editor as unknown as { PluginManager: { list(): unknown[]; isDisabled(id: string): boolean; ready: Promise<void>; open(): void } }).PluginManager;
    await legacy.ready;
    expect(legacy.list()).toEqual([
      { id: 'pluginLegacy', type: 'builtin', enabled: true },
      { id: pid, type: 'installed', enabled: true, status: 'on' },
    ]);
    expect(legacy.isDisabled('pluginLegacy')).toBe(false);
    legacy.open();
    expect(s.api.isOpen).toBe(true);
  });

  it('installs from the modal while it is open: list updates live', async () => {
    const s = await createEditor();
    editor = s.editor;
    s.api.open();
    await s.api.manager.install(makeZip({ 'manifest.json': '{"id":"ui-live"}', 'i.js': registeringBundle('ui-live') }), 'l.zip');
    expect(q('[data-id="ui-live"]')).toBeTruthy();
  });
});
