import { afterEach, describe, expect, it } from 'vitest';
import grapesjs from 'grapesjs';
import pluginsManager from '../src/index';
import { isSelf, resolvePluginId, getRegistry } from '../src/core/builtin';
import { filterPlugins } from '../src/core/bootstrap';
import { getMeta } from '../src/core/meta';
import type { PluginFn } from '../src/types';

const w = window as unknown as Record<string, unknown>;

describe('resolvePluginId', () => {
  afterEach(() => {
    delete w.myUmdPlugin;
    delete w.myUmdNamed;
  });

  it('strings are ids as is', () => {
    expect(resolvePluginId('gjs-blocks-basic', 3, null)).toBe('gjs-blocks-basic');
  });

  it('resolveId option wins for functions', () => {
    const fn: PluginFn = () => undefined;
    expect(resolvePluginId(fn, 0, null, () => 'custom')).toBe('custom');
  });

  it('finds the id a function is registered under in grapesjs.plugins', () => {
    const fn: PluginFn = () => undefined;
    grapesjs.plugins.add('registered-test-plugin', fn);
    expect(resolvePluginId(fn, 0, getRegistry(grapesjs))).toBe('registered-test-plugin');
  });

  it('finds the window global (plain function or { default })', () => {
    const fn: PluginFn = () => undefined;
    w.myUmdPlugin = fn;
    expect(resolvePluginId(fn, 0, null)).toBe('myUmdPlugin');
    const fn2: PluginFn = () => undefined;
    w.myUmdNamed = { default: fn2 };
    expect(resolvePluginId(fn2, 0, null)).toBe('myUmdNamed');
    expect(resolvePluginId(w.myUmdNamed as never, 0, null)).toBe('myUmdNamed');
  });

  it('uses a meaningful function name, else plugin-<index>', () => {
    function presetWebpage(): void {}
    expect(resolvePluginId(presetWebpage, 0, null)).toBe('presetWebpage');
    const minified = function e(): void {};
    expect(resolvePluginId(minified, 4, null)).toBe('plugin-4');
    expect(resolvePluginId({ default: function plugin() {} }, 2, null)).toBe('plugin-2');
    expect(resolvePluginId(() => undefined, 1, null)).toBe('plugin-1');
  });
});

describe('isSelf', () => {
  it('recognises the manager by function, { default }, and ids', () => {
    expect(isSelf(pluginsManager)).toBe(true);
    expect(isSelf({ default: pluginsManager })).toBe(true);
    expect(isSelf('grapesjs-plugins-manager')).toBe(true);
    expect(isSelf('grapesjs-plugin-manager')).toBe(true);
    expect(isSelf(() => undefined)).toBe(false);
    expect(isSelf('other')).toBe(false);
  });
});

describe('filterPlugins', () => {
  it('removes disabled plugins, keeps the manager, records metadata', () => {
    localStorage.setItem('gjs-plugin-manager:disabled', JSON.stringify(['b', 'manager-self-never']));
    const out = filterPlugins([pluginsManager, 'a', 'b', 'c']);
    expect(out).toEqual([pluginsManager, 'a', 'c']);
    expect(getMeta(out)!.filtered).toEqual(['b']);
  });

  it('accepts the 0.x signature (plugins, storageKey) and is exposed as plugin.filter', () => {
    localStorage.setItem('custom:disabled', JSON.stringify(['a']));
    expect(filterPlugins(['a', 'b'], 'custom')).toEqual(['b']);
    const legacy = (pluginsManager as unknown as { filter: typeof filterPlugins }).filter;
    expect(legacy(['a', 'b'], 'custom')).toEqual(['b']);
  });

  it('metadata is not enumerable (does not show up in JSON / spread)', () => {
    const out = filterPlugins(['a']);
    expect(Object.keys(out)).toEqual(['0']);
    expect(JSON.stringify(out)).toBe('["a"]');
  });

  it('remembers ids computed from the original positions', () => {
    const anon = [() => undefined][0];
    localStorage.setItem('gjs-plugin-manager:disabled', JSON.stringify(['x']));
    const out = filterPlugins(['x', anon]);
    expect(getMeta(out)!.ids.get(anon)).toBe('plugin-1');
  });
});
