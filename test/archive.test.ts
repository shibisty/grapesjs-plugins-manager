import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { isJunk, looksLikeZip, toBytes, unzip } from '../src/archive/unzip';
import { guessEntry, joinPath, looksLikeModule, readManifest, readPluginPackage, slug } from '../src/archive/package';
import { PluginsManagerError } from '../src/core/errors';
import { makeZip } from './helpers/zip';

const files = (o: Record<string, string>): Record<string, Uint8Array> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, strToU8(v)]));

const code = (e: unknown): string => (e as PluginsManagerError).code;

describe('unzip', () => {
  it('round-trips and skips junk entries', () => {
    const z = makeZip({ 'a/index.js': 'x', '__MACOSX/a/._index.js': 'junk', 'a/node_modules/d/i.js': 'dep', 'a/.DS_Store': '' });
    expect(Object.keys(unzip(z, 1e6))).toEqual(['a/index.js']);
  });

  it('rejects non-zip data', () => {
    expect(looksLikeZip(strToU8('hello'))).toBe(false);
    try {
      unzip(strToU8('hello world'), 1e6);
      expect.unreachable();
    } catch (e) {
      expect(code(e)).toBe('notZip');
    }
  });

  it('rejects a broken zip', () => {
    const z = makeZip({ 'a.js': 'x'.repeat(100) });
    try {
      unzip(z.slice(0, 30), 1e6);
      expect.unreachable();
    } catch (e) {
      expect(code(e)).toBe('notZip');
    }
  });

  it('enforces the uncompressed size limit before inflating', () => {
    const z = makeZip({ 'big.js': 'a'.repeat(50_000) });
    expect(z.length).toBeLessThan(1000);
    try {
      unzip(z, 10_000);
      expect.unreachable();
    } catch (e) {
      expect(code(e)).toBe('tooLarge');
    }
  });

  it('toBytes reads Blob, ArrayBuffer and Uint8Array', async () => {
    const u = new Uint8Array([1, 2, 3]);
    expect(await toBytes(u)).toBe(u);
    expect(Array.from(await toBytes(u.buffer))).toEqual([1, 2, 3]);
    expect(Array.from(await toBytes(new Uint8Array([9, 1, 2, 3]).subarray(1)))).toEqual([1, 2, 3]);
    expect(Array.from(await toBytes(new Blob([u])))).toEqual([1, 2, 3]);
  });

  it('isJunk', () => {
    expect(isJunk('dir/')).toBe(true);
    expect(isJunk('.git/config')).toBe(true);
    expect(isJunk('x/.hidden.js')).toBe(true);
    expect(isJunk('dist/index.js')).toBe(false);
  });
});

describe('package helpers', () => {
  it('slug', () => {
    expect(slug('My Plugin.zip')).toBe('my-plugin');
    expect(slug('@scope/grapesjs-x')).toBe('scope-grapesjs-x');
    expect(slug('---')).toBe('');
  });

  it('joinPath resolves ./ and ../', () => {
    expect(joinPath('pkg/', './dist/a.js')).toBe('pkg/dist/a.js');
    expect(joinPath('pkg/sub/', '../dist/a.js')).toBe('pkg/dist/a.js');
    expect(joinPath('', 'a.js')).toBe('a.js');
  });

  it('looksLikeModule', () => {
    expect(looksLikeModule('const a=1;\nexport default a;')).toBe(true);
    expect(looksLikeModule('function x(){}export{x as default};')).toBe(true);
    expect(looksLikeModule('import "./x.js";')).toBe(true);
    expect(looksLikeModule('(function(g,f){typeof exports=="object"&&typeof module<"u"?f(exports):f(g.x={})})(this,function(e){"use strict"; var s="export default";})')).toBe(false);
    expect(looksLikeModule('window.a = function(){ return "export default"; }')).toBe(false);
  });

  it('guessEntry prefers UMD, then index/main, then shallow; ESM last', () => {
    const f = files({ 'dist/foo.mjs': '', 'dist/foo.umd.cjs': '', 'src/index.js': '', 'x.js': '' });
    expect(guessEntry(f, '')).toBe('dist/foo.umd.cjs');
    const g = files({ 'deep/a/b.js': '', 'index.js': '', 'other.js': '' });
    expect(guessEntry(g, '')).toBe('index.js');
    expect(guessEntry(files({ 'a.mjs': '' }), '')).toBe('a.mjs');
    expect(guessEntry(files({ 'readme.md': '' }), '')).toBeUndefined();
  });

  it('readManifest: package.json prefers browser bundles and the grapesjs section', () => {
    const r = readManifest(
      files({
        'package/package.json': JSON.stringify({
          name: '@me/grapesjs-cool',
          version: '2.0.0',
          main: 'dist/index.cjs',
          unpkg: 'dist/index.umd.js',
          type: 'module',
          grapesjs: { id: 'cool', storagePrefix: 'cool:' },
        }),
      })
    );
    expect(r.base).toBe('package/');
    expect(r.entries).toEqual(['dist/index.umd.js', 'dist/index.cjs']);
    expect(r.manifest).toMatchObject({ id: 'cool', name: '@me/grapesjs-cool', version: '2.0.0', storagePrefix: 'cool:' });
    expect(r.typeModule).toBe(true);
  });

  it('readManifest: manifest.json beats package.json; BOM is fine', () => {
    const r = readManifest(
      files({
        'package.json': JSON.stringify({ name: 'pkg' }),
        'manifest.json': '﻿' + JSON.stringify({ id: 'man', main: 'p.js', format: 'module' }),
      })
    );
    expect(r.manifest.id).toBe('man');
    expect(r.manifest.format).toBe('module');
  });

  it('readManifest: invalid JSON is a readable error', () => {
    expect(() => readManifest(files({ 'manifest.json': '{nope' }))).toThrow(/manifest\.json: invalid JSON/);
  });
});

