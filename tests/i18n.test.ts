import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_CATALOG } from '../src/core/fonts';
import { FORMATS, SIZES } from '../src/export/formats';
import { DICTIONARIES, optionKey, paramKey } from '../src/i18n';
import { MOTION_PRESETS } from '../src/params/animation';
import { animDefs, CLOCK_PARAMS } from '../src/params/motionControls';
import { ALL_PARAMS, type ParamDef, type RangeParam } from '../src/params/schema';
import { HARAKAT } from '../src/ui/keyboard';

const root = new URL('..', import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Every translation key the interface uses, with its English text when known. */
export function interfaceKeys(): Map<string, string> {
  const keys = new Map<string, string>();

  // Fixed texts of the page.
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-title|-aria-label)?="([^"]+)"/g)) keys.set(m[1], '');

  // t('key', 'English') calls in the code.
  for (const file of sourceFiles(join(root, 'src'))) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/\bt\(\s*'([^']+)',\s*'((?:[^'\\]|\\.)*)'/g)) keys.set(m[1], m[2]);
  }

  // Keys built from data.
  const params = (defs: readonly ParamDef[]) => {
    for (const def of defs) {
      keys.set(paramKey(def), def.label);
      if (def.hint) keys.set(`${paramKey(def)}.hint`, def.hint);
      if (def.kind === 'choice') for (const o of def.options) keys.set(optionKey(def, o.value), o.label);
    }
  };
  params(ALL_PARAMS);
  params(CLOCK_PARAMS);
  params(animDefs(ALL_PARAMS.find((d) => d.key === 'lift') as RangeParam));
  for (const f of FORMATS) {
    keys.set(`format.${f.id}`, f.label);
    keys.set(`format.${f.id}.note`, f.note);
  }
  for (const s of SIZES) keys.set(`size.${s.id}`, s.label);
  for (const [id, p] of Object.entries(MOTION_PRESETS)) keys.set(`preset.${id}`, p.label);
  for (const f of FONT_CATALOG) keys.set(`style.${f.style}`, f.style);
  for (const [, key, name] of HARAKAT) keys.set(key, name);
  return keys;
}

describe('interface translations', () => {
  const keys = interfaceKeys();

  it('finds the interface texts', () => {
    expect(keys.size).toBeGreaterThan(150);
  });

  it.each(Object.keys(DICTIONARIES))('%s has every text of the interface', (lang) => {
    const dictionary = DICTIONARIES[lang as keyof typeof DICTIONARIES];
    const missing = [...keys.keys()].filter((k) => !dictionary[k]);
    expect(missing, `missing in ${lang}`).toEqual([]);
  });

  it.each(Object.keys(DICTIONARIES))('%s has no leftover texts (typos or removed features)', (lang) => {
    const dictionary = DICTIONARIES[lang as keyof typeof DICTIONARIES];
    const unknown = Object.keys(dictionary).filter((k) => !keys.has(k));
    expect(unknown, `unknown in ${lang}`).toEqual([]);
  });

  it.each(Object.keys(DICTIONARIES))('%s keeps every {placeholder}', (lang) => {
    const dictionary = DICTIONARIES[lang as keyof typeof DICTIONARIES];
    for (const [key, english] of keys) {
      if (!english || !dictionary[key]) continue;
      const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(names(dictionary[key]), `${lang}: ${key}`).toEqual(names(english));
    }
  });
});
