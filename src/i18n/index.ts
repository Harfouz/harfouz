/**
 * Interface languages.
 *
 * English is written directly in the code, next to where it is used: it is
 * the reference and the fallback. Other languages are dictionaries
 * (fr.ts, ar.ts, ru.ts) from a key to the translated text. A test checks
 * that every key used in the interface exists in every dictionary.
 *
 * Usage: t('export.done', 'Done: {what}.', { what }) — {name} placeholders
 * are filled from the last argument.
 */
import ar from './ar';
import fr from './fr';
import ru from './ru';

export type Lang = 'en' | 'fr' | 'ar' | 'ru';

export const LANGUAGES: { id: Lang; name: string; dir: 'ltr' | 'rtl' }[] = [
  { id: 'en', name: 'English', dir: 'ltr' },
  { id: 'fr', name: 'Français', dir: 'ltr' },
  { id: 'ar', name: 'العربية', dir: 'rtl' },
  { id: 'ru', name: 'Русский', dir: 'ltr' },
];

export const DICTIONARIES: Record<Exclude<Lang, 'en'>, Record<string, string>> = { fr, ar, ru };

let current: Lang = 'en';
const listeners: (() => void)[] = [];

/** The text for `key` in the current language, or the English one. */
export function t(key: string, english: string, vars?: Record<string, string | number>): string {
  const text = current === 'en' ? english : (DICTIONARIES[current][key] ?? english);
  return vars ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? '')) : text;
}

export function getLanguage(): Lang {
  return current;
}

const STORAGE_KEY = 'harfouz.language';

/** The language saved from a previous visit, else English. */
export function savedLanguage(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES.some((l) => l.id === saved)) return saved as Lang;
  } catch {
    // Storage can be unavailable (private browsing…): English it is.
  }
  return 'en';
}

/** Switch language: page direction, saved choice, then everyone redraws their texts. */
export function setLanguage(lang: Lang) {
  current = lang;
  const info = LANGUAGES.find((l) => l.id === lang)!;
  document.documentElement.lang = lang;
  document.documentElement.dir = info.dir;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not saved; it still works for this visit.
  }
  translatePage();
  for (const listener of listeners) listener();
}

export function onLanguageChange(listener: () => void) {
  listeners.push(listener);
}

/**
 * Translate the fixed texts of the page, marked in index.html with
 * data-i18n (text), data-i18n-title and data-i18n-aria-label. The English
 * text written in the page is kept as the fallback.
 */
export function translatePage(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.dataset.en ??= el.textContent ?? '';
    el.textContent = t(el.dataset.i18n!, el.dataset.en);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    el.dataset.enTitle ??= el.title;
    el.title = t(el.dataset.i18nTitle!, el.dataset.enTitle);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
    el.dataset.enAriaLabel ??= el.getAttribute('aria-label') ?? '';
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel!, el.dataset.enAriaLabel));
  }
}

// ── Parameters (sliders and menus built from the schema) ─

interface Labelled {
  key: string;
  label: string;
  hint?: string;
  /** Translation key, when it differs from `param.<key>`. */
  i18n?: string;
}

export const paramKey = (def: Labelled) => def.i18n ?? `param.${def.key}`;
export const paramLabel = (def: Labelled) => t(paramKey(def), def.label);
export const paramHint = (def: Labelled) => (def.hint ? t(`${paramKey(def)}.hint`, def.hint) : '');

/** Option keys follow the parameter's: `option.<param>.<value>`. */
export const optionKey = (def: Labelled, value: string) => `option.${paramKey(def).replace(/^param\./, '')}.${value}`;
export const optionLabel = (def: Labelled, value: string, english: string) => t(optionKey(def, value), english);
