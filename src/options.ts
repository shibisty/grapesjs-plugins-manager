import type { PluginRef, PluginRepository, PluginsManagerLabels, PluginsManagerOptions } from './types';

/** Registry id the manager uses for itself (and the one 0.x used). */
export const PLUGIN_ID = 'grapesjs-plugins-manager';
export const LEGACY_PLUGIN_ID = 'grapesjs-plugin-manager';
export const DEFAULT_STORAGE_KEY = 'gjs-plugin-manager';
export const DEFAULT_DB_NAME = 'gjs-plugin-manager';
export const COMMAND_ID = 'open-plugin-manager';

export interface ResolvedOptions {
  storageKey: string;
  storage: Storage | null;
  /** `undefined` = create the default IndexedDB repository lazily. */
  repository: PluginRepository | null | undefined;
  loadInstalled: boolean;
  disableInPlace: boolean;
  panel: string;
  buttonId: string | false;
  floatingButton: boolean;
  settingsFilter: (key: string) => boolean;
  settingsTab: boolean;
  maxArchiveSize: number;
  resolveId: ((plugin: PluginRef, index: number) => string | undefined | null) | null;
  labels: Partial<PluginsManagerLabels>;
  injectCss: boolean;
  confirm: (message: string) => boolean | Promise<boolean>;
  reload: () => void;
}

export function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    // Safari private mode / sandboxed iframe: accessing localStorage throws.
    return null;
  }
}

function onlyStrings(labels: unknown): Partial<PluginsManagerLabels> {
  const out: Record<string, string> = {};
  if (labels && typeof labels === 'object') {
    Object.entries(labels as Record<string, unknown>).forEach(([k, v]) => {
      if (typeof v === 'string' && v) out[k] = v;
    });
  }
  return out as Partial<PluginsManagerLabels>;
}

export function resolveOptions(opts: PluginsManagerOptions = {}): ResolvedOptions {
  return {
    storageKey: opts.storageKey || DEFAULT_STORAGE_KEY,
    storage: opts.storage !== undefined ? opts.storage : defaultStorage(),
    repository: opts.repository,
    loadInstalled: opts.loadInstalled !== false,
    disableInPlace: opts.disableInPlace !== false,
    panel: opts.panel || 'options',
    buttonId: opts.buttonId === false ? false : opts.buttonId || 'plugin-manager',
    floatingButton: opts.floatingButton !== false,
    settingsFilter: typeof opts.settingsFilter === 'function' ? opts.settingsFilter : () => true,
    settingsTab: opts.settingsTab !== false,
    maxArchiveSize: opts.maxArchiveSize && opts.maxArchiveSize > 0 ? opts.maxArchiveSize : 10 * 1024 * 1024,
    resolveId: typeof opts.resolveId === 'function' ? opts.resolveId : null,
    labels: onlyStrings(opts.labels),
    injectCss: opts.injectCss !== false,
    confirm:
      typeof opts.confirm === 'function'
        ? opts.confirm
        : (message) => (typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(message) : true),
    reload:
      typeof opts.reload === 'function'
        ? opts.reload
        : () => {
            if (typeof location !== 'undefined') location.reload();
          },
  };
}