describe('readPluginPackage', () => {
  it('reads a manifest-described plugin', () => {
    const rec = readPluginPackage(
      files({
        'manifest.json': JSON.stringify({ id: 'My Plugin', name: 'My plugin', version: '1.2.3', main: './dist/p.js', global: 'myPlugin', storagePrefix: 'mp:' }),
        'dist/p.js': 'window.myPlugin = function(){};',
      }),
      'whatever.zip',
      42
    );
    expect(rec).toMatchObject({
      id: 'my-plugin',
      name: 'My plugin',
      version: '1.2.3',
      global: 'myPlugin',
      storagePrefix: 'mp:',
      format: 'script',
      entry: 'dist/p.js',
      installedAt: 42,
    });
    expect(rec.code).toContain('window.myPlugin');
    expect(rec.size).toBe(rec.code.length);
  });

  it('resolves an entry without extension', () => {
    const rec = readPluginPackage(files({ 'manifest.json': '{"id":"a","main":"lib/main"}', 'lib/main.js': '1' }), 'a.zip');
    expect(rec.entry).toBe('lib/main.js');
  });

  it('falls back to guessing when main does not exist', () => {
    const rec = readPluginPackage(files({ 'manifest.json': '{"id":"a","main":"nope.js"}', 'index.js': '1' }), 'a.zip');
    expect(rec.entry).toBe('index.js');
  });

  it('without a manifest the id comes from the archive name', () => {
    const rec = readPluginPackage(files({ 'plugin/index.js': 'window.x=1' }), 'Cool Thing.zip');
    expect(rec.id).toBe('cool-thing');
    expect(rec.name).toBe('Cool Thing');
  });

  it('detects the format: .mjs, .cjs, sniffing, explicit', () => {
    const one = (f: Record<string, string>): string => readPluginPackage(files(f), 'a.zip').format;
    expect(one({ 'a.mjs': 'export default 1' })).toBe('module');
    expect(one({ 'a.cjs': 'export default 1' })).toBe('script');
    expect(one({ 'a.js': 'export default function(){}' })).toBe('module');
    expect(one({ 'a.js': 'window.a=1' })).toBe('script');
    expect(one({ 'manifest.json': '{"id":"a","format":"script"}', 'a.js': 'export default 1' })).toBe('script');
  });

  it('errors: no js, no id', () => {
    try {
      readPluginPackage(files({ 'readme.md': 'hi' }), 'a.zip');
      expect.unreachable();
    } catch (e) {
      expect(code(e)).toBe('noJs');
    }
    try {
      readPluginPackage(files({ 'a.js': '1' }), '---.zip');
      expect.unreachable();
    } catch (e) {
      expect(code(e)).toBe('noId');
    }
  });
});
