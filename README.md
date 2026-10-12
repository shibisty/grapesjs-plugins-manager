# grapesjs-plugins-manager

Plugin manager for [GrapesJS](https://grapesjs.com): a toolbar button opens a modal where users

- **switch plugins on/off** — both the ones from `config.plugins` and installed ones (state in `localStorage`);
- **install plugins from a zip archive** (drag & drop or file picker) — the code is kept in IndexedDB and loaded on every start;
- **edit plugin settings** kept in `localStorage` (key = value editor, grouped by plugin).

23 UI languages (the `grapesjs/locale` set + Ukrainian), RTL for ar/he/fa. No runtime dependencies (the zip reader is bundled).

## Install

```sh
npm i grapesjs-plugins-manager
```

## Usage

The recommended setup loads everything **before** `grapesjs.init`, so disabled plugins never run and installed ones run during init like any other plugin:

```js
import grapesjs from 'grapesjs';
import pluginsManager, { loadPlugins } from 'grapesjs-plugins-manager';
import presetWebpage from 'grapesjs-preset-webpage';
import blocksBasic from 'grapesjs-blocks-basic';

const plugins = await loadPlugins([pluginsManager, presetWebpage, blocksBasic]);

grapesjs.init({
  container: '#gjs',
  plugins,
  pluginsOpts: {
    [pluginsManager]: { /* options, see below */ },
    'my-installed-plugin': { /* options of an installed plugin, by its id */ },
  },
});
```

Without a bundler (UMD build, global `grapesjsPluginsManager`):

```html
<script src="https://unpkg.com/grapesjs"></script>
<script src="https://unpkg.com/grapesjs-plugins-manager"></script>
<script>
  (async () => {
    const PM = grapesjsPluginsManager;
    const plugins = await PM.loadPlugins([PM.default, 'gjs-preset-webpage']);
    grapesjs.init({ container: '#gjs', plugins });
  })();
</script>
```

### Disabling built-in plugins

A plugin that already ran cannot be "un-run", so switching a plugin off takes effect after a reload. How the manager makes sure it does not run next time:

| Setup | Works? |
| --- | --- |
| `loadPlugins([...])` or `filterPlugins([...])` before init | ✅ always — disabled plugins are removed from the array |
| manager listed **first** in `plugins`, no bootstrap | ✅ plugins after it are replaced with no-ops (`disableInPlace`) |
| manager listed **after** the plugin | ❌ the plugin already ran; it is marked *cannot be disabled* in the list |

`filterPlugins` is synchronous, if you do not need installed plugins at init time:

```js
grapesjs.init({ plugins: filterPlugins([pluginsManager, a, b]) });
```

Keep the array returned by `loadPlugins`/`filterPlugins` as is (do not `.map()` it): it carries metadata the manager reads.

#### Plugin ids

String plugins are their own ids. For functions the manager looks up, in order: the `resolveId` option, the id in `grapesjs.plugins`, the window global holding it (`grapesjsContextMenu` for UMD bundles), a meaningful `function.name`, and finally `plugin-<index>` — which changes when the array is reordered. Give anonymous plugins a name with `resolveId`:

```js
pluginsOpts: { [pluginsManager]: { resolveId: (p) => (p === myPlugin ? 'my-plugin' : undefined) } }
```

### Installable plugin archive

A zip with a JS bundle and, optionally, a manifest:

```json
// manifest.json
{
  "id": "my-plugin",
  "name": "My plugin",
  "version": "1.0.0",
  "description": "What it does",
  "main": "dist/index.umd.js",
  "global": "myPlugin",
  "storagePrefix": "my-plugin:",
  "format": "script"
}
```

- Instead of `manifest.json` an npm `package.json` works (an `npm pack` tarball repacked as zip): `unpkg` → `jsdelivr` → `browser` → `main` → `module` is tried; a `"grapesjs": { ... }` section overrides any field.
- Without a manifest the id comes from the archive name, the entry is guessed (UMD/IIFE builds first, `index|main|plugin` next, ES modules last).
- `format`: `script` — UMD/IIFE executed as a classic `<script>`; the bundle must call `grapesjs.plugins.add(id, fn)` or expose a global (`global` field; Vite/Rollup UMD `{ default }` works). `module` — an ES module with `export default (editor, opts) => {}`. Detected automatically when omitted (`.mjs`, `.cjs`, `export` statements).
- `storagePrefix` groups the plugin's `localStorage` keys on the Settings tab.
- Limit: 10 MB uncompressed (`maxArchiveSize`).

> ⚠️ An installed plugin is arbitrary JavaScript running with the editor's privileges. Only install archives you trust. With a Content-Security-Policy, `script-src` must allow `blob:` (or replace the runner with `setCodeRunner`).

## Options

| Option | Default | Description |
| --- | --- | --- |
| `storageKey` | `'gjs-plugin-manager'` | Prefix of the manager's localStorage keys (`<key>:disabled`, `<key>:known`) |
| `storage` | `localStorage` | Storage for state and the Settings tab |
| `repository` | IndexedDB `gjs-plugin-manager` | Where installed plugins live (`PluginRepository`); `null` turns installing off |
| `loadInstalled` | `true` | Run installed plugins on start (when not preloaded by `loadPlugins`) |
| `disableInPlace` | `true` | Replace disabled plugins after the manager in `config.plugins` with no-ops |
| `panel` | `'options'` | Toolbar panel; another panel with toolbar buttons is found automatically |
| `buttonId` | `'plugin-manager'` | Button id; `false` — no button (use the command) |
| `floatingButton` | `true` | A round floating button when no toolbar panel exists |
| `settingsTab` | `true` | Show the Settings tab |
| `settingsFilter` | all keys | `(key) => boolean` — which localStorage keys the Settings tab shows |
| `maxArchiveSize` | 10 MB | Uncompressed archive size limit |
| `resolveId` | — | `(plugin, index) => id` for function plugins |
| `labels` | — | Override texts (wins over `editor.I18n`) |
| `injectCss` | `true` | Inject the default styles |
| `confirm` | `window.confirm` | Confirmation dialog, may return a Promise |
| `reload` | `location.reload()` | What the "Reload" button does |

## API

```js
import { getPluginsManager, EVENTS } from 'grapesjs-plugins-manager';

const pm = getPluginsManager(editor);
await pm.ready;                 // installed plugins loaded
pm.open('install');             // or editor.runCommand('open-plugin-manager', { tab: 'install' })
pm.list();                      // PluginInfo[]: id, kind, enabled, running, controllable, present, error…
await pm.manager.setEnabled('gjs-blocks-basic', false);
await pm.manager.install(file); // File | Blob | ArrayBuffer | Uint8Array
await pm.manager.remove('my-plugin');
pm.manager.needsReload;         // true when a reload would change what runs

editor.on(EVENTS.change, (list) => {});   // plugins-manager:change | install | remove | toggle | error | ready
```

`editor.PluginManager` (`open`, `ready`, `list`, `isDisabled`) and `pluginsManager.filter()` from 0.x are kept. Storage keys and the IndexedDB layout are unchanged, so existing state and installed plugins survive the upgrade.

## i18n

Texts are registered in `editor.I18n` under `pluginsManager.*` for ar, bs, ca, de, el, en, es, fa, fr, he, id, it, ko, nb, nl, pl, pt, ru, se (Swedish, the GrapesJS code), tr, uk, vi, zh. The editor locale is used (GrapesJS detects the browser language by default). Override single phrases with `labels` or `editor.I18n.addMessages()` after the plugin loads.

## Development

```sh
npm i
npm run dev        # demo page (index.html)
npm test           # vitest + jsdom, against a real grapesjs editor
npm run typecheck
npm run build      # dist/: ES + UMD + .d.ts
```

## License

MIT
