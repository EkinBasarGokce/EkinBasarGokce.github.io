// Tests for the Curve and Polygon geometry. Run from the repo root:
//   node --test "src/scripts/desktop/paint/tools/polyfill.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bezierPixels, polygonSpans, type XY, type Bounds } from './polyfill.ts';
import { bresenham } from '../raster.ts';

// ---------------------------------------------------------------------------
// Helpers

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 64;
const H = 48;
const ALL: Bounds = { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };

/** the fill as a W x H grid of 0/1, checking spans are ordered, in range and never overlap */
function fillGrid(pts: XY[], clip: Bounds = ALL): Uint8Array {
  const g = new Uint8Array(W * H);
  polygonSpans(pts, clip, (y, xa, xb) => {
    assert.ok(Number.isInteger(y) && Number.isInteger(xa) && Number.isInteger(xb), 'integer spans');
    assert.ok(xa <= xb, `span ${xa}..${xb} is empty`);
    assert.ok(y >= clip.y0 && y <= clip.y1 && xa >= clip.x0 && xb <= clip.x1, `span ${y}: ${xa}..${xb} outside the clip`);
    for (let x = xa; x <= xb; x++) {
      assert.equal(g[y * W + x], 0, `pixel ${x},${y} filled twice`);
      g[y * W + x] = 1;
    }
  });
  return g;
}

/** the 1-pixel closed outline (Bresenham sides, as strokeLine with a dot draws them) */
function outlineGrid(pts: XY[]): Uint8Array {
  const g = new Uint8Array(W * H);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    bresenham(a.x, a.y, b.x, b.y, (x, y) => {
      if (x >= 0 && y >= 0 && x < W && y < H) g[y * W + x] = 1;
    });
  }
  return g;
}

/** true when (x, y) lies exactly on one of the sides */
function onSide(pts: XY[], x: number, y: number): boolean {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross !== 0) continue;
    if (x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)) return true;
  }
  return false;
}

/** independent even-odd test (PNPOLY ray casting); only meaningful off the sides */
function inside(pts: XY[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/**
 * Pixels 4-connected to the area outside the picture without crossing the
 * outline (the grid is treated as padded by one free pixel on every side).
 */
function exterior(outline: Uint8Array): Uint8Array {
  const out = new Uint8Array(W * H);
  const stack: number[] = [];
  const seed = (x: number, y: number) => {
    const i = y * W + x;
    if (!outline[i] && !out[i]) {
      out[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < W; x++) {
    seed(x, 0);
    seed(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    seed(0, y);
    seed(W - 1, y);
  }
  while (stack.length) {
    const i = stack.pop() as number;
    const x = i % W;
    const y = (i - x) / W;
    if (x > 0) seed(x - 1, y);
    if (x < W - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < H - 1) seed(x, y + 1);
  }
  return out;
}

function randomPolygon(rnd: () => number, n: number, margin = 1): XY[] {
  const pts: XY[] = [];
  for (let k = 0; k < n; k++) pts.push({ x: margin + Math.floor(rnd() * (W - 2 * margin)), y: margin + Math.floor(rnd() * (H - 2 * margin)) });
  return pts;
}

/** a random convex polygon: points on an ellipse in angle order, rounded */
function randomConvex(rnd: () => number): XY[] {
  const n = 3 + Math.floor(rnd() * 8);
  const angles = Array.from({ length: n }, () => rnd() * Math.PI * 2).sort((a, b) => a - b);
  const cx = 8 + rnd() * (W - 16);
  const cy = 8 + rnd() * (H - 16);
  // corners stay inside 1..W-2 x 1..H-2 after rounding
  const rx = 2 + rnd() * (Math.min(cx - 1, W - 2 - cx) - 2.5);
  const ry = 2 + rnd() * (Math.min(cy - 1, H - 2 - cy) - 2.5);
  const pts = angles.map((a) => ({ x: Math.round(cx + rx * Math.cos(a)), y: Math.round(cy + ry * Math.sin(a)) }));
  return pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
}

// ---------------------------------------------------------------------------
// polygonSpans

test('polygonSpans fills exactly the pixels strictly inside a triangle', () => {
  const tri = [
    { x: 2, y: 2 },
    { x: 30, y: 10 },
    { x: 8, y: 40 },
  ];
  const g = fillGrid(tri);
  let count = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (onSide(tri, x, y)) continue;
      assert.equal(g[y * W + x], inside(tri, x, y) ? 1 : 0, `pixel ${x},${y}`);
      count += g[y * W + x];
    }
  }
  assert.ok(count > 300, 'the triangle has an interior');
});

test('polygonSpans matches an independent even-odd test off the sides, for random (self-crossing) polygons', () => {
  const rnd = mulberry32(42);
  for (let round = 0; round < 300; round++) {
    const pts = randomPolygon(rnd, 3 + Math.floor(rnd() * 9), 0);
    const g = fillGrid(pts);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (onSide(pts, x, y)) continue;
        assert.equal(g[y * W + x], inside(pts, x, y) ? 1 : 0, `round ${round}: pixel ${x},${y} of ${JSON.stringify(pts)}`);
      }
    }
  }
});

test('polygonSpans: a pentagram leaves its centre empty (even-odd)', () => {
  const star = [0, 1, 2, 3, 4].map((k) => {
    const a = -Math.PI / 2 + ((k * 2) % 5) * ((2 * Math.PI) / 5);
    return { x: Math.round(32 + 20 * Math.cos(a)), y: Math.round(24 + 20 * Math.sin(a)) };
  });
  const g = fillGrid(star);
  assert.equal(g[24 * W + 32], 0, 'the centre is a hole');
  assert.equal(g[10 * W + 32], 1, 'the top point is filled');
});

test('polygonSpans: an axis-aligned rectangle fills its inside and the top row, never the other sides', () => {
  const g = fillGrid([
    { x: 5, y: 5 },
    { x: 20, y: 5 },
    { x: 20, y: 15 },
    { x: 5, y: 15 },
  ]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const want = x > 5 && x < 20 && y >= 5 && y < 15 ? 1 : 0;
      assert.equal(g[y * W + x], want, `pixel ${x},${y}`);
    }
  }
});

