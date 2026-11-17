/**
 * Pixel art for the Desktop page: icons and window glyphs, drawn here as text
 * grids (one character per pixel) and turned into small crisp SVGs at build time.
 * All original drawings in a Windows 98 spirit; no Microsoft artwork.
 *
 * Add an icon: add a 16-row grid of 16 characters below, using the palette keys.
 * A grid with uneven rows fails the build.
 */

import { PAINT_ICON, TOOL_ICONS } from './paint-icons';

const PALETTE: Record<string, string> = {
  k: '#000000',
  w: '#ffffff',
  s: '#c0c0c0',
  L: '#dfdfdf',
  g: '#808080',
  y: '#ffff00',
  o: '#808000',
  r: '#ff0000',
  m: '#800000',
  b: '#0000ff',
  n: '#000080',
  c: '#00ffff',
  t: '#008080',
  e: '#008000',
  l: '#00ff00',
  a: '#ff8040',
  d: '#804000',
  q: '#e0c080',
};

const camera = [
  '................',
  '................',
  '.....kkkkkk.....',
  '.kk.kssssssk....',
  '.kkkkkkkkkkkkkk.',
  '.kssssssssssrsk.',
  '.kkkkkkkkkkkkkk.',
  '.kgggkkkkkkgggk.',
  '.kggknnnnnnkggk.',
  '.kggknwnnnnkggk.',
  '.kggknnnnnnkggk.',
  '.kggknnnnnnkggk.',
  '.kgggkkkkkkgggk.',
  '.kkkkkkkkkkkkkk.',
  '................',
  '................',
];

export const ICONS = {
  notepad: [
    '................',
    '...k.k.k.k.k....',
    '..kgkgkgkgkgkk..',
    '..kwkwkwkwkwwk..',
    '..kwwwwwwwwwwkg.',
    '..kwnnnnnnnwwkg.',
    '..kwwwwwwwwwwkg.',
    '..kwnnnnnnwwwkg.',
    '..kwwwwwwwwwwkg.',
    '..kwnnnnnnnnwkg.',
    '..kwwwwwwwwwwkg.',
    '..kwnnnnnwwwwkg.',
    '..kwwwwwwwwwwkg.',
    '..kkkkkkkkkkkkg.',
    '...gggggggggggg.',
    '................',
  ],
  mail: [
    '................',
    '................',
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kskwwwwwwwwksk.',
    '.kwwkwwwwwwkwwkg',
    '.kwwwkwwwwkwwwkg',
    '.kwwwwkwwkwwwwkg',
    '.kwwwwwkkwwwwwkg',
    '.kwwwwwwwwwwwwkg',
    '.kwgwwwwwwwwgwkg',
    '.kgwwwwwwwwwwgkg',
    '.kkkkkkkkkkkkkkg',
    '..gggggggggggggg',
    '................',
    '................',
  ],
  camera,
  'camera-blue': camera.map((row) => row.replace(/g/g, 'b')),
  media: [
    '................',
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kwwkkwwkkwwkkk.',
    '.kkwwkkwwkkwwkk.',
    '.kkkkkkkkkkkkkk.',
    '.kggggggggggggk.',
    '.kgwwwwgwwwwwgk.',
    '.kggggggggggggk.',
    '.kgwwwwwwwwwwgk.',
    '.kggggggggggggk.',
    '.kgwwwwwggggggk.',
    '.kggggggggggggk.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
  ],
  globe: [
    '................',
    '.....kkkkkk.....',
    '...kkcbbbbbkk...',
    '..kbblleebbbbk..',
    '.kbblllleebbbbk.',
    '.kbbblllebbbllk.',
    '.kbbbbllbbbbllk.',
    '.kbbbbbbbbbllek.',
    '.kbbbbbbbbblelk.',
    '.kllbbbbbbbbbbk.',
    '.klllebbbbbbbbk.',
    '.kbllebbbbbbbbk.',
    '..kbllbbbbbbbk..',
    '...kkbbbbbbkk...',
    '.....kkkkkk.....',
    '................',
  ],
  document: [
    '................',
    '...kkkkkkkk.....',
    '...kwwwwwwkk....',
    '...kwwwwwwkwk...',
    '...kwwwwwwkkkk..',
    '...kwnnnnwwwwkg.',
    '...kwwwwwwwwwkg.',
    '...kwnnnnnnnwkg.',
    '...kwwwwwwwwwkg.',
    '...kwnnnnnnnwkg.',
    '...kwwwwwwwwwkg.',
    '...kwnnnnnnwwkg.',
    '...kwwwwwwwwwkg.',
    '...kkkkkkkkkkkg.',
    '....ggggggggggg.',
    '................',
  ],
  recycle: [
    '................',
    '...kkkkkkkkkk...',
    '..kwwwwwwwwwwk..',
    '..ksggggggggsk..',
    '...kkkkkkkkkk...',
    '...kswsgswsgsk..',
    '...kgsgsgsgsgk..',
    '...kswsgswsgsk..',
    '...kgsgsgsgsgk..',
    '....kwsgswsgk...',
    '....ksgsgsgsk...',
    '....kwsgswsgk...',
    '....ksgsgsgsk...',
    '....kkkkkkkkk...',
    '................',
    '................',
  ],
  folder: [
    '................',
    '................',
    '................',
    '..kkkkk.........',
    '.kyyyyyk........',
    '.kyyyyyykkkkkkk.',
    '.kwwwwwwwwwwwwk.',
    '.kwyyyyyyyyyyok.',
    '.kwyyyyyyyyyyok.',
    '.kwyyyyyyyyyyok.',
    '.kwyyyyyyyyyyok.',
    '.kwyyyyyyyyyyok.',
    '.kwoooooooooook.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
  ],
  computer: [
    '................',
    '..kkkkkkkkkkkk..',
    '..kssssssssssk..',
    '..kskkkkkkkksk..',
    '..kskttttttksk..',
    '..kskttttttksk..',
    '..kskttttttksk..',
    '..kskttttttksk..',
    '..kskttttttksk..',
    '..kskkkkkkkksk..',
    '..ksssssssslsk..',
    '..kkkkkkkkkkkk..',
    '.....kssssk.....',
    '...kkkkkkkkkk...',
    '...gggggggggg...',
    '................',
  ],
  clock: [
    '................',
    '.....kkkkkk.....',
    '...kkwwwwwwkk...',
    '..kwwwwkwwwwwk..',
    '.kwwwwwkwwwwwwk.',
    '.kwwwwwkwwwwwwk.',
    '.kwwwwwkwwwwwwk.',
    '.kkwwwwkkkkwwkk.',
    '.kwwwwwwwwwwwwk.',
    '.kwwwwwwwwwwwwk.',
    '.kwwwwwwwwwwwwk.',
    '.kwwwwwwwwwwwwk.',
    '..kwwwwkwwwwwk..',
    '...kkwwwwwwkk...',
    '.....kkkkkk.....',
    '................',
  ],
  paint: PAINT_ICON,
} satisfies Record<string, string[]>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as [IconName, ...IconName[]];

