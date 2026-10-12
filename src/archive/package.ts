import type { PluginFormat, PluginRecord } from '../types';
import { PluginsManagerError, errorMessage } from '../core/errors';
import type { ArchiveFiles } from './unzip';

/**
 * Plugin metadata. Read from (first match, shallowest path wins):
 *   - `manifest.json`
 *   - `package.json`, optionally with a `"grapesjs": { ... }` section
 *     whose fields override the top-level ones.
 */
export interface PluginManifest {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  main?: string;
  global?: string;
  storagePrefix?: string;
  format?: PluginFormat;
}

const SCRIPT_EXT = /\.(c|m)?js$/i;

export function slug(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/\.zip$/, '')
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

export function decodeText(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function depth(path: string): number {
  return path.split('/').length;
}

function dirOf(path: string): string {
  return path.replace(/[^/]*$/, '');
}

/** Joins `base` and a relative path, resolving `./` and `../`. */
export function joinPath(base: string, rel: string): string {
  const parts = (base + rel.replace(/^\.\//, '')).split('/');
  const out: string[] = [];
  parts.forEach((p) => {
    if (p === '' || p === '.') return;
    if (p === '..') out.pop();
    else out.push(p);
  });
  return out.join('/');
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function pickManifest(files: ArchiveFiles): { path: string; data: Record<string, unknown>; isPackageJson: boolean } | null {
  const byDepth = (re: RegExp): string | undefined =>
    Object.keys(files)
      .filter((p) => re.test(p))
      .sort((a, b) => depth(a) - depth(b))[0];
  const path = byDepth(/(^|\/)manifest\.json$/) || byDepth(/(^|\/)package\.json$/);
  if (!path) return null;
  let data: unknown;
  try {
    data = JSON.parse(decodeText(files[path]));
  } catch (e) {
    throw new PluginsManagerError('noId', `${path}: invalid JSON`, errorMessage(e));
  }
  if (!data || typeof data !== 'object') throw new PluginsManagerError('noId', `${path}: not an object`);
  return { path, data: data as Record<string, unknown>, isPackageJson: /package\.json$/.test(path) };
}

/** Normalised manifest + the candidate entry paths in priority order. */
export function readManifest(files: ArchiveFiles): { manifest: PluginManifest; base: string; entries: string[]; typeModule: boolean } {
  const picked = pickManifest(files);
  if (!picked) return { manifest: {}, base: '', entries: [], typeModule: false };
  const d = picked.data;
  const section = (d.grapesjs && typeof d.grapesjs === 'object' ? d.grapesjs : {}) as Record<string, unknown>;
  const get = (k: string): string | undefined => str(section[k]) ?? str(d[k]);
  const format = get('format');

  const entries: string[] = [];
  const add = (v: unknown): void => {
    const s = str(v);
    if (s && !entries.includes(s)) entries.push(s);
  };
  add(section.main);
  if (picked.isPackageJson) {
    // Browser-ready bundles first: `main` of a package.json is often CommonJS.
    add(d.unpkg);
    add(d.jsdelivr);
    add(d.browser);
    add(d.main);
    add(d.module);
  } else {
    add(d.main);
  }

  return {
    manifest: {
      id: get('id'),
      name: get('name'),
      version: get('version'),
      description: get('description'),
      global: get('global'),
      storagePrefix: get('storagePrefix'),
      format: format === 'module' || format === 'script' ? format : undefined,
    },
    base: dirOf(picked.path),
    entries,
    typeModule: d.type === 'module',
  };
}

/** Resolves an entry like `dist/index` → `dist/index.js` / `dist/index/index.js`. */
function findEntry(files: ArchiveFiles, base: string, entry: string): string | undefined {
  const p = joinPath(base, entry);
  return [p, `${p}.js`, `${p}/index.js`].find((c) => c in files && SCRIPT_EXT.test(c));
}

/**
 * Picks a script when the manifest names none: UMD/IIFE builds first,
 * `index|main|plugin` names next, shallow paths next, ES modules last.
 */
export function guessEntry(files: ArchiveFiles, base: string): string | undefined {
  const score = (p: string): number[] => [
    /\.mjs$/i.test(p) || /(^|[/.-])(es|esm|module)[/.-]/i.test(p) ? 1 : 0,
    /umd|iife|\.min\./i.test(p) ? 0 : 1,
    /(^|\/)(index|main|plugin)[^/]*$/i.test(p) ? 0 : 1,
    depth(p),
  ];
  const cmp = (a: number[], b: number[]): number => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  };
  return Object.keys(files)
    .filter((p) => p.startsWith(base) && SCRIPT_EXT.test(p))
    .sort((a, b) => cmp(score(a), score(b)) || a.localeCompare(b))[0];
}

/**
 * ES module sniffing for bundles without an explicit `format`: top-level
 * `export`/`import` statements and no UMD/CommonJS wrapper.
 */
export function looksLikeModule(code: string): boolean {
  if (/typeof\s+exports|typeof\s+define|typeof\s+module/.test(code)) return false;
  return /(^|[\n;})])\s*(export\s*[{*]|export\s+(default\b|const\b|let\b|var\b|function\b|class\b|async\b)|import\s*(\{|\*|[\w$]+\s*(,|from)|["']))/.test(code);
}

/**
 * Turns unpacked archive files into a `PluginRecord`.
 * Without a manifest the id comes from the archive name.
 */
export function readPluginPackage(files: ArchiveFiles, archiveName: string, now: number = Date.now()): PluginRecord {
  const { manifest: m, base, entries, typeModule } = readManifest(files);

  let entry: string | undefined;
  for (const e of entries) {
    entry = findEntry(files, base, e);
    if (entry) break;
  }
  if (!entry) entry = guessEntry(files, base) || guessEntry(files, '');
  if (!entry) throw new PluginsManagerError('noJs', 'No .js file in the archive');

  const code = decodeText(files[entry]);
  const name = m.name || archiveName.replace(/\.zip$/i, '');
  const id = slug(m.id || name);
  if (!id) throw new PluginsManagerError('noId', 'Cannot determine the plugin id');

  let format: PluginFormat;
  if (m.format) format = m.format;
  else if (/\.mjs$/i.test(entry)) format = 'module';
  else if (/\.cjs$/i.test(entry)) format = 'script';
  else if (typeModule && looksLikeModule(code)) format = 'module';
  else format = looksLikeModule(code) ? 'module' : 'script';

  return {
    id,
    name,
    version: m.version || '',
    description: m.description || '',
    global: m.global || '',
    storagePrefix: m.storagePrefix || '',
    format,
    entry,
    code,
    size: code.length,
    installedAt: now,
  };
}