test('polygonSpans: degenerate polygons (fewer than 3 corners, a flat line, zero area) fill nothing', () => {
  const none = (pts: XY[]) => polygonSpans(pts, ALL, () => assert.fail(`filled ${JSON.stringify(pts)}`));
  none([]);
  none([{ x: 3, y: 3 }]);
  none([
    { x: 3, y: 3 },
    { x: 20, y: 9 },
  ]);
  none([
    { x: 3, y: 3 },
    { x: 20, y: 3 },
    { x: 40, y: 3 },
  ]);
  none([
    { x: 3, y: 3 },
    { x: 20, y: 9 },
    { x: 37, y: 15 },
  ]);
  none([
    { x: 3, y: 3 },
    { x: NaN, y: 9 },
    { x: 37, y: 15 },
  ]);
});

test('polygonSpans clips rows and columns, and a huge polygon costs only the clipped rows', () => {
  const big = [
    { x: -100000, y: -100000 },
    { x: 100000, y: -100000 },
    { x: 0, y: 100000 },
  ];
  let rows = 0;
  polygonSpans(big, { x0: 10, y0: 4, x1: 19, y1: 13 }, (y, xa, xb) => {
    rows++;
    assert.ok(y >= 4 && y <= 13);
    assert.deepEqual([xa, xb], [10, 19]);
  });
  assert.equal(rows, 10);
  const clip = { x0: 10, y0: 10, x1: 30, y1: 30 };
  const tri = [
    { x: 0, y: 0 },
    { x: 60, y: 5 },
    { x: 20, y: 45 },
  ];
  const full = fillGrid(tri);
  const part = fillGrid(tri, clip);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inClip = x >= clip.x0 && x <= clip.x1 && y >= clip.y0 && y <= clip.y1;
      assert.equal(part[y * W + x], inClip ? full[y * W + x] : 0, `pixel ${x},${y}`);
    }
  }
});

