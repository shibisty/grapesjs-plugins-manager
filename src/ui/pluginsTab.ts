import type { PluginInfo } from '../types';
import type { PluginsManager } from '../core/manager';
import type { Translate } from '../i18n';
import { clear, h } from './dom';

export function switchEl(checked: boolean, label: string, onChange: (on: boolean) => void): HTMLLabelElement {
  const input = h('input', { type: 'checkbox', checked, 'aria-label': label });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'gjs-pm-switch' }, input, h('span'));
}

/** "Plugins" tab: built-in + installed plugins with on/off switches. */
export class PluginsTab {
  readonly el = h('div', { class: 'gjs-pm-pane', role: 'tabpanel' });

  constructor(
    private readonly manager: PluginsManager,
    private readonly t: Translate,
    private readonly confirm: (message: string) => boolean | Promise<boolean>
  ) {
    this.render();
  }

  render(): void {
    clear(this.el);
    const rows = this.manager.list().map((p) => (p.kind === 'builtin' ? this.builtinRow(p) : this.installedRow(p)));
    if (!rows.length) rows.push(h('div', { class: 'gjs-pm-hint' }, this.t('empty')));
    rows.forEach((r) => this.el.appendChild(r));
  }

  private builtinRow(p: PluginInfo): HTMLElement {
    const t = this.t;
    // Disabled, but it already ran and the manager cannot stop it next time either.
    const uncontrolled = p.present && !p.controllable && !p.enabled && p.running;
    return h(
      'div',
      { class: 'gjs-pm-row', 'data-id': p.id, 'data-kind': 'builtin' },
      h(
        'div',
        { class: 'gjs-pm-info' },
        h(
          'div',
          { class: 'gjs-pm-name' },
          p.id,
          h('span', { class: 'gjs-pm-badge' }, t('builtin')),
          !p.present && h('span', { class: 'gjs-pm-badge warn' }, t('missing')),
          uncontrolled && h('span', { class: 'gjs-pm-badge warn' }, t('uncontrolled'))
        ),
        uncontrolled && h('div', { class: 'gjs-pm-warn' }, t('uncontrolledHint'))
      ),
      !p.present &&
        h('button', { class: 'gjs-pm-btn', 'data-action': 'forget', title: t('forget'), onClick: () => this.manager.forget(p.id) }, t('forget')),
      switchEl(p.enabled, p.id, (on) => void this.manager.setEnabled(p.id, on))
    );
  }

  private installedRow(p: PluginInfo): HTMLElement {
    const t = this.t;
    return h(
      'div',
      { class: 'gjs-pm-row', 'data-id': p.id, 'data-kind': 'installed' },
      h(
        'div',
        { class: 'gjs-pm-info' },
        h(
          'div',
          { class: 'gjs-pm-name' },
          p.name,
          p.version ? ` ${p.version}` : '',
          p.error ? h('span', { class: 'gjs-pm-badge err' }, t('error')) : h('span', { class: 'gjs-pm-badge' }, t('installed'))
        ),
        p.description && h('div', { class: 'gjs-pm-desc' }, p.description),
        p.error && h('div', { class: 'gjs-pm-err' }, p.error)
      ),
      h(
        'button',
        {
          class: 'gjs-pm-btn',
          'data-action': 'remove',
          title: t('remove'),
          'aria-label': `${t('remove')}: ${p.name}`,
          onClick: async () => {
            if (await this.confirm(t('confirmRemove', { name: p.name }))) await this.manager.remove(p.id);
          },
        },
        '✕'
      ),
      switchEl(p.enabled, p.name, (on) => void this.manager.setEnabled(p.id, on))
    );
  }
}
