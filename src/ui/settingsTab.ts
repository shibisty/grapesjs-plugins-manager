import type { PluginsManager } from '../core/manager';
import type { Translate } from '../i18n';
import { clear, h } from './dom';

/** Values longer than this are collapsed (a saved project can be megabytes). */
export const LARGE_VALUE = 10_000;

/**
 * "Settings" tab: a key=value editor for localStorage. The manager's own
 * keys are hidden; installed plugins with a `storagePrefix` get a chip that
 * narrows the list to their keys.
 */
export class SettingsTab {
  readonly el: HTMLElement;
  private readonly filterInput: HTMLInputElement;
  private readonly chips = h('div', { class: 'gjs-pm-chips' });
  private readonly list = h('div');
  private prefix = '';

  constructor(
    private readonly manager: PluginsManager,
    private readonly t: Translate,
    private readonly confirm: (message: string) => boolean | Promise<boolean>
  ) {
    this.filterInput = h('input', { class: 'gjs-pm-input', placeholder: t('filter'), 'aria-label': t('filter') });
    this.filterInput.addEventListener('input', () => this.renderList());

    const newKey = h('input', { class: 'gjs-pm-input', placeholder: t('key'), 'aria-label': t('key') });
    const newVal = h('textarea', { class: 'gjs-pm-input', placeholder: t('value'), 'aria-label': t('value'), rows: 1 });
    const addBtn = h('button', { class: 'gjs-pm-btn', 'data-action': 'add' }, t('add'));
    addBtn.addEventListener('click', () => {
      const k = newKey.value.trim();
      if (!k) return;
      this.write(k, newVal.value);
      newKey.value = '';
      newVal.value = '';
      this.renderList();
    });

    this.el = h(
      'div',
      { class: 'gjs-pm-pane', role: 'tabpanel' },
      h('div', { class: 'gjs-pm-add' }, h('div', { class: 'gjs-pm-kv' }, newKey, newVal, addBtn)),
      this.chips,
      h('div', { style: 'margin-bottom:8px' }, this.filterInput),
      this.list
    );
  }

  private get storage(): Storage | null {
    return this.manager.options.storage;
  }

  private write(key: string, value: string): boolean {
    try {
      this.storage?.setItem(key, value);
      return true;
    } catch (e) {
      console.error('[plugins-manager] localStorage.setItem failed', e);
      return false;
    }
  }

  /** Keys shown on the tab (sorted). */
  keys(): string[] {
    const s = this.storage;
    if (!s) return [];
    const out: string[] = [];
    try {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k == null || this.manager.state.isOwnKey(k)) continue;
        if (this.manager.options.settingsFilter(k)) out.push(k);
      }
    } catch {
      return [];
    }
    return out.sort();
  }

  render(): void {
    this.renderChips();
    this.renderList();
  }

  private renderChips(): void {
    clear(this.chips);
    const groups = this.manager.storagePrefixes();
    if (!groups.length) return;
    const chip = (label: string, prefix: string): HTMLButtonElement => {
      const b = h('button', { class: 'gjs-pm-chip', 'aria-pressed': String(this.prefix === prefix), 'data-prefix': prefix }, label);
      b.addEventListener('click', () => {
        this.prefix = prefix;
        this.render();
      });
      return b;
    };
    this.chips.appendChild(chip(this.t('allKeys'), ''));
    groups.forEach((g) => this.chips.appendChild(chip(g.name, g.prefix)));
  }

  renderList(): void {
    clear(this.list);
    const q = this.filterInput.value.trim().toLowerCase();
    const keys = this.keys().filter((k) => (!this.prefix || k.startsWith(this.prefix)) && (!q || k.toLowerCase().includes(q)));
    if (!keys.length) {
      this.list.appendChild(h('div', { class: 'gjs-pm-hint' }, this.t('noKeys')));
      return;
    }
    keys.forEach((k) => this.list.appendChild(this.row(k)));
  }

  private row(k: string): HTMLElement {
    const t = this.t;
    let value = '';
    try {
      value = this.storage?.getItem(k) ?? '';
    } catch {
      /* ignore */
    }
    const large = value.length > LARGE_VALUE;
    const val = h('textarea', { class: 'gjs-pm-input', rows: 1, 'aria-label': k });
    let loaded = !large;
    if (large) {
      // Do not push megabytes into the DOM until asked.
      val.readOnly = true;
      val.value = t('largeValue', { size: Math.ceil(value.length / 1024) });
    } else {
      val.value = value;
    }

    const row = h('div', { class: 'gjs-pm-kv', 'data-key': k });
    const save = h('button', { class: 'gjs-pm-btn', 'data-action': 'save', title: t('save'), 'aria-label': `${t('save')}: ${k}` }, '✓');
    save.addEventListener('click', () => {
      if (!loaded) return;
      if (this.write(k, val.value)) {
        row.classList.add('saved');
        setTimeout(() => row.classList.remove('saved'), 900);
      }
    });
    const del = h('button', { class: 'gjs-pm-btn', 'data-action': 'delete', title: t('del'), 'aria-label': `${t('del')}: ${k}` }, '✕');
    del.addEventListener('click', async () => {
      if (!(await this.confirm(t('confirmDel', { key: k })))) return;
      try {
        this.storage?.removeItem(k);
      } catch {
        /* ignore */
      }
      this.renderList();
    });
    const acts = h('div', { class: 'acts' }, save, del);
    if (large) {
      const show = h('button', { class: 'gjs-pm-btn', 'data-action': 'show' }, t('showValue'));
      show.addEventListener('click', () => {
        val.value = value;
        val.readOnly = false;
        loaded = true;
        show.remove();
      });
      acts.insertBefore(show, save);
    }
    row.append(h('div', { class: 'k' }, k), val, acts);
    return row;
  }
}
