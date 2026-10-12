import type { Editor } from 'grapesjs';
import type { PluginsManagerLabels } from '../types';

import ar from './locales/ar';
import bs from './locales/bs';
import ca from './locales/ca';
import de from './locales/de';
import el from './locales/el';
import en from './locales/en';
import es from './locales/es';
import fa from './locales/fa';
import fr from './locales/fr';
import he from './locales/he';
import id from './locales/id';
import it from './locales/it';
import ko from './locales/ko';
import nb from './locales/nb';
import nl from './locales/nl';
import pl from './locales/pl';
import pt from './locales/pt';
import ru from './locales/ru';
import se from './locales/se';
import tr from './locales/tr';
import uk from './locales/uk';
import vi from './locales/vi';
import zh from './locales/zh';

/** i18n namespace inside `editor.I18n`: keys are `pluginsManager.<label>`. */
export const I18N_NS = 'pluginsManager';

/**
 * The same language codes as `grapesjs/locale` (ar, bs, ca, de, el, en, es,
 * fa, fr, he, id, it, ko, nb, nl, pl, pt, ru, se, tr, vi, zh) plus `uk`.
 * `se` is Swedish (the core's historical code).
 */
export const locales: Record<string, PluginsManagerLabels> = {
  ar,
  bs,
  ca,
  de,
  el,
  en,
  es,
  fa,
  fr,
  he,
  id,
  it,
  ko,
  nb,
  nl,
  pl,
  pt,
  ru,
  se,
  tr,
  uk,
  vi,
  zh,
};

export const SUPPORTED_LOCALES: readonly string[] = Object.keys(locales);

/** Locales written right-to-left (the modal gets `dir="rtl"`). */
const RTL = ['ar', 'he', 'fa'];

/**
 * Registers every built-in locale in `editor.I18n` under `pluginsManager`.
 * `addMessages()` (merge), so messages of the site and other plugins stay.
 * To override a phrase call `editor.I18n.addMessages()` after the plugin is
 * loaded, or use the `labels` option.
 */
export function registerMessages(editor: Editor): void {
  const i18n = editor.I18n;
  if (!i18n || typeof i18n.addMessages !== 'function') return;
  const messages: Record<string, Record<string, PluginsManagerLabels>> = {};
  SUPPORTED_LOCALES.forEach((lang) => {
    messages[lang] = { [I18N_NS]: { ...locales[lang] } };
  });
  i18n.addMessages(messages);
}

export type Translate = (key: keyof PluginsManagerLabels, params?: Record<string, string | number>) => string;

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/**
 * Label lookup order: `labels` option → `editor.I18n` (current locale,
 * then the fallback locale) → built-in English. `{name}` placeholders are
 * filled from `params` (GrapesJS' own interpolation is not relied upon).
 */
export function createTranslator(editor: Editor, overrides: Partial<PluginsManagerLabels>): Translate {
  return (key, params) => {
    const own = overrides[key];
    if (typeof own === 'string' && own) return interpolate(own, params);
    let msg: unknown;
    try {
      // GrapesJS fills `{name}` itself (and blanks placeholders without params).
      msg = editor.I18n?.t(`${I18N_NS}.${key}`, params ? ({ params } as never) : undefined);
    } catch {
      msg = undefined;
    }
    return interpolate(typeof msg === 'string' && msg ? msg : en[key], params);
  };
}

export function isRtl(editor: Editor): boolean {
  let locale = '';
  try {
    locale = String(editor.I18n?.getLocale() || '');
  } catch {
    /* ignore */
  }
  return RTL.includes(locale.split('-')[0]);
}
