import type { Editor } from 'grapesjs';
import type { PluginFn, PluginInfo, PluginRecord, PluginRef, PluginRepository } from '../types';
import type { ResolvedOptions } from '../options';
import { StateStore } from './state';
import { getRegistry, isSelf, resolvePluginId, type PluginRegistry } from './builtin';
import { PRELOAD_ERROR, PRELOADED_ID, getMeta } from './meta';
import { PluginsManagerError, fullMessage } from './errors';
import { IdbRepository, normalizeRecord } from '../storage/repository';
import { toBytes, unzip, type ArchiveInput } from '../archive/unzip';
import { readPluginPackage } from '../archive/package';
import { evaluatePlugin } from '../runtime/loader';

/** Editor events the manager triggers (`editor.on(EVENTS.change, ...)`). */
export const EVENTS = {
  /** Installed plugins are loaded; payload: `PluginInfo[]`. */
  ready: 'plugins-manager:ready',
  /** Anything in the list changed; payload: `PluginInfo[]`. */
  change: 'plugins-manager:change',
  /** payload: `PluginInfo` */
  install: 'plugins-manager:install',
  /** payload: `{ id }` */
  remove: 'plugins-manager:remove',
  /** payload: `{ id, enabled }` */
  toggle: 'plugins-manager:toggle',
  /** payload: `{ id, error }` */
  error: 'plugins-manager:error',
} as const;

interface Item {
  id: string;
  kind: 'builtin' | 'installed';
  enabled: boolean;
  running: boolean;
  controllable: boolean;
  present: boolean;
  error?: string;
  rec?: PluginRecord;
}

const noop: PluginFn = () => undefined;

/**
 * The manager core: state of built-in and installed plugins, installing,
 * removing, enabling. No DOM here — the UI (src/ui) only renders `list()`
 * and calls these methods.
 */
export class PluginsManager {
  readonly state: StateStore;
  /** Resolves when installed plugins are loaded (or failed to). */
  readonly ready: Promise<void>;

  private readonly builtins: Item[] = [];
  private readonly installed: Item[] = [];
  /** Plugins whose old code still runs: removed or reinstalled while active. */
  private readonly stale = new Set<string>();
  /** Wrappers `loadPlugins()` put into `config.plugins`: installed id → wrapper. */
  private readonly preloaded = new Map<string, Record<string, unknown>>();
  private readonly registry: PluginRegistry | null;
  private readonly repo: PluginRepository | null;
  private destroyed = false;

  constructor(
    readonly editor: Editor,
    readonly options: ResolvedOptions
  ) {
    this.state = new StateStore(options.storage, options.storageKey);
    const cfg = editor.getConfig() as { grapesjs?: unknown };
    this.registry = getRegistry(cfg.grapesjs);
    this.repo =
      options.repository === null ? null : options.repository || (typeof indexedDB !== 'undefined' ? new IdbRepository() : null);
    this.scanBuiltins();
    this.ready = this.loadInstalled();
  }

  // ---------------------------------------------------------------- builtins

  /**
   * Reads `config.plugins`. When the manager stands in the array, entries
   * AFTER it have not run yet (GrapesJS calls them in order from the same
   * array), so disabled ones are swapped for a no-op right here.
   */
  private scanBuiltins(): void {
    const list = ((this.editor.getConfig() as { plugins?: PluginRef[] }).plugins || []) as PluginRef[];
    const meta = getMeta(list);
    const disabled = this.state.getDisabled();
    const selfIdx = list.findIndex(isSelf);
    const presentIds: string[] = [];

    list.forEach((p, i) => {
      if (isSelf(p)) return;
      const preId = typeof p === 'function' ? (p as unknown as Record<string, unknown>)[PRELOADED_ID] : undefined;
      if (typeof preId === 'string') {
        this.preloaded.set(preId, p as unknown as Record<string, unknown>);
        return;
      }
      const id = meta?.ids.get(p) || resolvePluginId(p, i, this.registry, this.options.resolveId);
      if (presentIds.includes(id)) return;
      presentIds.push(id);
      const inPlace = this.options.disableInPlace && selfIdx >= 0 && i > selfIdx;
      const off = disabled.has(id);
      if (off && inPlace) list[i] = noop;
      this.builtins.push({ id, kind: 'builtin', enabled: !off, running: !(off && inPlace), controllable: inPlace, present: true });
    });

    (meta?.filtered || []).forEach((id) => {
      if (presentIds.includes(id)) return;
      presentIds.push(id);
      this.builtins.push({ id, kind: 'builtin', enabled: !disabled.has(id), running: false, controllable: true, present: true });
    });

    this.state.remember(presentIds);
    this.state.getKnown().forEach((id) => {
      if (presentIds.includes(id)) return;
      this.builtins.push({ id, kind: 'builtin', enabled: !disabled.has(id), running: false, controllable: true, present: false });
    });

    // Keep the order of the stored "known" list (the order users are used to).
    const order = this.state.getKnown();
    this.builtins.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }

