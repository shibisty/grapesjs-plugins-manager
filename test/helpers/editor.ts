import grapesjs, { type Editor } from 'grapesjs';
import pluginsManager, { getPluginsManager, type PluginsManagerApi } from '../../src/index';
import type { PluginRef, PluginsManagerOptions } from '../../src/types';
import { MemoryRepository } from '../../src/storage/repository';

(window as unknown as { grapesjs: typeof grapesjs }).grapesjs = grapesjs;

export interface Setup {
  editor: Editor;
  api: PluginsManagerApi;
  repo: MemoryRepository;
}

export interface CreateOpts {
  options?: PluginsManagerOptions;
  /** Full plugins array; `'self'` is replaced by the manager. Default: [manager]. */
  plugins?: (PluginRef | 'self')[];
  pluginsOpts?: Record<string, unknown>;
  panels?: boolean;
  repo?: MemoryRepository;
}

/** A real grapesjs editor in jsdom with the manager loaded. */
export async function createEditor(c: CreateOpts = {}): Promise<Setup> {
  const container = document.createElement('div');
  container.id = 'gjs';
  document.body.append(container);
  const repo = c.repo || new MemoryRepository();
  const options: PluginsManagerOptions = { repository: repo, confirm: () => true, reload: () => undefined, ...c.options };
  // Keep the very array (filterPlugins/loadPlugins attach metadata to it).
  const plugins = c.plugins && !c.plugins.includes('self') ? c.plugins : (c.plugins || ['self']).map((p) => (p === 'self' ? pluginsManager : p));
  const pluginsOpts: Record<string, unknown> = { ...c.pluginsOpts };
  pluginsOpts[pluginsManager as unknown as string] = options;

  const editor = grapesjs.init({
    container,
    height: '600px',
    storageManager: false,
    telemetry: false,
    ...(c.panels === false ? { panels: { defaults: [] } } : {}),
    components: '<div id="box">Hello</div>',
    plugins,
    pluginsOpts,
  } as Parameters<typeof grapesjs.init>[0]);

  await new Promise<void>((resolve) => editor.onReady(() => resolve()));
  const api = getPluginsManager(editor)!;
  await api.ready;
  return { editor, api, repo };
}

export async function destroyEditor(editor: Editor | undefined): Promise<void> {
  if (!editor) return;
  await new Promise((r) => setTimeout(r, 10));
  try {
    getPluginsManager(editor)?.destroy();
    editor.destroy();
  } catch {
    /* teardown noise from jsdom */
  }
  document.body.innerHTML = '';
}

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
