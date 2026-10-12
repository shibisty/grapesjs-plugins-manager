import type { PluginFn, PluginRecord } from '../types';
import { PluginsManagerError, errorMessage } from '../core/errors';
import { type PluginRegistry, unwrap } from '../core/builtin';

/**
 * Executes plugin code. Replaceable (tests, CSP without `blob:`), see
 * `setCodeRunner()`.
 */
export interface CodeRunner {
  /** Runs a classic script in the page's global scope. Rejects on a thrown error. */
  script(code: string, id: string): Promise<void>;
  /** Imports an ES module and resolves with its namespace. */
  module(code: string, id: string): Promise<Record<string, unknown>>;
}

type WindowWithDefine = Window & { define?: unknown };

/**
 * Default runner: a `blob:` URL in a `<script>` tag (keeps stack traces and
 * devtools sources readable, unlike eval) or in `import()`.
 *
 * `script.onerror` fires only for network errors; an exception thrown by the
 * bundle itself is reported as a window `error` event whose `filename` is
 * the script URL — that is caught here.
 *
 * An AMD loader on the page (RequireJS, Monaco's loader) makes UMD bundles
 * call `define()` instead of setting a global — the plugin would vanish.
 * `window.define` is hidden while the bundle runs.
 */
export const blobRunner: CodeRunner = {
  script(code, id) {
    return new Promise<void>((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([code, `\n//# sourceURL=grapesjs-plugin:${id}.js`], { type: 'text/javascript' }));
      const w = window as WindowWithDefine;
      const hadDefine = Object.prototype.hasOwnProperty.call(w, 'define');
      const savedDefine = w.define;
      let thrown: unknown = null;
      const onError = (ev: ErrorEvent): void => {
        if (ev.filename === url || (ev.filename || '').startsWith(`grapesjs-plugin:${id}`)) {
          thrown = ev.error || ev.message;
          ev.preventDefault();
        }
      };
      const cleanup = (): void => {
        window.removeEventListener('error', onError);
        if (hadDefine) w.define = savedDefine;
        s.remove();
        URL.revokeObjectURL(url);
      };
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => {
        cleanup();
        if (thrown) reject(new PluginsManagerError('script', 'Plugin script failed', errorMessage(thrown)));
        else resolve();
      };
      s.onerror = () => {
        cleanup();
        reject(new PluginsManagerError('script', 'Plugin script could not be loaded (Content-Security-Policy blocks blob: URLs?)'));
      };
      window.addEventListener('error', onError);
      if (hadDefine && savedDefine && (savedDefine as { amd?: unknown }).amd) {
        try {
          w.define = undefined;
        } catch {
          /* non-writable: nothing to do */
        }
      }
      document.head.appendChild(s);
    });
  },
  async module(code, id) {
    const url = URL.createObjectURL(new Blob([code, `\n//# sourceURL=grapesjs-plugin:${id}.mjs`], { type: 'text/javascript' }));
    try {
      return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
    } catch (e) {
      throw new PluginsManagerError('script', 'Plugin module failed', errorMessage(e));
    } finally {
      URL.revokeObjectURL(url);
    }
  },
};

let runner: CodeRunner = blobRunner;

/** Replaces the code runner (returns the previous one). */
export function setCodeRunner(next: CodeRunner): CodeRunner {
  const prev = runner;
  runner = next;
  return prev;
}

/** Registry ids each installed plugin registered last time it was evaluated. */
const registeredBy = new Map<string, string[]>();

/**
 * `grapesjs.plugins.add()` never overwrites an id ("plugins could not be
 * overwritten"): reinstalling a new version in the same session would hand
 * back the OLD function. Ids the previous version registered are dropped
 * from the registry before the new code runs.
 */
function forgetRegistrations(rec: PluginRecord, registry: PluginRegistry | null): void {
  const all = registry?.getAll() as Record<string, unknown> | undefined;
  if (!all) return;
  new Set([rec.id, ...(registeredBy.get(rec.id) || [])]).forEach((k) => delete all[k]);
}

function snapshotRegistry(registry: PluginRegistry | null): Map<string, PluginFn> {
  return new Map(Object.entries(registry?.getAll() || {}));
}

function snapshotWindow(): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (typeof window === 'undefined') return out;
  Object.getOwnPropertyNames(window).forEach((k) => {
    try {
      out.set(k, (window as unknown as Record<string, unknown>)[k]);
    } catch {
      /* cross-origin / throwing getters */
    }
  });
  return out;
}

/**
 * Runs an installed plugin's code and returns its plugin function.
 *
 * For classic scripts the function is looked up in this order:
 *   1. `grapesjs.plugins` under the record id (new or re-registered);
 *   2. the `global` named in the manifest;
 *   3. any other entry the script added/replaced in `grapesjs.plugins`;
 *   4. any window global the script added/replaced that is a function or
 *      `{ default: function }` (Vite/Rollup UMD with named exports).
 * For ES modules: `default` export, else the single exported function.
 */
export async function evaluatePlugin(rec: PluginRecord, registry: PluginRegistry | null): Promise<PluginFn> {
  if (rec.format === 'module') {
    const ns = await runner.module(rec.code, rec.id);
    const fn = unwrap(ns) || unwrap(ns.default);
    if (fn) return fn;
    const fns = Object.values(ns).filter((v): v is PluginFn => typeof v === 'function');
    if (fns.length === 1) return fns[0];
    throw new PluginsManagerError('notRegistered', 'The module has no default export function');
  }

  forgetRegistrations(rec, registry);
  const regBefore = snapshotRegistry(registry);
  const winBefore = snapshotWindow();
  await runner.script(rec.code, rec.id);

  const regAfter = snapshotRegistry(registry);
  const changedReg = Array.from(regAfter.entries()).filter(([k, v]) => regBefore.get(k) !== v);
  if (changedReg.length) registeredBy.set(rec.id, changedReg.map(([k]) => k));
  const own = changedReg.find(([k]) => k === rec.id);
  if (own) return own[1];

  if (rec.global) {
    const g = unwrap((window as unknown as Record<string, unknown>)[rec.global]);
    if (g) return g;
  }
  if (changedReg.length) return changedReg[0][1];

  const winAfter = snapshotWindow();
  for (const [k, v] of winAfter) {
    if (winBefore.get(k) === v) continue;
    const fn = unwrap(v);
    if (fn) return fn;
  }
  // Already registered by an earlier run of the same code (bundle guarded by
  // `if (!grapesjs.plugins.get(id))`).
  const existing = registry?.get(rec.id);
  if (existing) return existing;

  throw new PluginsManagerError(
    'notRegistered',
    'The plugin did not register: call grapesjs.plugins.add(id, fn), expose a global or set "global" in manifest.json'
  );
}
