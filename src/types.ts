import type { Editor } from 'grapesjs';

/** A GrapesJS plugin function. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PluginFn = (editor: Editor, opts?: any) => void;

/** What can stand in `grapesjs.init({ plugins: [...] })`. */
export type PluginRef = string | PluginFn | { default: PluginFn };

/** How the code of an installed plugin is executed. */
export type PluginFormat =
  /** Classic `<script>` (UMD / IIFE bundle that registers a global or calls `grapesjs.plugins.add`). */
  | 'script'
  /** ES module (`export default (editor, opts) => {}`), loaded with dynamic `import()`. */
  | 'module';

/** An installed plugin as stored in the repository (IndexedDB). */
export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Window global the bundle defines (UMD name), optional. */
  global: string;
  /** localStorage prefix of the plugin's own settings (Settings tab groups by it). */
  storagePrefix: string;
  format: PluginFormat;
  /** Path of the entry file inside the archive (informational). */
  entry: string;
  code: string;
  size: number;
  installedAt: number;
}

/** Where installed plugins are kept. Default: IndexedDB (`IdbRepository`). */
export interface PluginRepository {
  getAll(): Promise<PluginRecord[]>;
  put(record: PluginRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export type PluginKind = 'builtin' | 'installed';

/** A row of the plugin list (`manager.list()`). */
export interface PluginInfo {
  id: string;
  name: string;
  kind: PluginKind;
  /** Desired state (persisted). */
  enabled: boolean;
  /** Whether the plugin code actually ran in this editor session. */
  running: boolean;
  /**
   * Built-in plugins only: whether the manager can really keep it from
   * running on the next start (see README "Disabling built-in plugins").
   */
  controllable: boolean;
  /** Built-in plugins only: false when it is remembered but no longer in `config.plugins`. */
  present: boolean;
  version?: string;
  description?: string;
  storagePrefix?: string;
  error?: string;
}

/** Texts of the UI. Every key is translated, see `src/i18n/locales`. */
export interface PluginsManagerLabels {
  title: string;
  tabPlugins: string;
  tabInstall: string;
  tabSettings: string;
  builtin: string;
  installed: string;
  error: string;
  missing: string;
  uncontrolled: string;
  uncontrolledHint: string;
  empty: string;
  remove: string;
  forget: string;
  reloadNote: string;
  reload: string;
  dropHere: string;
  orClick: string;
  dropHint: string;
  installOk: string;
  installErr: string;
  notZip: string;
  errNoJs: string;
  errNoId: string;
  errConflict: string;
  errTooLarge: string;
  errNotRegistered: string;
  errScript: string;
  filter: string;
  allKeys: string;
  key: string;
  value: string;
  add: string;
  save: string;
  del: string;
  noKeys: string;
  largeValue: string;
  showValue: string;
  confirmRemove: string;
  confirmDel: string;
}

export interface PluginsManagerOptions {
  /** Prefix of the manager's own localStorage keys. Default `gjs-plugin-manager` (same as 0.x). */
  storageKey?: string;
  /** localStorage-like storage for the manager state and the Settings tab. Default `window.localStorage`. */
  storage?: Storage;
  /**
   * Where installed plugins live. Default: IndexedDB database `gjs-plugin-manager`.
   * `null` turns installing off (no Install tab, nothing is loaded).
   */
  repository?: PluginRepository | null;
  /** Load and run installed plugins on start. Default `true`. */
  loadInstalled?: boolean;
  /**
   * When the manager stands in `config.plugins` BEFORE other plugins,
   * disabled ones after it are replaced with no-ops before GrapesJS runs them.
   * Default `true`. `filterPlugins()` / `loadPlugins()` are the reliable way.
   */
  disableInPlace?: boolean;
  /** Panel for the toolbar button. Default `options`; another panel with toolbar buttons is found automatically. */
  panel?: string;
  /** Toolbar button id. Default `plugin-manager`. `false` — no button at all. */
  buttonId?: string | false;
  /** Show a floating round button when no toolbar rendered ours. Default `true`. */
  floatingButton?: boolean;
  /** Which localStorage keys the Settings tab shows. Default: all except the manager's own. */
  settingsFilter?: (key: string) => boolean;
  /** Hide the Settings tab. Default `true` (shown). */
  settingsTab?: boolean;
  /** Archive size limit, uncompressed, bytes. Default 10 MB. */
  maxArchiveSize?: number;
  /** Names for function plugins that cannot be identified otherwise (see README). */
  resolveId?: (plugin: PluginRef, index: number) => string | undefined | null;
  /** Override texts (wins over `editor.I18n`). */
  labels?: Partial<PluginsManagerLabels>;
  /** Inject the default CSS. Default `true`. */
  injectCss?: boolean;
  /** Confirmation dialog. Default `window.confirm`. */
  confirm?: (message: string) => boolean | Promise<boolean>;
  /** What the "Reload" button does. Default `location.reload()`. */
  reload?: () => void;
}
