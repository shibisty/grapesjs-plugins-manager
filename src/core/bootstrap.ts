import type { Editor } from 'grapesjs';
import type { PluginFn, PluginRef, PluginRepository } from '../types';
import { DEFAULT_STORAGE_KEY, defaultStorage } from '../options';
import { getRegistry, isSelf, readDisabled, resolvePluginId } from './builtin';
import { PRELOAD_ERROR, PRELOADED_ID, emptyMeta, getMeta, setMeta } from './meta';
import { errorMessage, fullMessage } from './errors';
import { IdbRepository } from '../storage/repository';
import { evaluatePlugin } from '../runtime/loader';

export interface BootstrapOptions {
  /** Same as the plugin option. Default `gjs-plugin-manager`. */
  storageKey?: string;
  storage?: Storage | null;
  /** The grapesjs object (for its plugin registry). Default `window.grapesjs`. */
  grapesjs?: unknown;
  resolveId?: (plugin: PluginRef, index: number) => string | undefined | null;
}

export interface LoadPluginsOptions extends BootstrapOptions {
  /** Default: IndexedDB database `gjs-plugin-manager`. */
  repository?: PluginRepository;
}

/**
 * Removes the plugins the user switched off from a `plugins` array —
 * BEFORE `grapesjs.init`, so they never run. The manager itself is kept.
 *
 *   grapesjs.init({ plugins: filterPlugins([pluginsManager, a, b]) })
 */
export function filterPlugins(plugins: PluginRef[], opts: BootstrapOptions | string = {}): PluginRef[] {
  const o: BootstrapOptions = typeof opts === 'string' ? { storageKey: opts } : opts;
  const storage = o.storage !== undefined ? o.storage : defaultStorage();
  const disabled = readDisabled(storage, o.storageKey || DEFAULT_STORAGE_KEY);
  const registry = getRegistry(o.grapesjs);
  const meta = emptyMeta();
  const prev = getMeta(plugins);
  const out: PluginRef[] = [];
  plugins.forEach((p, i) => {
    if (isSelf(p)) {
      out.push(p);
      return;
    }
    const id = prev?.ids.get(p) || resolvePluginId(p, i, registry, o.resolveId);
    meta.ids.set(p, id);
    if (disabled.has(id)) meta.filtered.push(id);
    else out.push(p);
  });
  return setMeta(out, meta);
}

/**
 * The full bootstrap: `filterPlugins()` + installed plugins loaded from
 * IndexedDB and appended to the array, so they run DURING init like any
 * other plugin (their `editor.on('load')` handlers fire, components and
 * blocks exist before the project loads).
 *
 *   const plugins = await loadPlugins([pluginsManager, a, b]);
 *   grapesjs.init({ plugins, pluginsOpts: { 'my-installed-id': {...} } });
 *
 * Installed plugins get their options from `pluginsOpts[<installed id>]`.
 * Failures are not thrown: the manager shows them in the list.
 */
export async function loadPlugins(plugins: PluginRef[], opts: LoadPluginsOptions = {}): Promise<PluginRef[]> {
  const out = filterPlugins(plugins, opts);
  const meta = getMeta(out)!;
  const storage = opts.storage !== undefined ? opts.storage : defaultStorage();
  const disabled = readDisabled(storage, opts.storageKey || DEFAULT_STORAGE_KEY);
  const registry = getRegistry(opts.grapesjs);
  let records;
  try {
    records = await (opts.repository || new IdbRepository()).getAll();
  } catch (e) {
    console.error('[plugins-manager] cannot read installed plugins', e);
    return out;
  }
  records.sort((a, b) => a.installedAt - b.installedAt);
  for (const rec of records) {
    if (disabled.has(rec.id)) continue;
    try {
      const fn = await evaluatePlugin(rec, registry);
      // The wrapper itself carries the id (and a caught error): the manager
      // recognises it even if the array was copied and lost its metadata.
      const wrapper = ((editor: Editor) => {
        const all = (editor.getConfig() as { pluginsOpts?: Record<string, unknown> }).pluginsOpts || {};
        try {
          fn(editor, all[rec.id] || {});
        } catch (e) {
          // One broken installed plugin must not break the whole editor init.
          meta.preloadErrors[rec.id] = errorMessage(e);
          wrapper[PRELOAD_ERROR] = errorMessage(e);
          console.error(`[plugins-manager] ${rec.id}`, e);
        }
      }) as PluginFn & Record<string, unknown>;
      wrapper[PRELOADED_ID] = rec.id;
      out.push(wrapper);
      meta.preloaded.push(rec.id);
    } catch (e) {
      meta.preloadErrors[rec.id] = fullMessage(e);
      console.error(`[plugins-manager] ${rec.id}`, e);
    }
  }
  return out;
}
