/**
 * Build-time pen strokes in the same language as the sketch engine:
 * a seeded point list, jittered twice, traced with quadratic midpoints.
 * Rendered as inline SVG, so they cost no JavaScript and follow currentColor.
 */

/** FNV-1a: a stable 32-bit seed from any string (an id, a href). */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32, identical to the engine's mkRng */
function mkRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = [number, number];
const r1 = (n: number) => Math.round(n * 10) / 10;

function trace(p: Pt[]): string {
  const n = p.length;
  let d = `M${r1(p[0][0])} ${r1(p[0][1])}`;
  for (let i = 1; i < n - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2;
    const my = (p[i][1] + p[i + 1][1]) / 2;
    d += `Q${r1(p[i][0])} ${r1(p[i][1])} ${r1(mx)} ${r1(my)}`;
  }
  d += `L${r1(p[n - 1][0])} ${r1(p[n - 1][1])}`;
  return d;
}

export interface Stroke {
  d: string;
  width: number;
  opacity: number;
}

/**
 * A hand-drawn horizontal rule, `w` x `h` user units, two passes like the
 * engine's ink(): a full stroke and a lighter, thinner, re-jittered one.
 */
export function inkRule(seed: number, w = 640, h = 14): Stroke[] {
  const R = mkRng(seed);
  const n = 9;
  const mid = h / 2;
  const tilt = (R() - 0.5) * 3;
  const base: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * (w - 8) + 4 + (R() - 0.5) * 10;
    const y = mid + Math.sin(i * 0.9 + R() * 6) * 1.4 + (R() - 0.5) * 1.6 + tilt * (i / n - 0.5);
    base.push([x, y]);
  }
  // the pen lifts a touch late: overshoot the end slightly
  base[n - 1] = [w - 2 + R() * 2, base[n - 1][1] + (R() - 0.5) * 2];
  const out: Stroke[] = [];
  for (let k = 0; k < 2; k++) {
    const amt = k ? 2.2 : 1.2;
    const jp = base.map(([x, y]) => [x + (R() - 0.5) * amt, y + (R() - 0.5) * amt] as Pt);
    out.push({ d: trace(jp), width: k ? 1.1 : 1.5, opacity: k ? 0.42 : 1 });
  }
  return out;
}

/** A loose hand-drawn underline for a single word, slightly rising. */
export function inkUnderline(seed: number, w = 200, h = 12): Stroke[] {
  const R = mkRng(seed);
  const pts: Pt[] = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * (w - 6) + 3;
    const y = h * 0.62 - (i / (n - 1)) * h * 0.25 + (R() - 0.5) * 1.6;
    pts.push([x, y]);
  }
  return [0, 1].map((k) => ({
    d: trace(pts.map(([x, y]) => [x + (R() - 0.5) * 2, y + (R() - 0.5) * (k ? 2 : 1)] as Pt)),
    width: k ? 1.4 : 2.2,
    opacity: k ? 0.45 : 1,
  }));
}
