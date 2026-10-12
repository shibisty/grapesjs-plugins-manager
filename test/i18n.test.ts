import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from 'grapesjs';
import { I18N_NS, SUPPORTED_LOCALES, createTranslator, locales } from '../src/i18n';
import { createEditor, destroyEditor } from './helpers/editor';

let editor: Editor | undefined;
afterEach(async () => {
  await destroyEditor(editor);
  editor = undefined;
});

const en = locales.en;
const KEYS = Object.keys(en).sort();

describe('locales', () => {
  it('= grapesjs/locale codes + uk', () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual(
      ['ar', 'bs', 'ca', 'de', 'el', 'en', 'es', 'fa', 'fr', 'he', 'id', 'it', 'ko', 'nb', 'nl', 'pl', 'pt', 'ru', 'se', 'tr', 'uk', 'vi', 'zh'].sort()
    );
  });

  it.each(SUPPORTED_LOCALES.filter((l) => l !== 'en'))('%s has the same keys and placeholders as en', (lang) => {
    const m = locales[lang] as unknown as Record<string, string>;
    expect(Object.keys(m).sort()).toEqual(KEYS);
    KEYS.forEach((k) => {
      const v = m[k];
      expect(typeof v === 'string' && v.length > 0, `${lang}.${k}`).toBe(true);
      expect(v.trim(), `${lang}.${k} whitespace`).toBe(v);
      expect(v.includes('\n'), `${lang}.${k} newline`).toBe(false);
      const ph = (s: string): string[] => (s.match(/\{\w+\}/g) || []).sort();
      expect(ph(v), `${lang}.${k} placeholders`).toEqual(ph((en as unknown as Record<string, string>)[k]));
    });
    // Translated, not a copy of English (short UI words may coincide: "Plugins").
    const same = KEYS.filter((k) => m[k] === (en as unknown as Record<string, string>)[k] && m[k].length > 12);
    expect(same, lang).toEqual([]);
  });

  it('code identifiers stay untranslated in hints', () => {
    SUPPORTED_LOCALES.forEach((lang) => {
      const m = locales[lang];
      expect(m.uncontrolledHint, lang).toContain('filterPlugins()');
      expect(m.errNotRegistered, lang).toContain('grapesjs.plugins.add(id, fn)');
      expect(m.dropHint, lang).toContain('manifest.json');
    });
  });
});

describe('in the editor', () => {
  it('registers all locales in editor.I18n and follows the locale', async () => {
    const s = await createEditor();
    editor = s.editor;
    SUPPORTED_LOCALES.forEach((lang) => {
      expect(s.editor.I18n.t(`${I18N_NS}.title`, { l: lang } as never)).toBe(locales[lang].title);
    });
    s.editor.I18n.setLocale('ru');
    s.api.open();
    expect(s.editor.Modal.getTitle()).toContain('Менеджер плагинов');
    expect(document.querySelector('.gjs-pm-tab')!.textContent).toBe('Плагины');
  });

  it('RTL locales set dir="rtl"', async () => {
    const s = await createEditor();
    editor = s.editor;
    s.editor.I18n.setLocale('ar');
    s.api.open();
    expect(document.querySelector('.gjs-pm')!.getAttribute('dir')).toBe('rtl');
    s.editor.I18n.setLocale('de');
    s.api.open();
    expect(document.querySelector('.gjs-pm')!.getAttribute('dir')).toBeNull();
  });

  it('labels option wins; empty strings are ignored; interpolation works', async () => {
    const s = await createEditor({ options: { labels: { title: 'PM', tabPlugins: '', confirmRemove: 'Kill {name}? {unknown}' } } });
    editor = s.editor;
    const t = createTranslator(s.editor, { title: 'PM', confirmRemove: 'Kill {name}? {unknown}' });
    expect(t('title')).toBe('PM');
    expect(t('confirmRemove', { name: 'X' })).toBe('Kill X? {unknown}');
    s.api.open();
    expect(document.querySelector('.gjs-pm-tab')!.textContent).toBe('Plugins');
  });

  it('unknown locale falls back to English', async () => {
    const s = await createEditor();
    editor = s.editor;
    s.editor.I18n.setLocale('xx');
    const t = createTranslator(s.editor, {});
    expect(t('reload')).toBe('Reload');
  });
});