  // --------------------------------------------------------------- installed

  private async loadInstalled(): Promise<void> {
    if (this.repo) {
      let records: PluginRecord[] = [];
      try {
        records = (await this.repo.getAll()).map(normalizeRecord);
      } catch (e) {
        console.error('[plugins-manager] cannot read installed plugins', e);
      }
      records.sort((a, b) => a.installedAt - b.installedAt);
      const meta = getMeta((this.editor.getConfig() as { plugins?: unknown }).plugins);
      const disabled = this.state.getDisabled();
      for (const rec of records) {
        if (this.destroyed) return;
        const item: Item = {
          id: rec.id,
          kind: 'installed',
          enabled: !disabled.has(rec.id),
          running: false,
          controllable: true,
          present: true,
          rec,
        };
        this.installed.push(item);
        const wrapper = this.preloaded.get(rec.id);
        const caught = wrapper?.[PRELOAD_ERROR];
        const preloadError = typeof caught === 'string' ? caught : meta?.preloadErrors[rec.id];
        if (wrapper || meta?.preloaded.includes(rec.id)) {
          item.running = !preloadError;
          item.error = preloadError;
        } else if (preloadError) {
          item.error = preloadError;
        } else if (item.enabled && this.options.loadInstalled) {
          await this.activate(item);
        }
      }
    }
    if (this.destroyed) return;
    this.emit(EVENTS.ready, this.list());
    this.emit(EVENTS.change, this.list());
  }

  /** Runs an installed plugin in the current editor. */
  private async activate(item: Item): Promise<void> {
    if (!item.rec) return;
    try {
      const fn = await evaluatePlugin(item.rec, this.registry);
      const all = (this.editor.getConfig() as { pluginsOpts?: Record<string, unknown> }).pluginsOpts || {};
      fn(this.editor, all[item.id] || {});
      item.running = true;
      item.error = undefined;
    } catch (e) {
      item.error = fullMessage(e);
      this.emit(EVENTS.error, { id: item.id, error: e });
      console.error(`[plugins-manager] ${item.id}`, e);
    }
  }

  // --------------------------------------------------------------------- API

  list(): PluginInfo[] {
    const info = (i: Item): PluginInfo => {
      const out: PluginInfo = {
        id: i.id,
        name: i.rec?.name || i.id,
        kind: i.kind,
        enabled: i.enabled,
        running: i.running,
        controllable: i.controllable,
        present: i.present,
      };
      if (i.rec) {
        out.version = i.rec.version;
        out.description = i.rec.description;
        out.storagePrefix = i.rec.storagePrefix;
      }
      if (i.error) out.error = i.error;
      return out;
    };
    return [...this.builtins, ...this.installed].map(info);
  }

  get(id: string): PluginInfo | undefined {
    return this.list().find((p) => p.id === id);
  }

  isEnabled(id: string): boolean {
    return !this.state.isDisabled(id);
  }

  /** Installed records (with code), e.g. for export/backup. */
  getRecord(id: string): PluginRecord | undefined {
    const rec = this.installed.find((i) => i.id === id)?.rec;
    return rec ? { ...rec } : undefined;
  }

