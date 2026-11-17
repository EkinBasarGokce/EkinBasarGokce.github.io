/**
 * Pure geometry for the Curve and Polygon tools (tools/curve.ts): an even-odd
 * scanline polygon fill and the flattening of a cubic Bezier into pixels.
 *
 * No DOM and no imports, so the tests run it in Node directly
 * (node --test src/scripts/desktop/paint/tools/polyfill.test.ts); only
 * erasable TypeScript syntax is used for the same reason.
 *
 * Coordinates are picture pixels: the integer point (x, y) is the centre of
 * pixel (x, y), the same convention raster.ts lines use.
 */

export interface XY {
  x: number;
  y: number;
}

/** Inclusive pixel bounds (the same shape as raster.ts's Box). */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Even-odd scanline fill of the closed polygon through `pts` (integer
 * vertices; the last one joins back to the first). Calls span(y, xa, xb) once
 * for each run of pixels xa..xb (inclusive) in row y whose centres lie
 * strictly inside the polygon, rows and columns clipped to `clip`.
 *
 * Pixel centres exactly on a sloped side are left out, so the fill never
 * reaches past the 1-pixel Bresenham outline of the same sides: in every row a
 * side crosses, the outline pixel is the one nearest the crossing, and the
 * fill starts at the first pixel centre beyond it. A few centres on
 * horizontal sides and at downward-pointing vertices are filled; those pixels
 * are on the outline anyway. Rows use the half-open rule (a side covers
 * ymin <= y < ymax), so a vertex is never counted twice.
 */
export function polygonSpans(pts: readonly XY[], clip: Bounds, span: (y: number, xa: number, xb: number) => void): void {
  const n = pts.length;
  if (n < 3) return;
  // the sloped sides as [ya, xa, yb, xb] with ya < yb; horizontal ones never cross a row centre
  const sides: number[] = [];
  let ymin = Infinity;
  let ymax = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = pts[i] as XY;
    const b = pts[(i + 1) % n] as XY;
    if (!(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(b.x) && Number.isFinite(b.y))) return;
    if (a.y === b.y) continue;
    if (a.y < b.y) sides.push(a.y, a.x, b.y, b.x);
    else sides.push(b.y, b.x, a.y, a.x);
    ymin = Math.min(ymin, a.y, b.y);
    ymax = Math.max(ymax, a.y, b.y);
  }
  if (sides.length === 0) return;
  const ys = Math.max(Math.ceil(ymin), clip.y0);
  const ye = Math.min(Math.floor(ymax), clip.y1);
  const xs: number[] = [];
  for (let y = ys; y <= ye; y++) {
    xs.length = 0;
    for (let k = 0; k < sides.length; k += 4) {
      const ya = sides[k] as number;
      const yb = sides[k + 2] as number;
      if (y < ya || y >= yb) continue;
      const xa = sides[k + 1] as number;
      const xb = sides[k + 3] as number;
      // exact whenever the crossing is a whole number (integer inputs, one rounding)
      xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const l = Math.max(Math.floor(xs[k] as number) + 1, clip.x0);
      const r = Math.min(Math.ceil(xs[k + 1] as number) - 1, clip.x1);
      if (l <= r) span(y, l, r);
    }
  }
}

/** Upper bound on the samples taken along one curve (a curve that long is far outside any picture). */
const MAX_SAMPLES = 1 << 18;

/**
 * The pixels of the cubic Bezier p0 -> p3 with control points c1 and c2, in
 * order from p0 to p3 (both included, rounded to the nearest pixel).
 *
 * The curve is sampled at enough evenly spaced t that consecutive samples are
 * at most one pixel apart (the speed of a cubic Bezier never exceeds three
 * times its longest control-polygon leg), so consecutive returned pixels are
 * the same or 8-neighbours. Repeats are dropped, and so is any pixel that
 * only turns a corner between two diagonal neighbours (an "L" step), so a
 * one-pixel curve is one pixel thick, as a Bresenham line is.
 */
export function bezierPixels(p0: XY, c1: XY, c2: XY, p3: XY): XY[] {
  const all = [p0, c1, c2, p3];
  for (const p of all) if (!(Number.isFinite(p.x) && Number.isFinite(p.y))) return [];
  const leg = (a: XY, b: XY) => Math.hypot(b.x - a.x, b.y - a.y);
  const longest = Math.max(leg(p0, c1), leg(c1, c2), leg(c2, p3));
  const n = Math.min(MAX_SAMPLES, Math.max(1, Math.ceil(3 * longest)));
  const out: XY[] = [];
  const add = (x: number, y: number) => {
    const last = out[out.length - 1];
    if (last && last.x === x && last.y === y) return;
    // drop the corner of an L: a, b, c where a and c already touch diagonally
    const prev = out[out.length - 2];
    if (last && prev && Math.abs(prev.x - x) === 1 && Math.abs(prev.y - y) === 1) out.pop();
    out.push({ x, y });
  };
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    // the ends are exactly p0 and p3 (a = 1 or d = 1, the rest 0)
    add(Math.round(a * p0.x + b * c1.x + c * c2.x + d * p3.x), Math.round(a * p0.y + b * c1.y + c * c2.y + d * p3.y));
  }
  return out;
}

/**
 * Every .ts file in tools/ is loaded as a Paint module and installed; this
 * one only holds geometry for curve.ts, so there is nothing to install.
 */
export function install(): void {}
