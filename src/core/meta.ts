import type { PluginRef } from '../types';

/**
 * Metadata `filterPlugins()` / `loadPlugins()` attach to the array they
 * return. GrapesJS keeps that very array as `config.plugins`
 * (`initConfig = { ...config }` is a shallow copy), so the manager finds
 * it there during init. `Symbol.for` — works across bundle copies.
 */
export const META = Symbol.for('grapesjs-plugins-manager.meta');

/** Marker on the wrapper functions `loadPlugins()` puts into the array. */
export const PRELOADED_ID = '__pluginsManagerPreloadedId';
/** Error the wrapper caught while running the plugin during init. */
export const PRELOAD_ERROR = '__pluginsManagerPreloadError';

export interface PluginsArrayMeta {
  /** Built-in ids removed because they are disabled. */
  filtered: string[];
  /** Installed plugin ids put into the array as ready functions. */
  preloaded: string[];
  /** Installed plugins that failed to load before init: id → message. */
  preloadErrors: Record<string, string>;
  /** Ids computed for the entries (so the manager sees the same ids). */
  ids: Map<unknown, string>;
}

type WithMeta = PluginRef[] & { [META]?: PluginsArrayMeta };

export function getMeta(list: unknown): PluginsArrayMeta | undefined {
  return Array.isArray(list) ? (list as WithMeta)[META] : undefined;
}

export function setMeta(list: PluginRef[], meta: PluginsArrayMeta): PluginRef[] {
  Object.defineProperty(list, META, { value: meta, enumerable: false, configurable: true });
  return list;
}

export function emptyMeta(): PluginsArrayMeta {
  return { filtered: [], preloaded: [], preloadErrors: {}, ids: new Map() };
}
