// Pixel engine for the Windows 98-style Paint app.
//
// Pure TypeScript: no DOM access, so it runs in the browser and in Node (the
// tests use Node's built-in type stripping, so only erasable syntax is used).
// Everything draws hard-edged pixels with no anti-aliasing, like Paint did.
//
// Pixels are packed 32-bit colours in the byte order ImageData uses on
// little-endian machines (0xAABBGGRR), so a Bitmap's buffer can be copied
// straight into an ImageData. Every drawing function clips to the bitmap and
// grows bm.dirty to cover everything it changed (or may have changed).

export type Color = number;

const clampByte = (v: number): number => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v) | 0);

/** Packs r, g, b (0-255) into an opaque colour (0xAABBGGRR, unsigned). */
export const rgb = (r: number, g: number, b: number): Color =>
  ((0xff << 24) | (clampByte(b) << 16) | (clampByte(g) << 8) | clampByte(r)) >>> 0;

/** Unpacks a colour into [r, g, b]. */
export const toRGB = (c: Color): [number, number, number] => [c & 0xff, (c >>> 8) & 0xff, (c >>> 16) & 0xff];

/** Inclusive pixel bounds. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Bitmap {
  w: number;
  h: number;
  data: Uint32Array;
  dirty: Box | null;
}

const toSize = (n: number): number => (Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1);

/** A new bitmap filled with one colour. Its dirty box covers all of it (nothing has been shown yet). */
export function createBitmap(w: number, h: number, fill: Color): Bitmap {
  const bw = toSize(w);
  const bh = toSize(h);
  const data = new Uint32Array(bw * bh);
  data.fill(fill >>> 0);
  return { w: bw, h: bh, data, dirty: { x0: 0, y0: 0, x1: bw - 1, y1: bh - 1 } };
}

/** An exact copy, including the dirty box. */
export function cloneBitmap(bm: Bitmap): Bitmap {
  return { w: bm.w, h: bm.h, data: bm.data.slice(), dirty: bm.dirty ? { ...bm.dirty } : null };
}

export function getPixel(bm: Bitmap, x: number, y: number): Color | undefined {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= bm.w || y >= bm.h) return undefined;
  return bm.data[y * bm.w + x];
}

export function setPixel(bm: Bitmap, x: number, y: number, c: Color): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= bm.w || y >= bm.h) return;
  bm.data[y * bm.w + x] = c >>> 0;
  grow(bm, x, y, x, y);
}

/** Returns the dirty box and resets it to null. */
export function takeDirty(bm: Bitmap): Box | null {
  const d = bm.dirty;
  bm.dirty = null;
  return d;
}

/** Unions a box (any corner order, clipped to the bitmap) into bm.dirty. */
export function markDirty(bm: Bitmap, box: Box): void {
  const x0 = Math.max(0, Math.floor(Math.min(box.x0, box.x1)));
  const y0 = Math.max(0, Math.floor(Math.min(box.y0, box.y1)));
  const x1 = Math.min(bm.w - 1, Math.floor(Math.max(box.x0, box.x1)));
  const y1 = Math.min(bm.h - 1, Math.floor(Math.max(box.y0, box.y1)));
  if (x0 > x1 || y0 > y1) return;
  grow(bm, x0, y0, x1, y1);
}

// Grows the dirty box by an already-clipped box.
function grow(bm: Bitmap, x0: number, y0: number, x1: number, y1: number): void {
  // NaN would stick in the box (comparisons with NaN are always false)
  if (!(Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1))) return;
  const d = bm.dirty;
  if (!d) {
    bm.dirty = { x0, y0, x1, y1 };
    return;
  }
  if (x0 < d.x0) d.x0 = x0;
  if (y0 < d.y0) d.y0 = y0;
  if (x1 > d.x1) d.x1 = x1;
  if (y1 > d.y1) d.y1 = y1;
}

// ---------------------------------------------------------------------------
// Brush stamps

/** Pixel offsets relative to the pointer pixel. */
export type Stamp = ReadonlyArray<readonly [number, number]>;