test('outline + fill: no fill outside the 1-pixel outline, and every enclosed region is all filled or all empty', () => {
  const rnd = mulberry32(7);
  for (let round = 0; round < 400; round++) {
    const pts = round % 2 ? randomConvex(rnd) : randomPolygon(rnd, 3 + Math.floor(rnd() * 8));
    if (pts.length < 3) continue;
    const fill = fillGrid(pts);
    const line = outlineGrid(pts);
    const out = exterior(line);
    const what = `round ${round}: ${JSON.stringify(pts)}`;
    for (let i = 0; i < W * H; i++) assert.ok(!(fill[i] && out[i] && !line[i]), `${what}: fill at ${i % W},${Math.floor(i / W)} leaks outside the outline`);
    // regions enclosed by the outline: each one is filled completely or not at all
    const seen = new Uint8Array(W * H);
    for (let s = 0; s < W * H; s++) {
      if (seen[s] || line[s] || out[s]) continue;
      const stack = [s];
      seen[s] = 1;
      let filled = 0;
      let empty = 0;
      while (stack.length) {
        const i = stack.pop() as number;
        if (fill[i]) filled++;
        else empty++;
        const x = i % W;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
          if (j < 0 || j >= W * H || seen[j] || line[j] || out[j]) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
      assert.ok(filled === 0 || empty === 0, `${what}: a region is partly filled (${filled} filled, ${empty} empty) from ${s % W},${Math.floor(s / W)}`);
    }
  }
});

test('outline + fill of a convex polygon: everything inside the outline is filled (no gaps)', () => {
  const rnd = mulberry32(99);
  for (let round = 0; round < 400; round++) {
    const pts = randomConvex(rnd);
    if (pts.length < 3) continue;
    const fill = fillGrid(pts);
    const line = outlineGrid(pts);
    const out = exterior(line);
    for (let i = 0; i < W * H; i++) {
      if (line[i] || out[i]) continue;
      assert.equal(fill[i], 1, `round ${round}: gap at ${i % W},${Math.floor(i / W)} in ${JSON.stringify(pts)}`);
    }
  }
});

// ---------------------------------------------------------------------------
// bezierPixels

const chebyshev = (a: XY, b: XY) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

test('bezierPixels runs from the start to the end, 8-connected, without repeats or L corners', () => {
  const rnd = mulberry32(3);
  for (let round = 0; round < 300; round++) {
    const r = () => Math.floor(rnd() * 400) - 100;
    const [p0, c1, c2, p3] = [0, 1, 2, 3].map(() => ({ x: r(), y: r() }));
    const px = bezierPixels(p0, c1, c2, p3);
    const what = `round ${round}: ${JSON.stringify([p0, c1, c2, p3])}`;
    assert.deepEqual(px[0], p0, `${what}: starts at p0`);
    assert.deepEqual(px[px.length - 1], p3, `${what}: ends at p3`);
    for (let k = 1; k < px.length; k++) {
      assert.equal(chebyshev(px[k - 1], px[k]), 1, `${what}: step ${k} is not to an 8-neighbour`);
      // an L corner: two pixels that already touch diagonally, joined through a third
      if (k >= 2) assert.ok(!(Math.abs(px[k - 2].x - px[k].x) === 1 && Math.abs(px[k - 2].y - px[k].y) === 1), `${what}: L corner at ${k - 1}`);
    }
  }
});

test('bezierPixels stays within a pixel of the true curve', () => {
  const p0 = { x: 0, y: 0 };
  const c1 = { x: 120, y: -40 };
  const c2 = { x: -30, y: 90 };
  const p3 = { x: 100, y: 60 };
  const px = bezierPixels(p0, c1, c2, p3);
  const at = (t: number) => {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
    };
  };
  const samples = Array.from({ length: 20001 }, (_, k) => at(k / 20000));
  for (const p of px) {
    const d = Math.min(...samples.map((s) => Math.hypot(s.x - p.x, s.y - p.y)));
    assert.ok(d <= 1, `pixel ${p.x},${p.y} is ${d.toFixed(2)} from the curve`);
  }
  // and the curve never runs more than a pixel from the pixels
  for (let k = 0; k < samples.length; k += 37) {
    const s = samples[k];
    const d = Math.min(...px.map((p) => Math.hypot(s.x - p.x, s.y - p.y)));
    assert.ok(d <= 1, `curve point ${s.x.toFixed(1)},${s.y.toFixed(1)} is ${d.toFixed(2)} from the pixels`);
  }
});

test('bezierPixels: a straight Bezier is a one-pixel line; a point is one pixel; bad input is empty', () => {
  const line = bezierPixels({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 });
  assert.equal(line.length, 31);
  line.forEach((p, k) => assert.deepEqual(p, { x: k, y: 0 }));
  const diag = bezierPixels({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 15, y: 15 }, { x: 20, y: 20 });
  assert.equal(diag.length, 21, 'a 45-degree Bezier is a clean diagonal');
  const dot = { x: 4, y: 7 };
  assert.deepEqual(bezierPixels(dot, dot, dot, dot), [dot]);
  assert.deepEqual(bezierPixels({ x: 0, y: 0 }, { x: Infinity, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }), []);
});

test('bezierPixels with far-away control points stays bounded and fast', () => {
  const t0 = performance.now();
  const px = bezierPixels({ x: 0, y: 0 }, { x: 1e7, y: -1e7 }, { x: -1e7, y: 1e7 }, { x: 10, y: 10 });
  assert.ok(px.length > 0 && px.length <= (1 << 18) + 1);
  assert.ok(performance.now() - t0 < 2000, 'under two seconds');
});