/** The little arrow in the corner of an icon that opens a link (a "shortcut"). */
const SHORTCUT = ['kkkkkkkk', 'kwwkkkkk', 'kwwwwkkk', 'kwwwkwkk', 'kwwkwwkk', 'kwkwwwwk', 'kkwwwwwk', 'kkkkkkkk'];

/** Window-frame glyphs (title-bar buttons and friends). */
const GLYPHS = {
  close: ['kk....kk', '.kk..kk.', '..kkkk..', '...kk...', '..kkkk..', '.kk..kk.', 'kk....kk'],
  min: ['......', '......', '......', '......', '......', 'kkkkkk', 'kkkkkk'],
  max: ['kkkkkkkkk', 'kkkkkkkkk', 'k.......k', 'k.......k', 'k.......k', 'k.......k', 'k.......k', 'kkkkkkkkk'],
  restore: ['..kkkkkk', '..kkkkkk', '..k....k', 'kkkkkk.k', 'kkkkkk.k', 'k....kkk', 'k....k..', 'k....k..', 'kkkkkk..'],
  help: ['.kkkk.', 'kk..kk', '....kk', '...kk.', '..kk..', '..kk..', '......', '..kk..'],
  check: ['......k', '.....kk', 'k...kkk', 'kk.kkk.', 'kkkkk..', '.kkk...', '..k....'],
  down: ['kkkkkkk', '.kkkkk.', '..kkk..', '...k...'],
  up: ['...k...', '..kkk..', '.kkkkk.', 'kkkkkkk'],
  right: ['k...', 'kk..', 'kkk.', 'kkkk', 'kkk.', 'kk..', 'k...'],
  play: ['k......', 'kkk....', 'kkkkk..', 'kkkkkkk', 'kkkkk..', 'kkk....', 'k......'],
  stop: ['kkkkkkk', 'kkkkkkk', 'kkkkkkk', 'kkkkkkk', 'kkkkkkk', 'kkkkkkk', 'kkkkkkk'],
  prev: ['kk....k', 'kk...kk', 'kk..kkk', 'kk.kkkk', 'kk..kkk', 'kk...kk', 'kk....k'],
  next: ['k....kk', 'kk...kk', 'kkk..kk', 'kkkk.kk', 'kkk..kk', 'kk...kk', 'k....kk'],
};
export type GlyphName = keyof typeof GLYPHS;