// Offsets for a run of `size` pixels centred on 0: -floor((n-1)/2) .. ceil((n-1)/2).
function centred(size: number): [number, number] {
  const n = toSize(size);
  const lo = 0 - Math.floor((n - 1) / 2); // 0 - x, not -x, so size 1 gives +0
  return [lo, lo + n - 1];
}

export const stamps: {
  dot: Stamp;
  square(size: number): Stamp;
  round(diameter: number): Stamp;
  slash(size: number): Stamp;
  backslash(size: number): Stamp;
} = {
  dot: [[0, 0]],
  square(size: number): Stamp {
    const [lo, hi] = centred(size);
    const out: [number, number][] = [];
    for (let dy = lo; dy <= hi; dy++) for (let dx = lo; dx <= hi; dx++) out.push([dx, dy]);
    return out;
  },
  round(diameter: number): Stamp {
    const n = toSize(diameter);
    const [lo, hi] = centred(n);
    const c = (lo + hi) / 2;
    const r = n / 2;
    // Slightly inside the true circle (r^2 - r/2) so small discs look round:
    // 1 = dot, 2 = 2x2, 3 = plus, 4 = 4x4 without corners, 5 = 5x5 without corners.
    const limit = r * r - r / 2;
    const out: [number, number][] = [];
    for (let dy = lo; dy <= hi; dy++) {
      for (let dx = lo; dx <= hi; dx++) {
        if ((dx - c) * (dx - c) + (dy - c) * (dy - c) <= limit) out.push([dx, dy]);
      }
    }
    return out;
  },
  slash(size: number): Stamp {
    const [lo, hi] = centred(size);
    const out: [number, number][] = [];
    for (let i = lo; i <= hi; i++) out.push([i, 0 - i]);
    return out;
  },
  backslash(size: number): Stamp {
    const [lo, hi] = centred(size);
    const out: [number, number][] = [];
    for (let i = lo; i <= hi; i++) out.push([i, i]);
    return out;
  },
};

function stampBounds(stamp: Stamp): Box {
  let x0 = 0;
  let y0 = 0;
  let x1 = 0;
  let y1 = 0;
  let first = true;
  for (const [dx, dy] of stamp) {
    if (first) {
      x0 = x1 = dx;
      y0 = y1 = dy;
      first = false;
      continue;
    }
    if (dx < x0) x0 = dx;
    if (dx > x1) x1 = dx;
    if (dy < y0) y0 = dy;
    if (dy > y1) y1 = dy;
  }
  return { x0, y0, x1, y1 };
}

// ---------------------------------------------------------------------------
// Lines and strokes

// Integer Bresenham in all octants, from (x0,y0) to (x1,y1), both included.
function line(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/**
 * Calls plot for every pixel of the line, in order from (x0,y0) to (x1,y1),
 * both endpoints included, 8-connected. The pixel set does not depend on the
 * direction the line is drawn in.
 */
export function bresenham(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  plot: (x: number, y: number) => void,
): void {
  if (!(Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1))) return;
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  x1 = Math.floor(x1);
  y1 = Math.floor(y1);
  // Always rasterise in one canonical direction so a->b and b->a match.
  if (x1 > x0 || (x1 === x0 && y1 >= y0)) {
    line(x0, y0, x1, y1, plot);
    return;
  }
  const pts: number[] = [];
  line(x1, y1, x0, y0, (x, y) => {
    pts.push(x, y);
  });
  for (let i = pts.length - 2; i >= 0; i -= 2) plot(pts[i] as number, pts[i + 1] as number);
}

