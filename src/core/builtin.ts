import type { PluginFn, PluginRef } from '../types';
import { LEGACY_PLUGIN_ID, PLUGIN_ID } from '../options';

/** Marker set on the manager's own plugin function (see index.ts). */
export const SELF_MARK = '__isGrapesjsPluginsManager';

export interface PluginRegistry {
  get(id: string): PluginFn | undefined;
  getAll(): Record<string, PluginFn>;
  add?(id: string, fn: PluginFn): unknown;
}

/** `grapesjs.plugins`, from the editor config (`config.grapesjs`) or the window global. */
export function getRegistry(grapesjsRef?: unknown): PluginRegistry | null {
  const candidates = [grapesjsRef, typeof window !== 'undefined' ? (window as unknown as { grapesjs?: unknown }).grapesjs : undefined];
  for (const g of candidates) {
    const reg = (g as { plugins?: PluginRegistry } | undefined)?.plugins;
    if (reg && typeof reg.get === 'function' && typeof reg.getAll === 'function') return reg;
  }
  return null;
}

export function unwrap(ref: unknown): PluginFn | null {
  if (typeof ref === 'function') return ref as PluginFn;
  const d = (ref as { default?: unknown } | null)?.default;
  return typeof d === 'function' ? (d as PluginFn) : null;
}

export function isSelf(ref: unknown): boolean {
  if (ref === PLUGIN_ID || ref === LEGACY_PLUGIN_ID) return true;
  const fn = unwrap(ref) as (PluginFn & Record<string, unknown>) | null;
  return !!fn && fn[SELF_MARK] === true;
}

/** Function names that say nothing (minified bundles, default exports). */
const MEANINGLESS = /^(default|plugin|anonymous|exports|module|index|main|_?[a-zA-Z]{1,2}\d*)$/;

/**
 * A stable id for an entry of `config.plugins`:
 *  1. strings — as is (that is how GrapesJS looks them up);
 *  2. `resolveId` option;
 *  3. the id the function is registered under in `grapesjs.plugins`;
 *  4. the window global holding it (`grapesjsContextMenu` for UMD bundles);
 *  5. a meaningful `function.name`;
 *  6. `plugin-<index>` — unstable, changes when the array is reordered.
 */
export function resolvePluginId(
  ref: PluginRef,
  index: number,
  registry: PluginRegistry | null,
  resolveId?: ((plugin: PluginRef, index: number) => string | undefined | null) | null
): string {
  if (typeof ref === 'string') return ref;
  const custom = resolveId?.(ref, index);
  if (custom) return custom;
  const fn = unwrap(ref);
  if (fn && registry) {
    const all = registry.getAll() || {};
    const hit = Object.keys(all).find((k) => all[k] === fn);
    if (hit) return hit;
  }
  if (fn && typeof window !== 'undefined') {
    const w = window as unknown as Record<string, unknown>;
    for (const k of Object.keys(w)) {
      let v: unknown;
      try {
        v = w[k];
      } catch {
        continue;
      }
      if (v === ref || v === fn || (v && typeof v === 'object' && (v as { default?: unknown }).default === fn)) return k;
    }
  }
  const name = fn?.name || '';
  if (name && !name.includes(' ') && !MEANINGLESS.test(name)) return name;
  return `plugin-${index}`;
}

/** Reads the manager's disabled list without constructing the manager. */
export function readDisabled(storage: Storage | null, storageKey: string): Set<string> {
  try {
    const v: unknown = JSON.parse(storage?.getItem(`${storageKey}:disabled`) || '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