  /**
   * True when what runs now differs from what the user chose and a page
   * reload would fix it.
   */
  get needsReload(): boolean {
    if (this.stale.size) return true;
    return [...this.builtins, ...this.installed].some(
      (i) => i.present && i.controllable && !i.error && i.enabled !== i.running
    );
  }

  /**
   * Switches a plugin on/off (persisted). An installed plugin switched on
   * runs right away; everything else takes effect after a reload.
   */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const item = this.find(id);
    if (!item) return;
    this.state.setDisabled(id, !enabled);
    item.enabled = enabled;
    if (item.kind === 'installed' && enabled && !item.running && this.options.loadInstalled) await this.activate(item);
    this.emit(EVENTS.toggle, { id, enabled });
    this.emit(EVENTS.change, this.list());
  }

  /** Installs (or updates) a plugin from a zip archive. */
  async install(input: ArchiveInput, fileName = 'plugin.zip'): Promise<PluginInfo> {
    if (!this.repo) throw new PluginsManagerError('storage', 'Installing is turned off (repository: null)');
    const bytes = await toBytes(input);
    const rec = readPluginPackage(unzip(bytes, this.options.maxArchiveSize), fileName);
    return this.installRecord(rec);
  }

  /** Installs an already parsed record (e.g. restored from a backup). */
  async installRecord(input: PluginRecord): Promise<PluginInfo> {
    if (!this.repo) throw new PluginsManagerError('storage', 'Installing is turned off (repository: null)');
    const rec = normalizeRecord(input);
    if (this.builtins.some((b) => b.id === rec.id && b.present) || isSelf(rec.id)) {
      throw new PluginsManagerError('conflict', `"${rec.id}" is already used by a built-in plugin`);
    }
    await this.repo.put(rec);
    this.state.setDisabled(rec.id, false);

    let item = this.installed.find((i) => i.id === rec.id);
    if (item) {
      item.rec = rec;
      item.enabled = true;
      // Old code keeps running until reload; a plugin cannot be "un-run".
      if (item.running) this.stale.add(rec.id);
      else await this.activate(item);
    } else {
      item = { id: rec.id, kind: 'installed', enabled: true, running: false, controllable: true, present: true, rec };
      this.installed.push(item);
      if (this.options.loadInstalled) await this.activate(item);
    }
    const info = this.get(rec.id)!;
    this.emit(EVENTS.install, info);
    this.emit(EVENTS.change, this.list());
    return info;
  }

  /** Deletes an installed plugin. */
  async remove(id: string): Promise<void> {
    const item = this.installed.find((i) => i.id === id);
    if (!item || !this.repo) return;
    await this.repo.delete(id);
    this.installed.splice(this.installed.indexOf(item), 1);
    this.state.setDisabled(id, false);
    if (item.running) this.stale.add(id);
    this.emit(EVENTS.remove, { id });
    this.emit(EVENTS.change, this.list());
  }

  /** Forgets a built-in plugin that is no longer in `config.plugins`. */
  forget(id: string): void {
    const item = this.builtins.find((b) => b.id === id);
    if (!item || item.present) return;
    this.state.forget(id);
    this.builtins.splice(this.builtins.indexOf(item), 1);
    this.emit(EVENTS.change, this.list());
  }

  /** Storage prefixes declared by installed plugins (Settings tab groups). */
  storagePrefixes(): { id: string; name: string; prefix: string }[] {
    return this.installed
      .filter((i) => i.rec?.storagePrefix)
      .map((i) => ({ id: i.id, name: i.rec!.name, prefix: i.rec!.storagePrefix }));
  }

  reload(): void {
    this.options.reload();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.repo instanceof IdbRepository) this.repo.close();
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  private find(id: string): Item | undefined {
    return this.builtins.find((i) => i.id === id) || this.installed.find((i) => i.id === id);
  }

  private emit(event: string, payload: unknown): void {
    if (this.destroyed) return;
    try {
      this.editor.trigger(event, payload);
    } catch (e) {
      console.error(`[plugins-manager] listener of ${event} failed`, e);
    }
  }
}