/** Liang-Barsky: the part of a segment inside a box, or null if none. */
function clipSegment(x0: number, y0: number, x1: number, y1: number, xmin: number, ymin: number, xmax: number, ymax: number): [number, number, number, number] | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    const pi = p[i] as number;
    const qi = q[i] as number;
    if (pi === 0) {
      if (qi < 0) return null;
      continue;
    }
    const r = qi / pi;
    if (pi < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

/** Stamps once at (x, y). */
export function stampAt(bm: Bitmap, x: number, y: number, stamp: Stamp, c: Color): void {
  if (stamp.length === 0 || !Number.isFinite(x) || !Number.isFinite(y)) return;
  x = Math.floor(x);
  y = Math.floor(y);
  const b = stampBounds(stamp);
  markDirty(bm, { x0: x + b.x0, y0: y + b.y0, x1: x + b.x1, y1: y + b.y1 });
  const { w, h, data } = bm;
  const col = c >>> 0;
  for (const [dx, dy] of stamp) {
    const px = x + dx;
    const py = y + dy;
    if (px >= 0 && py >= 0 && px < w && py < h) data[py * w + px] = col;
  }
}

// True when stamping at p and at p+(sx,sy) (a diagonal step) leaves a
// one-pixel see-through hole in a row or column, as a "/" stamp does when
// the stroke moves along "\".
function leavesHole(stamp: Stamp, sx: number, sy: number): boolean {
  const key = (x: number, y: number): number => (x + 1024) * 4096 + (y + 1024);
  const u = new Set<number>();
  for (const [dx, dy] of stamp) {
    u.add(key(dx, dy));
    u.add(key(dx + sx, dy + sy));
  }
  for (const [dx, dy] of stamp) {
    for (const [px, py] of [
      [dx, dy],
      [dx + sx, dy + sy],
    ] as const) {
      if (!u.has(key(px + 1, py)) && u.has(key(px + 2, py))) return true;
      if (!u.has(key(px, py + 1)) && u.has(key(px, py + 2))) return true;
    }
  }
  return false;
}

/**
 * Stamps at every Bresenham point from (x0,y0) to (x1,y1). Where a diagonal
 * step would leave see-through gaps with this stamp (slash and backslash
 * brushes), an extra stamp is placed at the 4-connected corner between the
 * two points so the stroke stays solid.
 */
export function strokeLine(
  bm: Bitmap,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stamp: Stamp,
  c: Color,
): void {
  if (stamp.length === 0) return;
  if (!(Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1))) return;
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  x1 = Math.floor(x1);
  y1 = Math.floor(y1);
  const b = stampBounds(stamp);
  // A line far longer than the picture is clipped to it (plus a margin wider
  // than the stamp) before rasterising, so its cost depends on the picture,
  // not on the line. Ordinary strokes are left exactly as they are.
  if (Math.abs(x1 - x0) + Math.abs(y1 - y0) > 4 * (bm.w + bm.h) + 64) {
    const pad = Math.max(-b.x0, -b.y0, b.x1, b.y1) + 2;
    const cut = clipSegment(x0, y0, x1, y1, -pad, -pad, bm.w - 1 + pad, bm.h - 1 + pad);
    if (!cut) return;
    [x0, y0, x1, y1] = cut.map(Math.round) as [number, number, number, number];
  }
  markDirty(bm, {
    x0: Math.min(x0, x1) + b.x0,
    y0: Math.min(y0, y1) + b.y0,
    x1: Math.max(x0, x1) + b.x1,
    y1: Math.max(y0, y1) + b.y1,
  });
  // Index by (sx > 0) + 2 * (sy > 0).
  const hole = [leavesHole(stamp, -1, -1), leavesHole(stamp, 1, -1), leavesHole(stamp, -1, 1), leavesHole(stamp, 1, 1)];
  const anyHole = hole[0] || hole[1] || hole[2] || hole[3];
  const { w, h, data } = bm;
  const col = c >>> 0;
  const put = (x: number, y: number): void => {
    for (const [dx, dy] of stamp) {
      const px = x + dx;
      const py = y + dy;
      if (px >= 0 && py >= 0 && px < w && py < h) data[py * w + px] = col;
    }
  };
  let first = true;
  let px = 0;
  let py = 0;
  bresenham(x0, y0, x1, y1, (x, y) => {
    if (!first && anyHole && x !== px && y !== py) {
      const sx = x - px;
      const sy = y - py;
      if (hole[(sx > 0 ? 1 : 0) + (sy > 0 ? 2 : 0)]) {
        // Use the corner with the smaller y so the result is the same in both directions.
        if (py < y) put(x, py);
        else put(px, y);
      }
    }
    put(x, y);
    first = false;
    px = x;
    py = y;
  });
}

