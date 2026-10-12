import { strToU8, zipSync } from 'fflate';

/** Builds a zip archive from { path: text }. */
export function makeZip(files: Record<string, string>): Uint8Array {
  const data: Record<string, Uint8Array> = {};
  // new Uint8Array(): jsdom's Uint8Array differs from the one Node's TextEncoder returns.
  Object.entries(files).forEach(([k, v]) => (data[k] = new Uint8Array(strToU8(v))));
  return zipSync(data);
}

export function zipFile(name: string, files: Record<string, string>): File {
  return new File([makeZip(files)], name, { type: 'application/zip' });
}

/** A UMD-like bundle that registers itself in grapesjs.plugins. */
export function registeringBundle(id: string, marker = id): string {
  return `(function(){ window.grapesjs.plugins.add(${JSON.stringify(id)}, function(editor, opts){
    (window.__ran = window.__ran || []).push({ id: ${JSON.stringify(marker)}, opts: opts, loaded: !!editor.getModel().get('ready') });
    editor.on('load', function(){ (window.__loadSeen = window.__loadSeen || []).push(${JSON.stringify(marker)}); });
  }); })();`;
}

/** A bundle exposing a global `{ default: fn }` (Vite UMD with named exports). */
export function globalBundle(globalName: string, marker = globalName): string {
  return `(function(g){ g[${JSON.stringify(globalName)}] = { default: function(editor, opts){
    (window.__ran = window.__ran || []).push({ id: ${JSON.stringify(marker)}, opts: opts });
  } }; })(window);`;
}

export function ran(): { id: string; opts: unknown; loaded?: boolean }[] {
  return ((window as unknown as { __ran?: [] }).__ran || []) as { id: string; opts: unknown; loaded?: boolean }[];
}

export function resetRan(): void {
  const w = window as unknown as Record<string, unknown>;
  delete w.__ran;
  delete w.__loadSeen;
}