/** Turn a grid into SVG markup, merging runs of one colour into single rects. */
export function pixelSvg(rows: string[], fill?: string): string {
  const w = rows[0].length;
  const bad = rows.findIndex((r) => r.length !== w);
  if (bad !== -1) throw new Error(`pixel grid row ${bad} is ${rows[bad].length} wide, expected ${w}`);
  let rects = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      const ch = row[x];
      let run = 1;
      while (x + run < w && row[x + run] === ch) run++;
      if (ch !== '.') {
        const color = fill ?? PALETTE[ch];
        if (!color) throw new Error(`pixel grid uses unknown colour "${ch}"`);
        rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${color}"/>`;
      }
      x += run;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${rows.length}" width="${w}" height="${rows.length}" shape-rendering="crispEdges">${rects}</svg>`;
}

const uri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** An icon as a data URI, optionally with the shortcut arrow in its corner. */
export function iconUri(name: IconName, opts: { shortcut?: boolean } = {}): string {
  let rows: string[] = ICONS[name];
  if (opts.shortcut) {
    const grid = rows.map((r) => r.split(''));
    const top = grid.length - SHORTCUT.length;
    SHORTCUT.forEach((r, y) => r.split('').forEach((ch, x) => (grid[top + y][x] = ch)));
    rows = grid.map((r) => r.join(''));
  }
  return uri(pixelSvg(rows));
}

export type ToolName = keyof typeof TOOL_ICONS;
/** A Paint toolbox icon as a data URI (drawings in ./paint-icons.ts). */
export function toolUri(name: ToolName): string {
  return uri(pixelSvg(TOOL_ICONS[name]));
}

/** A title-bar glyph as a data URI, drawn in one colour. */
export function glyphUri(name: GlyphName, color = '#000000'): string {
  return uri(pixelSvg(GLYPHS[name], color));
}

/** A raised 3D button face (white and light top-left, grey and black bottom-right) with a glyph centred on it. */
function raisedButton(w: number, h: number, glyph: string[]): string[] {
  const g = Array.from({ length: h }, () => Array<string>(w).fill('s'));
  // outer ring: white top and left, black bottom and right
  for (let x = 0; x < w; x++) [g[0][x], g[h - 1][x]] = ['w', 'k'];
  for (let y = 0; y < h; y++) [g[y][0], g[y][w - 1]] = ['w', 'k'];
  g[h - 1][0] = g[0][w - 1] = 'k';
  // inner ring: light grey top and left, grey bottom and right
  for (let x = 1; x < w - 1; x++) [g[1][x], g[h - 2][x]] = ['L', 'g'];
  for (let y = 1; y < h - 1; y++) [g[y][1], g[y][w - 2]] = ['L', 'g'];
  g[h - 2][1] = g[1][w - 2] = 'g';
  const gx = Math.floor((w - glyph[0].length) / 2);
  const gy = Math.floor((h - glyph.length) / 2);
  glyph.forEach((row, y) => row.split('').forEach((ch, x) => ch !== '.' && (g[gy + y][gx + x] = ch)));
  return g.map((r) => r.join(''));
}

/**
 * CSS custom properties holding the glyphs the stylesheet needs (check marks,
 * menu arrows, the drop-down button), so win98.css never hand-codes pixels.
 */
export function uiCssVars(): string {
  const v = (name: string, svg: string) => `--g-${name}:url("${uri(svg)}");`;
  return (
    v('check', pixelSvg(GLYPHS.check)) +
    v('down', pixelSvg(GLYPHS.down)) +
    v('up', pixelSvg(GLYPHS.up)) +
    v('right', pixelSvg(GLYPHS.right)) +
    v('select', pixelSvg(raisedButton(16, 17, GLYPHS.down)))
  );
}