// ---------------------------------------------------------------------------
// Shapes: rectangle, ellipse, rounded rectangle
//
// Each shape is a set of row spans [x0 + inset(y), x1 - inset(y)] that is
// symmetric left/right and top/bottom by construction. The rounded corners
// (and the whole ellipse) come from a "corner ellipse" of cw x ch pixels.
//
// Outline width 1 is the 4-boundary of the shape: the pixels with a 4-neighbour
// outside it. That ring is closed, 8-connected and one pixel thick wherever the
// curve is flat. A wider outline also takes everything outside the same shape
// shrunk by `width` on every side. The fill is what is left inside.

interface Shape {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cw: number;
  ch: number;
}

// Largest doubled column offset X2 (same parity as w-1) of a pixel centre in
// row y2 (doubled row offset) of the ellipse inscribed in a w x h box, i.e.
// X2^2 h^2 + y2^2 w^2 <= w^2 h^2. Every row keeps at least its centre pixel(s).
function ellipseHalf(w: number, h: number, y2: number): number {
  const ww = w * w;
  const hh = h * h;
  const lim = ww * hh - y2 * y2 * ww;
  let m = lim < 0 ? -1 : Math.floor(Math.sqrt(lim / hh));
  if (m >= 0) {
    // Integer correction of the floating-point estimate (exact below 2^53).
    while (m >= 0 && m * m * hh > lim) m--;
    while ((m + 1) * (m + 1) * hh <= lim) m++;
  }
  if (((m - (w - 1)) & 1) !== 0) m--;
  const min = (w - 1) & 1;
  if (m < min) m = min;
  if (m > w - 1) m = w - 1;
  return m;
}

// Left (and right) inset of row y, or -1 when y is outside the shape's box.
function insetAt(s: Shape, y: number): number {
  if (y < s.y0 || y > s.y1) return -1;
  if (s.cw <= 1 || s.ch <= 1) return 0;
  const k = Math.min(y - s.y0, s.y1 - y);
  if (k >= s.ch >> 1) return 0;
  const y2 = 2 * k - (s.ch - 1);
  // The centre row(s) of the corner ellipse are always full width, so its
  // leftmost and rightmost columns are never empty.
  if (y2 >= -1) return 0;
  return (s.cw - 1 - ellipseHalf(s.cw, s.ch, y2)) >> 1;
}

const RECT = 0;
const ELLIPSE = 1;
const ROUND = 2;

function shapeFor(kind: number, x0: number, y0: number, x1: number, y1: number, r: number): Shape {
  const W = x1 - x0 + 1;
  const H = y1 - y0 + 1;
  if (kind === ELLIPSE) return { x0, y0, x1, y1, cw: W, ch: H };
  if (kind === ROUND) return { x0, y0, x1, y1, cw: Math.min(2 * r, W), ch: Math.min(2 * r, H) };
  return { x0, y0, x1, y1, cw: 0, ch: 0 };
}

// Horizontal run from xa to xb inclusive, clipped (y must be in range).
function hline(bm: Bitmap, xa: number, xb: number, y: number, c: number): void {
  if (xa < 0) xa = 0;
  if (xb > bm.w - 1) xb = bm.w - 1;
  if (xa > xb) return;
  const row = y * bm.w;
  bm.data.fill(c, row + xa, row + xb + 1);
}

