import type { PluginsManager } from '../core/manager';
import { EVENTS } from '../core/manager';
import type { Translate } from '../i18n';
import { h } from './dom';
import { PluginsTab } from './pluginsTab';
import { InstallTab } from './installTab';
import { SettingsTab } from './settingsTab';

export type TabName = 'plugins' | 'install' | 'settings';

/**
 * Content of the manager modal: reload banner + tabs. Re-renders itself on
 * `plugins-manager:change`; `destroy()` unsubscribes (called on modal close).
 */
export class ManagerView {
  readonly el: HTMLElement;
  readonly plugins: PluginsTab;
  readonly install: InstallTab | null;
  readonly settings: SettingsTab | null;
  private readonly banner: HTMLElement;
  private readonly body = h('div');
  private readonly tabs = new Map<TabName, HTMLButtonElement>();
  private current: TabName = 'plugins';
  private readonly onChange = (): void => this.refresh();

  constructor(
    private readonly manager: PluginsManager,
    t: Translate,
    opts: { install: boolean; settings: boolean; rtl: boolean }
  ) {
    const confirm = manager.options.confirm;
    this.plugins = new PluginsTab(manager, t, confirm);
    this.install = opts.install ? new InstallTab(manager, t) : null;
    this.settings = opts.settings ? new SettingsTab(manager, t, confirm) : null;

    const reload = h('button', { class: 'gjs-pm-btn', 'data-action': 'reload' }, t('reload'));
    reload.addEventListener('click', () => manager.reload());
    this.banner = h('div', { class: 'gjs-pm-banner', role: 'status', hidden: true }, h('span', null, t('reloadNote')), reload);

    const order: [TabName, string][] = [['plugins', t('tabPlugins')]];
    if (this.install) order.push(['install', t('tabInstall')]);
    if (this.settings) order.push(['settings', t('tabSettings')]);
    const bar = h('div', { class: 'gjs-pm-tabs', role: 'tablist' });
    order.forEach(([name, label]) => {
      const b = h('button', { class: 'gjs-pm-tab', role: 'tab', 'data-tab': name, 'aria-selected': 'false' }, label);
      b.addEventListener('click', () => this.show(name));
      this.tabs.set(name, b);
      bar.appendChild(b);
    });
    // Tabs are hidden when there is only one.
    if (order.length < 2) bar.style.display = 'none';

    this.el = h('div', { class: 'gjs-pm', dir: opts.rtl ? 'rtl' : null }, this.banner, bar, this.body);
    manager.editor.on(EVENTS.change, this.onChange);
    this.refresh();
    this.show('plugins');
  }

  get activeTab(): TabName {
    return this.current;
  }

  show(name: TabName): void {
    const pane = name === 'install' ? this.install : name === 'settings' ? this.settings : this.plugins;
    if (!pane) return;
    this.current = name;
    this.tabs.forEach((b, n) => b.setAttribute('aria-selected', String(n === name)));
    this.body.replaceChildren(pane.el);
    if (name === 'settings') this.settings?.render();
  }

  refresh(): void {
    this.plugins.render();
    this.banner.hidden = !this.manager.needsReload;
  }

  destroy(): void {
    this.manager.editor.off(EVENTS.change, this.onChange);
  }
}
