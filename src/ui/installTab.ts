import type { PluginsManagerLabels } from '../types';
import type { PluginsManager } from '../core/manager';
import type { Translate } from '../i18n';
import { PluginsManagerError, type PluginsManagerErrorCode, errorMessage } from '../core/errors';
import { h } from './dom';

const ERROR_LABELS: Partial<Record<PluginsManagerErrorCode, keyof PluginsManagerLabels>> = {
  notZip: 'notZip',
  noJs: 'errNoJs',
  noId: 'errNoId',
  conflict: 'errConflict',
  tooLarge: 'errTooLarge',
  notRegistered: 'errNotRegistered',
  script: 'errScript',
};

/** A translated, human message for an install error. */
export function describeError(e: unknown, t: Translate): string {
  if (e instanceof PluginsManagerError) {
    const key = ERROR_LABELS[e.code];
    const base = key ? t(key) : e.message;
    return e.detail ? `${base} (${e.detail})` : base;
  }
  return errorMessage(e);
}

/** "Install" tab: drop zone / file picker for zip archives + a log. */
export class InstallTab {
  readonly el: HTMLElement;
  readonly log = h('div', { class: 'gjs-pm-log', 'aria-live': 'polite' });
  private readonly fileInput: HTMLInputElement;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly manager: PluginsManager,
    private readonly t: Translate
  ) {
    this.fileInput = h('input', { type: 'file', accept: '.zip,application/zip', multiple: true, style: 'display:none' });
    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files) void this.handle(this.fileInput.files);
      this.fileInput.value = '';
    });
    const drop = h(
      'div',
      { class: 'gjs-pm-drop', role: 'button', tabindex: 0 },
      h('div', { style: 'font-size:15px' }, t('dropHere')),
      h('small', null, t('orClick')),
      this.fileInput
    );
    drop.addEventListener('click', (e) => {
      if (e.target !== this.fileInput) this.fileInput.click();
    });
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.fileInput.click();
      }
    });
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      if (e.dataTransfer?.files) void this.handle(e.dataTransfer.files);
    });
    this.el = h('div', { class: 'gjs-pm-pane', role: 'tabpanel' }, drop, this.log, h('div', { class: 'gjs-pm-hint' }, t('dropHint')));
  }

  private say(ok: boolean, text: string): void {
    this.log.appendChild(h('div', { class: ok ? 'ok' : 'fail' }, `${ok ? '✓' : '✕'} ${text}`));
  }

  /** Installs files one after another (also across several drops). */
  handle(files: FileList | File[]): Promise<void> {
    const list = Array.from(files);
    this.queue = this.queue.then(async () => {
      for (const file of list) await this.installOne(file);
    });
    return this.queue;
  }

  private async installOne(file: File): Promise<void> {
    const t = this.t;
    if (!/\.zip$/i.test(file.name)) {
      this.say(false, `${file.name}: ${t('notZip')}`);
      return;
    }
    try {
      const info = await this.manager.install(file, file.name);
      if (info.error) this.say(false, `${info.name}: ${info.error}`);
      else this.say(true, `${t('installOk')}: ${info.name}${info.version ? ` ${info.version}` : ''}`);
    } catch (e) {
      this.say(false, `${t('installErr')} (${file.name}): ${describeError(e, t)}`);
    }
  }
}