function drawShape(
  bm: Bitmap,
  kind: number,
  ax0: number,
  ay0: number,
  ax1: number,
  ay1: number,
  width: number,
  outline: Color | null,
  fill: Color | null,
  radius: number,
): void {
  if (outline === null && fill === null) return;
  const x0 = Math.floor(Math.min(ax0, ax1));
  const y0 = Math.floor(Math.min(ay0, ay1));
  const x1 = Math.floor(Math.max(ax0, ax1));
  const y1 = Math.floor(Math.max(ay0, ay1));
  const wpx = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  const ys = Math.max(y0, 0);
  const ye = Math.min(y1, bm.h - 1);
  if (ys > ye || x1 < 0 || x0 > bm.w - 1) return;
  markDirty(bm, { x0, y0, x1, y1 });

  const outer = shapeFor(kind, x0, y0, x1, y1, radius);
  let inner: Shape | null = null;
  if (wpx >= 2 && x1 - x0 + 1 > 2 * wpx && y1 - y0 + 1 > 2 * wpx) {
    inner = shapeFor(kind, x0 + wpx, y0 + wpx, x1 - wpx, y1 - wpx, Math.max(0, radius - wpx));
  }
  const oc = outline === null ? 0 : outline >>> 0;
  const fc = fill === null ? 0 : fill >>> 0;

  for (let y = ys; y <= ye; y++) {
    const a = insetAt(outer, y);
    const L = x0 + a;
    const R = x1 - a;
    if (outline === null) {
      hline(bm, L, R, y, fc);
      continue;
    }
    // Interior = pixels whose four neighbours are all in the shape.
    let il = L + 1;
    let ir = R - 1;
    const au = insetAt(outer, y - 1);
    const ad = insetAt(outer, y + 1);
    if (au < 0 || ad < 0) {
      il = 1;
      ir = 0;
    } else {
      il = Math.max(il, x0 + au, x0 + ad);
      ir = Math.min(ir, x1 - au, x1 - ad);
    }
    if (wpx >= 2) {
      const ai = inner ? insetAt(inner, y) : -1;
      if (!inner || ai < 0) {
        il = 1;
        ir = 0;
      } else {
        il = Math.max(il, inner.x0 + ai);
        ir = Math.min(ir, inner.x1 - ai);
      }
    }
    if (il > ir) {
      hline(bm, L, R, y, oc);
    } else {
      hline(bm, L, il - 1, y, oc);
      hline(bm, ir + 1, R, y, oc);
      if (fill !== null) hline(bm, il, ir, y, fc);
    }
  }
}

/**
 * Rectangle with corners in any order. The border (width >= 1) lies inside
 * the box and the fill covers the area inside the border; with no outline the
 * fill covers the whole box. A box thinner than 2 * width is solid outline.
 */
export function rect(
  bm: Bitmap,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  outline: Color | null,
  fill: Color | null,
): void {
  drawShape(bm, RECT, x0, y0, x1, y1, width, outline, fill, 0);
}

/**
 * The ellipse inscribed in the box (any corner order). Symmetric left/right
 * and top/bottom; 1-pixel-wide or -tall boxes become lines. Border and fill
 * follow the same rules as rect.
 */
export function ellipse(
  bm: Bitmap,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  outline: Color | null,
  fill: Color | null,
): void {
  drawShape(bm, ELLIPSE, x0, y0, x1, y1, width, outline, fill, 0);
}

/**
 * Rectangle with quarter-ellipse corners of the given radius (default about
 * 1/8 of the shorter side, clamped to [2, 16]). Same rules as rect.
 */
export function roundRect(
  bm: Bitmap,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  outline: Color | null,
  fill: Color | null,
  radius?: number,
): void {
  let r: number;
  if (radius === undefined || !Number.isFinite(radius)) {
    const shorter = Math.min(Math.abs(Math.floor(x1) - Math.floor(x0)), Math.abs(Math.floor(y1) - Math.floor(y0))) + 1;
    r = Math.min(16, Math.max(2, Math.round(shorter / 8)));
  } else {
    r = Math.max(0, Math.floor(radius));
  }
  drawShape(bm, ROUND, x0, y0, x1, y1, width, outline, fill, r);
}

// ---------------------------------------------------------------------------
// Fill, colour eraser, airbrush

/**
 * Exact-colour, 4-connected scanline flood fill with an explicit stack.
 * Returns false (and changes nothing) when the start is outside the bitmap or
 * already has colour c.
 */
