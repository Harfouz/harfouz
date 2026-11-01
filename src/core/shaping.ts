import * as hb from 'harfbuzzjs';
import { glyphOutline, type LoadedFont } from './fonts';
import { isMark as isMarkChar } from './joining';
import type { ShapedGlyph, ShapedLine } from './types';

/**
 * Shape a line of Arabic text.
 *
 * HarfBuzz picks the right contextual form of every letter (isolated,
 * initial, medial, final), applies ligatures such as lam-alef, and places
 * diacritics on their base letter. Everything downstream works on this
 * result, so deformations never break the joins.
 */
export function shapeLine(font: LoadedFont, text: string, sourceIndex?: number[]): ShapedLine {
  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.setDirection(hb.Direction.RTL);
  buffer.setScript('Arab');
  buffer.setLanguage('ar');
  // Report clusters character by character, so each diacritic keeps its own
  // identity and can be edited on its own.
  buffer.setClusterLevel(hb.ClusterLevel.MONOTONE_CHARACTERS);
  hb.shape(font.hbFont, buffer);

  const infos = buffer.getGlyphInfos();
  const positions = buffer.getGlyphPositions();

  // For RTL text HarfBuzz returns glyphs in visual order (left to right),
  // so we can simply walk a pen from x = 0 to the right.
  const glyphs: ShapedGlyph[] = [];
  let penX = 0;
  let penY = 0;
  infos.forEach((info, i) => {
    const pos = positions[i];
    const glyphId = info.codepoint;
    // A diacritic character is laid out with its base letter (same cluster),
    // but keeps its own index as `letter`, so it can carry its own settings.
    const own = info.cluster;
    let base = own;
    if (isMarkChar(text.charCodeAt(own))) {
      while (base > 0 && isMarkChar(text.charCodeAt(base))) base--;
    }
    const source = (i: number) => sourceIndex?.[i] ?? i;
    glyphs.push({
      glyphId,
      cluster: base,
      letter: source(own),
      base: source(base),
      x: penX + pos.xOffset,
      y: penY + pos.yOffset,
      advance: pos.xAdvance,
      xOffset: pos.xOffset,
      isMark: false, // decided below, once the whole cluster is known
      commands: glyphOutline(font, glyphId),
    });
    penX += pos.xAdvance;
    penY += pos.yAdvance;
  });

  // A glyph is a diacritic when the font says so (GDEF). Some fonts forget to
  // classify combined marks (shadda + kasra drawn as one glyph); a glyph with
  // no advance sharing its cluster with a letter that has one is a mark too.
  const advancing = new Set(glyphs.filter((g) => g.advance > 0).map((g) => g.cluster));
  for (const g of glyphs) {
    const cls = font.hbFace.getGlyphClass(g.glyphId);
    g.isMark = cls === hb.GlyphClass.MARK || (cls !== hb.GlyphClass.LIGATURE && g.advance === 0 && advancing.has(g.cluster));
  }

  return {
    text,
    glyphs,
    width: penX,
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
  };
}
