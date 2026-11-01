import * as hb from 'harfbuzzjs';
import { glyphOutline, type LoadedFont } from './fonts';
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
    glyphs.push({
      glyphId,
      cluster: info.cluster,
      letter: sourceIndex?.[info.cluster] ?? info.cluster,
      x: penX + pos.xOffset,
      y: penY + pos.yOffset,
      advance: pos.xAdvance,
      xOffset: pos.xOffset,
      isMark: font.hbFace.getGlyphClass(glyphId) === hb.GlyphClass.MARK,
      commands: glyphOutline(font, glyphId),
    });
    penX += pos.xAdvance;
    penY += pos.yAdvance;
  });

  return {
    text,
    glyphs,
    width: penX,
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
  };
}
