/**
 * grapesjs-plugins-manager
 * ------------------------
 * Plugin manager for GrapesJS: a toolbar button opens a modal with tabs
 *   - Plugins:  switch built-in (config.plugins) and installed plugins on/off
 *   - Install:  install a plugin from a zip archive (code kept in IndexedDB)
 *   - Settings: key=value editor for localStorage (plugin settings)
 *
 * Usage:
 *   import grapesjs from 'grapesjs';
 *   import pluginsManager, { loadPlugins } from 'grapesjs-plugins-manager';
 *   const plugins = await loadPlugins([pluginsManager, pluginA, pluginB]);
 *   grapesjs.init({ container: '#gjs', plugins });
 *
 * or without a bundler (UMD build, global `grapesjsPluginsManager`):
 *   grapesjs.init({ plugins: [grapesjsPluginsManager.default, ...] });
 */
import type { Editor } from 'grapesjs';
import type { PluginInfo, PluginsManagerOptions } from './types';
import { COMMAND_ID, resolveOptions } from './options';
import { SELF_MARK } from './core/builtin';
import { PluginsManager } from './core/manager';
import { filterPlugins } from './core/bootstrap';
import { createTranslator, isRtl, registerMessages } from './i18n';
import { injectCss } from './ui/styles';
import { ManagerView } from './ui/view';
import { buttonRendered, floatingButton, mountButton } from './ui/button';

export type {
  PluginFn,
  PluginFormat,
  PluginInfo,
  PluginKind,
  PluginRecord,
  PluginRef,
  PluginRepository,
  PluginsManagerLabels,
  PluginsManagerOptions,
} from './types';
export type { BootstrapOptions, LoadPluginsOptions } from './core/bootstrap';
export type { CodeRunner } from './runtime/loader';
export type { TabName } from './ui/view';
export { filterPlugins, loadPlugins } from './core/bootstrap';
export { PluginsManager, EVENTS } from './core/manager';
export { PluginsManagerError } from './core/errors';
export { IdbRepository, MemoryRepository } from './storage/repository';
export { readPluginPackage } from './archive/package';
export { unzip } from './archive/unzip';
export { setCodeRunner, blobRunner } from './runtime/loader';
export { locales, SUPPORTED_LOCALES } from './i18n';
export { COMMAND_ID, PLUGIN_ID } from './options';

/** Public API of a manager instance (`getPluginsManager(editor)`). */
export interface PluginsManagerApi {
  readonly manager: PluginsManager;
  /** Resolves when installed plugins are loaded. */
  readonly ready: Promise<void>;
  /** Opens the modal (optionally on a tab). */
  open(tab?: 'plugins' | 'install' | 'settings'): void;
  close(): void;
  readonly isOpen: boolean;
  /** The open modal's view (tests, customisation). */
  readonly view: ManagerView | null;
  list(): PluginInfo[];
  isDisabled(id: string): boolean;
  /** Removes the button, command, listeners. Installed plugins keep running. */
  destroy(): void;
}

const API_KEY = '__pluginsManager';

/** Returns the manager API of an editor (undefined if the plugin isn't loaded). */
export function getPluginsManager(editor: Editor): PluginsManagerApi | undefined {
  return (editor as unknown as Record<string, PluginsManagerApi | undefined>)[API_KEY];
}

function isEditorAlive(editor: Editor): boolean {
  try {
    return !(editor.getModel() as unknown as { destroyed?: boolean }).destroyed;
  } catch {
    return false;
  }
}