export function floodFill(bm: Bitmap, x: number, y: number, c: Color): boolean {
  x = Math.floor(x);
  y = Math.floor(y);
  const { w, h, data } = bm;
  if (!(x >= 0 && y >= 0 && x < w && y < h)) return false;
  const col = c >>> 0;
  const target = data[y * w + x];
  if (target === col) return false;
  let minX = x;
  let maxX = x;
  let minY = y;
  let maxY = y;
  const stack: number[] = [x, y];
  while (stack.length > 0) {
    const sy = stack.pop() as number;
    const sx = stack.pop() as number;
    const row = sy * w;
    if (data[row + sx] !== target) continue;
    let l = sx;
    let r = sx;
    while (l > 0 && data[row + l - 1] === target) l--;
    while (r < w - 1 && data[row + r + 1] === target) r++;
    data.fill(col, row + l, row + r + 1);
    if (l < minX) minX = l;
    if (r > maxX) maxX = r;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
    for (let ny = sy - 1; ny <= sy + 1; ny += 2) {
      if (ny < 0 || ny >= h) continue;
      const nrow = ny * w;
      let inRun = false;
      for (let i = l; i <= r; i++) {
        if (data[nrow + i] === target) {
          if (!inRun) {
            stack.push(i, ny);
            inRun = true;
          }
        } else {
          inRun = false;
        }
      }
    }
  }
  grow(bm, minX, minY, maxX, maxY);
  return true;
}

/** Colour Eraser: under the stamp at (x, y), pixels equal to `from` become `to`. */
export function replaceColor(bm: Bitmap, x: number, y: number, stamp: Stamp, from: Color, to: Color): void {
  x = Math.floor(x);
  y = Math.floor(y);
  const f = from >>> 0;
  const t = to >>> 0;
  if (f === t) return;
  const { w, h, data } = bm;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [dx, dy] of stamp) {
    const px = x + dx;
    const py = y + dy;
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    const i = py * w + px;
    if (data[i] !== f) continue;
    data[i] = t;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  if (minX <= maxX) grow(bm, minX, minY, maxX, maxY);
}

/**
 * Airbrush: `count` random single pixels, uniformly over the pixels whose
 * offset from (cx, cy) is within `radius`. Deterministic for a given random().
 */
export function spray(
  bm: Bitmap,
  cx: number,
  cy: number,
  radius: number,
  count: number,
  c: Color,
  random: () => number,
): void {
  cx = Math.floor(cx);
  cy = Math.floor(cy);
  const rad = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  const R = Math.floor(rad);
  const rr = rad * rad;
  const n = 2 * R + 1;
  const { w, h, data } = bm;
  const col = c >>> 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < count; k++) {
    // Rejection sampling over the square; capped so a bad random() cannot hang.
    for (let tries = 0; tries < 64; tries++) {
      const dx = Math.min(n - 1, Math.floor(random() * n)) - R;
      const dy = Math.min(n - 1, Math.floor(random() * n)) - R;
      if (dx * dx + dy * dy > rr) continue;
      const px = cx + dx;
      const py = cy + dy;
      if (px >= 0 && py >= 0 && px < w && py < h) {
        data[py * w + px] = col;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      break;
    }
  }
  if (minX <= maxX) grow(bm, minX, minY, maxX, maxY);
}

// ---------------------------------------------------------------------------
// Shift constraints

/** Snaps the end so the line is horizontal, vertical or exactly 45 degrees. */
export function constrainLine(x0: number, y0: number, x1: number, y1: number): [number, number] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const TAN_22_5 = 0.41421356237309503;
  if (ay <= ax * TAN_22_5) return [x1, y0];
  if (ax <= ay * TAN_22_5) return [x0, y1];
  // Nearest point on the diagonal.
  const d = Math.round((ax + ay) / 2);
  return [x0 + (dx < 0 ? -d : d), y0 + (dy < 0 ? -d : d)];
}

/** Snaps the opposite corner so the box is square, keeping the drag direction. */
export function constrainSquare(x0: number, y0: number, x1: number, y1: number): [number, number] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  return [x0 + (dx < 0 ? -d : d), y0 + (dy < 0 ? -d : d)];
}

// ---------------------------------------------------------------------------
// Whole-image operations

/** A new w x h bitmap keeping the top-left content; new area is bg. */
export function resizeCanvas(bm: Bitmap, w: number, h: number, bg: Color): Bitmap {
  const out = createBitmap(w, h, bg);
  const cw = Math.min(bm.w, out.w);
  const ch = Math.min(bm.h, out.h);
  for (let y = 0; y < ch; y++) out.data.set(bm.data.subarray(y * bm.w, y * bm.w + cw), y * out.w);
  return out;
}