function pluginsManager(editor: Editor, opts: PluginsManagerOptions = {}): void {
  // Applied twice to the same editor: the last call wins.
  getPluginsManager(editor)?.destroy();

  const options = resolveOptions(opts);
  registerMessages(editor);
  const t = createTranslator(editor, options.labels);
  const manager = new PluginsManager(editor, options);
  const install = manager.options.repository !== null;

  let view: ManagerView | null = null;
  let floating: HTMLButtonElement | null = null;
  let destroyed = false;

  const close = (): void => {
    if (view) editor.Modal.close();
  };

  const open = (tab?: 'plugins' | 'install' | 'settings'): void => {
    if (destroyed) return;
    if (options.injectCss) injectCss();
    view?.destroy();
    const current = new ManagerView(manager, t, { install, settings: options.settingsTab, rtl: isRtl(editor) });
    view = current;
    if (tab) current.show(tab);
    editor.Modal.open({ title: t('title'), content: current.el, attributes: { class: 'gjs-pm-modal' } });
    editor.Modal.onceClose(() => {
      current.destroy();
      if (view === current) view = null;
    });
  };

  editor.Commands.add(COMMAND_ID, {
    run: (_ed: Editor, _sender: unknown, o?: { tab?: 'plugins' | 'install' | 'settings' }) => open(o?.tab),
  });

  const mount = (): void => {
    if (destroyed || options.buttonId === false) return;
    mountButton(editor, options.buttonId, options.panel, t('title'));
  };
  const ensureVisible = (): void => {
    if (destroyed || options.buttonId === false || !options.floatingButton || floating) return;
    if (!isEditorAlive(editor) || buttonRendered(editor)) return;
    if (options.injectCss) injectCss();
    floating = floatingButton(() => open(), t('title'));
  };
  mount();
  // Presets and themes may rebuild panels after us: check again on load.
  const onLoad = (): void => {
    mount();
    setTimeout(ensureVisible, 0);
  };
  editor.on('load', onLoad);

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    view?.destroy();
    view = null;
    floating?.remove();
    floating = null;
    editor.off('load', onLoad);
    editor.off('destroy', destroy);
    manager.destroy();
    try {
      if (options.buttonId !== false) {
        editor.Panels.getPanels().forEach((p: { get(prop: string): unknown }) => {
          const buttons = p.get('buttons') as { get(id: string): unknown; remove(m: unknown): void } | undefined;
          const b = buttons?.get(options.buttonId as string);
          if (b) buttons!.remove(b);
        });
      }
      editor.Commands.add(COMMAND_ID, { run: () => undefined });
    } catch {
      /* the editor is being torn down */
    }
    const self = editor as unknown as Record<string, unknown>;
    if (self[API_KEY] === api) delete self[API_KEY];
    if (self.PluginManager === legacy) delete self.PluginManager;
  };
  // GrapesJS 0.21 does not emit `destroy`; newer versions do.
  editor.on('destroy', destroy);

  const api: PluginsManagerApi = {
    manager,
    ready: manager.ready,
    open,
    close,
    get isOpen() {
      return !!view;
    },
    get view() {
      return view;
    },
    list: () => manager.list(),
    isDisabled: (id) => !manager.isEnabled(id),
    destroy,
  };

  /** 0.x API (`editor.PluginManager`), kept for existing code. */
  const legacy = {
    open: () => open(),
    ready: manager.ready,
    isDisabled: (id: string) => !manager.isEnabled(id),
    list: () =>
      manager.list().map((p) =>
        p.kind === 'builtin'
          ? { id: p.id, type: 'builtin' as const, enabled: p.enabled }
          : { id: p.id, type: 'installed' as const, enabled: p.enabled, status: p.error ? 'error' : p.running ? 'on' : 'off' }
      ),
  };

  const self = editor as unknown as Record<string, unknown>;
  self[API_KEY] = api;
  self.PluginManager = legacy;
}

// Lets the manager find itself in `config.plugins` (see core/builtin.ts).
(pluginsManager as unknown as Record<string, unknown>)[SELF_MARK] = true;

/** 0.x: `grapesjsPluginManager.filter(plugins, storageKey)`. */
(pluginsManager as unknown as Record<string, unknown>).filter = filterPlugins;

export { pluginsManager };
export default pluginsManager;