/** Inverts RGB, keeps alpha. */
export function invert(bm: Bitmap): void {
  const d = bm.data;
  for (let i = 0; i < d.length; i++) d[i] = (d[i] as number) ^ 0x00ffffff;
  grow(bm, 0, 0, bm.w - 1, bm.h - 1);
}

function normBox(box: Box): Box {
  return {
    x0: Math.floor(Math.min(box.x0, box.x1)),
    y0: Math.floor(Math.min(box.y0, box.y1)),
    x1: Math.floor(Math.max(box.x0, box.x1)),
    y1: Math.floor(Math.max(box.y0, box.y1)),
  };
}

/**
 * Copy of the pixels in the box, row by row ((x1-x0+1) * (y1-y0+1) values).
 * Parts of the box outside the bitmap read as 0.
 */
export function extract(bm: Bitmap, box: Box): Uint32Array {
  const b = normBox(box);
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  const out = new Uint32Array(bw * bh);
  const xa = Math.max(0, b.x0);
  const xb = Math.min(bm.w - 1, b.x1);
  if (xa > xb) return out;
  for (let y = Math.max(0, b.y0); y <= Math.min(bm.h - 1, b.y1); y++) {
    out.set(bm.data.subarray(y * bm.w + xa, y * bm.w + xb + 1), (y - b.y0) * bw + (xa - b.x0));
  }
  return out;
}

/** Writes pixels from extract() back into the box (clipped) and marks it dirty. */
export function restore(bm: Bitmap, box: Box, pixels: Uint32Array): void {
  const b = normBox(box);
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  if (pixels.length < bw * bh) throw new RangeError('restore: pixel array is smaller than the box');
  const xa = Math.max(0, b.x0);
  const xb = Math.min(bm.w - 1, b.x1);
  if (xa > xb) return;
  for (let y = Math.max(0, b.y0); y <= Math.min(bm.h - 1, b.y1); y++) {
    const src = (y - b.y0) * bw + (xa - b.x0);
    bm.data.set(pixels.subarray(src, src + (xb - xa + 1)), y * bm.w + xa);
  }
  markDirty(bm, b);
}

/** Mirrors left/right in place. */
export function flipH(bm: Bitmap): void {
  for (let y = 0; y < bm.h; y++) bm.data.subarray(y * bm.w, (y + 1) * bm.w).reverse();
  grow(bm, 0, 0, bm.w - 1, bm.h - 1);
}

/** Mirrors top/bottom in place. */
export function flipV(bm: Bitmap): void {
  const { w, h, data } = bm;
  const tmp = new Uint32Array(w);
  for (let top = 0, bot = h - 1; top < bot; top++, bot--) {
    tmp.set(data.subarray(top * w, top * w + w));
    data.copyWithin(top * w, bot * w, bot * w + w);
    data.set(tmp, bot * w);
  }
  grow(bm, 0, 0, w - 1, h - 1);
}

/** Rotates clockwise into a new bitmap (width and height swap for 90 and 270). */
export function rotate(bm: Bitmap, degrees: 90 | 180 | 270): Bitmap {
  const { w, h, data } = bm;
  const d = (((degrees as number) % 360) + 360) % 360;
  if (d === 0) return { ...cloneBitmap(bm), dirty: { x0: 0, y0: 0, x1: w - 1, y1: h - 1 } };
  if (d === 180) {
    const out = createBitmap(w, h, 0);
    out.data.set(data);
    out.data.reverse();
    return out;
  }
  if (d !== 90 && d !== 270) throw new RangeError('rotate: degrees must be 90, 180 or 270');
  const out = createBitmap(h, w, 0);
  const od = out.data;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    if (d === 90) {
      // (x, y) -> (h - 1 - y, x)
      const col = h - 1 - y;
      for (let x = 0; x < w; x++) od[x * h + col] = data[row + x] as number;
    } else {
      // (x, y) -> (y, w - 1 - x)
      for (let x = 0; x < w; x++) od[(w - 1 - x) * h + y] = data[row + x] as number;
    }
  }
  return out;
}
