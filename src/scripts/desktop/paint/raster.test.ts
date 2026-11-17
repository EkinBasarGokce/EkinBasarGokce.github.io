// Tests for the Paint pixel engine. Run from the repo root:
//   node --test "src/scripts/desktop/paint/raster.test.ts"
import { test } from 'node:test';
import * as R from './raster.ts';
import assert from 'node:assert/strict';
import {
  bresenham,
  cloneBitmap,
  constrainLine,
  constrainSquare,
  createBitmap,
  ellipse,
  extract,
  flipH,
  flipV,
  floodFill,
  getPixel,
  invert,
  markDirty,
  rect,
  replaceColor,
  resizeCanvas,
  restore,
  rgb,
  rotate,
  roundRect,
  setPixel,
  spray,
  stampAt,
  stamps,
  strokeLine,
  takeDirty,
  toRGB,
} from './raster.ts';
import type { Bitmap, Box, Color, Stamp } from './raster.ts';

// ---------------------------------------------------------------------------
// Helpers

const WHITE = rgb(255, 255, 255);
const BLACK = rgb(0, 0, 0);
const RED = rgb(255, 0, 0);
const BLUE = rgb(0, 0, 255);

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

/** Bounding box of the pixels that differ between two same-size bitmaps. */
function diffBox(a: Bitmap, b: Bitmap): Box | null {
  let box: Box | null = null;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      if (a.data[y * a.w + x] === b.data[y * b.w + x]) continue;
      if (!box) box = { x0: x, y0: y, x1: x, y1: y };
      else {
        box.x0 = Math.min(box.x0, x);
        box.y0 = Math.min(box.y0, y);
        box.x1 = Math.max(box.x1, x);
        box.y1 = Math.max(box.y1, y);
      }
    }
  }
  return box;
}

/** Runs op on bm (with a clean dirty box) and checks the dirty box covers every changed pixel. */
function checkDirty(bm: Bitmap, op: (bm: Bitmap) => void, label = ''): void {
  takeDirty(bm);
  const before = cloneBitmap(bm);
  op(bm);
  const changed = diffBox(before, bm);
  if (!changed) return;
  const d = bm.dirty;
  assert.ok(d, `${label}: pixels changed but dirty is null`);
  assert.ok(
    d.x0 <= changed.x0 && d.y0 <= changed.y0 && d.x1 >= changed.x1 && d.y1 >= changed.y1,
    `${label}: dirty ${JSON.stringify(d)} does not cover changes ${JSON.stringify(changed)}`,
  );
  assert.ok(d.x0 >= 0 && d.y0 >= 0 && d.x1 < bm.w && d.y1 < bm.h, `${label}: dirty outside bitmap`);
}

const key = (x: number, y: number): string => `${x},${y}`;

/** Coordinates of every pixel with colour c. */
function pixelsOf(bm: Bitmap, c: Color): Set<string> {
  const s = new Set<string>();
  for (let y = 0; y < bm.h; y++) for (let x = 0; x < bm.w; x++) if (bm.data[y * bm.w + x] === c) s.add(key(x, y));
  return s;
}

function connected(set: Set<string>, eight: boolean): boolean {
  if (set.size === 0) return true;
  const first = set.values().next().value as string;
  const seen = new Set<string>([first]);
  const queue = [first];
  const dirs = eight
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length) {
    const [x, y] = (queue.pop() as string).split(',').map(Number) as [number, number];
    for (const [dx, dy] of dirs as [number, number][]) {
      const k = key(x + dx, y + dy);
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        queue.push(k);
      }
    }
  }
  return seen.size === set.size;
}

/** Draws a shape at (m, m) in a bitmap with a margin m, outline BLACK and fill RED. */
function drawn(
  fn: typeof ellipse,
  W: number,
  H: number,
  width: number,
  outline: Color | null = BLACK,
  fill: Color | null = RED,
  extra?: number,
): Bitmap {
  const m = 2;
  const bm = createBitmap(W + 2 * m, H + 2 * m, WHITE);
  if (fn === roundRect) roundRect(bm, m, m, m + W - 1, m + H - 1, width, outline, fill, extra);
  else fn(bm, m, m, m + W - 1, m + H - 1, width, outline, fill);
  return bm;
}

function isMirrorSymmetric(bm: Bitmap): { lr: boolean; tb: boolean } {
  let lr = true;
  let tb = true;
  for (let y = 0; y < bm.h; y++) {
    for (let x = 0; x < bm.w; x++) {
      const c = bm.data[y * bm.w + x];
      if (c !== bm.data[y * bm.w + (bm.w - 1 - x)]) lr = false;
      if (c !== bm.data[(bm.h - 1 - y) * bm.w + x]) tb = false;
    }
  }
  return { lr, tb };
}

/** Pixels of `shape` that have a 4-neighbour outside it. */
function fourBoundary(shape: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const k of shape) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    if (!shape.has(key(x + 1, y)) || !shape.has(key(x - 1, y)) || !shape.has(key(x, y + 1)) || !shape.has(key(x, y - 1))) {
      out.add(k);
    }
  }
  return out;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

function bounds(stamp: Stamp): Box {
  const xs = stamp.map((p) => p[0]);
  const ys = stamp.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// ---------------------------------------------------------------------------
// Colours

test('rgb packs as 0xAABBGGRR and returns an unsigned number', () => {
  assert.equal(rgb(0x12, 0x34, 0x56), 0xff563412);
  assert.equal(rgb(255, 255, 255), 0xffffffff);
  assert.equal(rgb(0, 0, 0), 0xff000000);
  assert.ok(rgb(255, 0, 0) > 0);
  const arr = new Uint32Array(1);
  arr[0] = rgb(200, 100, 50);
  assert.equal(arr[0], rgb(200, 100, 50), 'what a Uint32Array stores equals the packed value');
  const bytes = new Uint8Array(arr.buffer);
  assert.deepEqual([...bytes], [200, 100, 50, 255], 'ImageData byte order on little-endian');
});

test('toRGB(rgb(r,g,b)) round-trips', () => {
  const rnd = mulberry32(1);
  for (let i = 0; i < 500; i++) {
    const c: [number, number, number] = [Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256)];
    assert.deepEqual(toRGB(rgb(...c)), c);
  }
});

// ---------------------------------------------------------------------------
// Bitmap basics

test('createBitmap, getPixel and setPixel', () => {
  const bm = createBitmap(4, 3, BLUE);
  assert.equal(bm.w, 4);
  assert.equal(bm.h, 3);
  assert.equal(bm.data.length, 12);
  assert.ok(bm.data.every((v) => v === BLUE));
  assert.equal(getPixel(bm, 3, 2), BLUE);
  assert.equal(getPixel(bm, -1, 0), undefined);
  assert.equal(getPixel(bm, 4, 0), undefined);
  assert.equal(getPixel(bm, 0, 3), undefined);
  takeDirty(bm);
  setPixel(bm, 1, 2, RED);
  assert.equal(getPixel(bm, 1, 2), RED);
  assert.deepEqual(bm.dirty, { x0: 1, y0: 2, x1: 1, y1: 2 });
  setPixel(bm, 3, 0, RED);
  assert.deepEqual(bm.dirty, { x0: 1, y0: 0, x1: 3, y1: 2 });
  const before = cloneBitmap(bm);
  setPixel(bm, 10, 10, BLACK);
  setPixel(bm, -1, 1, BLACK);
  assert.deepEqual(bm.data, before.data, 'outside writes are ignored');
  assert.deepEqual(bm.dirty, { x0: 1, y0: 0, x1: 3, y1: 2 });
});

test('takeDirty returns the box and resets it; markDirty clips and unions', () => {
  const bm = createBitmap(10, 10, WHITE);
  assert.deepEqual(takeDirty(bm), { x0: 0, y0: 0, x1: 9, y1: 9 }, 'a new bitmap starts fully dirty');
  assert.equal(takeDirty(bm), null);
  markDirty(bm, { x0: 5, y0: 6, x1: 2, y1: 3 });
  assert.deepEqual(bm.dirty, { x0: 2, y0: 3, x1: 5, y1: 6 }, 'corner order normalised');
  markDirty(bm, { x0: -5, y0: 8, x1: 0, y1: 20 });
  assert.deepEqual(bm.dirty, { x0: 0, y0: 3, x1: 5, y1: 9 }, 'clipped union');
  markDirty(bm, { x0: 20, y0: 20, x1: 30, y1: 30 });
  assert.deepEqual(bm.dirty, { x0: 0, y0: 3, x1: 5, y1: 9 }, 'fully outside box is ignored');
  assert.deepEqual(takeDirty(bm), { x0: 0, y0: 3, x1: 5, y1: 9 });
  assert.equal(bm.dirty, null);
});

test('cloneBitmap is an independent copy', () => {
  const a = createBitmap(3, 3, WHITE);
  const b = cloneBitmap(a);
  setPixel(b, 1, 1, RED);
  assert.equal(getPixel(a, 1, 1), WHITE);
  assert.equal(getPixel(b, 1, 1), RED);
  assert.notEqual(a.dirty, b.dirty);
});

// ---------------------------------------------------------------------------
// Stamps

test('stamps.dot is a single pixel', () => {
  assert.deepEqual(stamps.dot.map((p) => [...p]), [[0, 0]]);
});

test('stamps.square has size*size offsets, centred', () => {
  for (let n = 1; n <= 9; n++) {
    const s = stamps.square(n);
    assert.equal(s.length, n * n, `square(${n}) count`);
    assert.equal(new Set(s.map(([x, y]) => key(x, y))).size, n * n, 'no duplicates');
    const b = bounds(s);
    assert.deepEqual(b, {
      x0: 0 - Math.floor((n - 1) / 2),
      y0: 0 - Math.floor((n - 1) / 2),
      x1: Math.ceil((n - 1) / 2),
      y1: Math.ceil((n - 1) / 2),
    });
  }
});

test('stamps.round: 1 = dot, 2 = 2x2, larger ones are symmetric discs in the square bounds', () => {
  assert.deepEqual(stamps.round(1).map((p) => [...p]), [[0, 0]]);
  const two = new Set(stamps.round(2).map(([x, y]) => key(x, y)));
  assert.ok(sameSet(two, new Set(['0,0', '1,0', '0,1', '1,1'])));
  for (let n = 3; n <= 12; n++) {
    const s = stamps.round(n);
    const b = bounds(s);
    const lo = 0 - Math.floor((n - 1) / 2);
    const hi = Math.ceil((n - 1) / 2);
    assert.deepEqual(b, { x0: lo, y0: lo, x1: hi, y1: hi }, `round(${n}) spans its diameter`);
    const set = new Set(s.map(([x, y]) => key(x, y)));
    for (const [x, y] of s) {
      assert.ok(set.has(key(lo + hi - x, y)) && set.has(key(x, lo + hi - y)) && set.has(key(y, x)), `round(${n}) symmetric`);
    }
    assert.ok(!set.has(key(lo, lo)), `round(${n}) has no square corner`);
    assert.ok(s.length < n * n && s.length > (n * n) / 2);
    assert.ok(connected(set, false));
  }
});

test('stamps.slash and backslash are centred diagonals of the given length', () => {
  for (let n = 1; n <= 8; n++) {
    const s = stamps.slash(n);
    const b = stamps.backslash(n);
    assert.equal(s.length, n);
    assert.equal(b.length, n);
    const lo = 0 - Math.floor((n - 1) / 2);
    const hi = Math.ceil((n - 1) / 2);
    assert.deepEqual(bounds(s), { x0: lo, y0: 0 - hi, x1: hi, y1: 0 - lo });
    assert.deepEqual(bounds(b), { x0: lo, y0: lo, x1: hi, y1: hi });
    for (const [x, y] of s) assert.equal(x + y, 0, '"/" goes bottom-left to top-right');
    for (const [x, y] of b) assert.equal(x - y, 0);
  }
});

// ---------------------------------------------------------------------------
// Bresenham

function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = [];
  bresenham(x0, y0, x1, y1, (x, y) => pts.push([x, y]));
  return pts;
}

test('bresenham includes both endpoints, is 8-connected and minimal', () => {
  const rnd = mulberry32(7);
  for (let i = 0; i < 400; i++) {
    const x0 = Math.floor(rnd() * 80) - 40;
    const y0 = Math.floor(rnd() * 80) - 40;
    const x1 = Math.floor(rnd() * 80) - 40;
    const y1 = Math.floor(rnd() * 80) - 40;
    const pts = linePoints(x0, y0, x1, y1);
    assert.deepEqual(pts[0], [x0, y0]);
    assert.deepEqual(pts[pts.length - 1], [x1, y1]);
    assert.equal(pts.length, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1);
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1] as [number, number];
      const [bx, by] = pts[k] as [number, number];
      assert.ok(Math.abs(bx - ax) <= 1 && Math.abs(by - ay) <= 1 && (bx !== ax || by !== ay), 'each step is to an 8-neighbour');
    }
  }
});

test('bresenham gives the same pixels in both directions (reversed order)', () => {
  const rnd = mulberry32(11);
  for (let i = 0; i < 300; i++) {
    const a = [Math.floor(rnd() * 60), Math.floor(rnd() * 60)] as const;
    const b = [Math.floor(rnd() * 60), Math.floor(rnd() * 60)] as const;
    const fwd = linePoints(a[0], a[1], b[0], b[1]);
    const back = linePoints(b[0], b[1], a[0], a[1]);
    assert.deepEqual(back.reverse(), fwd);
  }
});

test('bresenham stays within half a pixel of the ideal line', () => {
  const rnd = mulberry32(3);
  for (let i = 0; i < 300; i++) {
    const x0 = Math.floor(rnd() * 50);
    const y0 = Math.floor(rnd() * 50);
    const x1 = Math.floor(rnd() * 50);
    const y1 = Math.floor(rnd() * 50);
    const dx = x1 - x0;
    const dy = y1 - y0;
    for (const [x, y] of linePoints(x0, y0, x1, y1)) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        const ideal = dx === 0 ? y0 : y0 + ((x - x0) * dy) / dx;
        assert.ok(Math.abs(y - ideal) <= 0.5 + 1e-9);
      } else {
        const ideal = x0 + ((y - y0) * dx) / dy;
        assert.ok(Math.abs(x - ideal) <= 0.5 + 1e-9);
      }
    }
  }
  assert.deepEqual(linePoints(5, 5, 5, 5), [[5, 5]], 'a single point');
  assert.deepEqual(linePoints(0, 0, 3, 3), [[0, 0], [1, 1], [2, 2], [3, 3]], 'exact diagonal');
});

// ---------------------------------------------------------------------------
// Stamps on a bitmap, strokes

test('stampAt clips at the edges and marks the stamp dirty', () => {
  const bm = createBitmap(10, 10, WHITE);
  checkDirty(bm, (b) => stampAt(b, 0, 0, stamps.square(5), RED), 'stampAt corner');
  assert.equal(pixelsOf(bm, RED).size, 9, 'only the 3x3 inside the bitmap');
  checkDirty(bm, (b) => stampAt(b, 9, 5, stamps.round(4), BLUE), 'stampAt edge');
  assert.doesNotThrow(() => stampAt(bm, -50, -50, stamps.square(3), BLACK));
});

test('strokeLine with a dot paints exactly the Bresenham pixels', () => {
  const bm = createBitmap(40, 30, WHITE);
  strokeLine(bm, 2, 3, 37, 21, stamps.dot, BLACK);
  const expected = new Set(linePoints(2, 3, 37, 21).map(([x, y]) => key(x, y)));
  assert.ok(sameSet(pixelsOf(bm, BLACK), expected));
  const bm2 = createBitmap(40, 40, WHITE);
  strokeLine(bm2, 0, 0, 30, 30, stamps.dot, BLACK);
  assert.equal(pixelsOf(bm2, BLACK).size, 31, 'a diagonal dot stroke stays 1 pixel thin');
});

function rowsAndColumnsSolid(bm: Bitmap, c: Color): boolean {
  for (let y = 0; y < bm.h; y++) {
    let state = 0; // 0 before, 1 inside, 2 after
    for (let x = 0; x < bm.w; x++) {
      const on = bm.data[y * bm.w + x] === c;
      if (on && state === 2) return false;
      if (on) state = 1;
      else if (state === 1) state = 2;
    }
  }
  for (let x = 0; x < bm.w; x++) {
    let state = 0;
    for (let y = 0; y < bm.h; y++) {
      const on = bm.data[y * bm.w + x] === c;
      if (on && state === 2) return false;
      if (on) state = 1;
      else if (state === 1) state = 2;
    }
  }
  return true;
}

test('a fast diagonal stroke with a slash or backslash stamp has no see-through gaps', () => {
  for (const size of [3, 4, 8]) {
    // "/" brush moved along "\" (the worst case), forwards and backwards.
    for (const [a, b] of [[[5, 5], [30, 30]], [[30, 30], [5, 5]]] as const) {
      const bm = createBitmap(40, 40, WHITE);
      strokeLine(bm, a[0], a[1], b[0], b[1], stamps.slash(size), BLACK);
      assert.ok(rowsAndColumnsSolid(bm, BLACK), `slash(${size}) along \\ is solid`);
    }
    const bm = createBitmap(40, 40, WHITE);
    strokeLine(bm, 5, 30, 30, 5, stamps.backslash(size), BLACK);
    assert.ok(rowsAndColumnsSolid(bm, BLACK), `backslash(${size}) along / is solid`);
    // Shallow and steep slopes mix straight and diagonal steps.
    const bm2 = createBitmap(60, 60, WHITE);
    strokeLine(bm2, 5, 10, 55, 30, stamps.slash(size), BLACK);
    assert.ok(rowsAndColumnsSolid(bm2, BLACK), `slash(${size}) shallow stroke is solid`);
  }
});

test('strokeLine paints the same pixels in both directions and covers its dirty box', () => {
  for (const stamp of [stamps.slash(5), stamps.backslash(4), stamps.square(3), stamps.round(5)]) {
    const a = createBitmap(50, 50, WHITE);
    const b = createBitmap(50, 50, WHITE);
    checkDirty(a, (bm) => strokeLine(bm, 3, 40, 45, 2, stamp, BLACK), 'strokeLine');
    strokeLine(b, 45, 2, 3, 40, stamp, BLACK);
    assert.deepEqual(a.data, b.data);
  }
  const edge = createBitmap(20, 20, WHITE);
  checkDirty(edge, (bm) => strokeLine(bm, -10, 5, 30, 15, stamps.square(4), RED), 'clipped stroke');
});

test('strokeLine with a square stamp covers the stamp at both ends', () => {
  const bm = createBitmap(30, 30, WHITE);
  strokeLine(bm, 5, 5, 20, 12, stamps.square(4), BLUE);
  for (const [px, py] of [[5, 5], [20, 12]]) {
    for (const [dx, dy] of stamps.square(4)) assert.equal(getPixel(bm, (px as number) + dx, (py as number) + dy), BLUE);
  }
});

// ---------------------------------------------------------------------------
// Rectangles

test('rect border lies inside the box', () => {
  const bm = drawn(rect, 10, 6, 1);
  assert.equal(pixelsOf(bm, BLACK).size, 2 * 10 + 2 * 4);
  assert.equal(pixelsOf(bm, RED).size, 8 * 4);
  // Nothing outside the box (margin 2).
  for (let y = 0; y < bm.h; y++) {
    for (let x = 0; x < bm.w; x++) {
      const inside = x >= 2 && x <= 11 && y >= 2 && y <= 7;
      if (!inside) assert.equal(bm.data[y * bm.w + x], WHITE);
    }
  }
  const thick = drawn(rect, 12, 10, 3);
  assert.equal(pixelsOf(thick, RED).size, 6 * 4, 'fill covers the area inside a width-3 border');
  assert.equal(pixelsOf(thick, BLACK).size, 12 * 10 - 6 * 4);
});

test('rect corners may come in any order', () => {
  const ref = createBitmap(20, 20, WHITE);
  rect(ref, 3, 4, 15, 12, 2, BLACK, RED);
  for (const [a, b, c, d] of [[15, 12, 3, 4], [3, 12, 15, 4], [15, 4, 3, 12]] as const) {
    const bm = createBitmap(20, 20, WHITE);
    rect(bm, a, b, c, d, 2, BLACK, RED);
    assert.deepEqual(bm.data, ref.data);
  }
});

test('rect thinner than twice the width is solid outline colour', () => {
  for (const [W, H, w] of [[1, 10, 1], [10, 1, 1], [2, 8, 1], [4, 9, 2], [9, 5, 3], [6, 6, 3]] as const) {
    const bm = drawn(rect, W, H, w);
    assert.equal(pixelsOf(bm, BLACK).size, W * H, `${W}x${H} w${w}`);
    assert.equal(pixelsOf(bm, RED).size, 0);
  }
});

test('rect: outline only leaves the inside alone; fill only covers the whole box', () => {
  const bm = createBitmap(12, 12, BLUE);
  rect(bm, 1, 1, 10, 10, 1, BLACK, null);
  assert.equal(pixelsOf(bm, BLACK).size, 36);
  assert.equal(getPixel(bm, 5, 5), BLUE);
  const f = drawn(rect, 7, 5, 3, null, RED);
  assert.equal(pixelsOf(f, RED).size, 35);
  const clip = createBitmap(10, 10, WHITE);
  checkDirty(clip, (b) => rect(b, -5, -5, 4, 20, 2, BLACK, RED), 'clipped rect');
});

// ---------------------------------------------------------------------------
// Ellipses

test('ellipse is symmetric left/right and top/bottom for many sizes', () => {
  for (let W = 1; W <= 36; W++) {
    for (let H = 1; H <= 36; H++) {
      for (const w of [1, 2, 4]) {
        const s = isMirrorSymmetric(drawn(ellipse, W, H, w));
        assert.ok(s.lr && s.tb, `${W}x${H} width ${w}`);
      }
    }
  }
});

test('ellipse stays inside its box and touches all four sides', () => {
  for (let W = 1; W <= 30; W++) {
    for (let H = 1; H <= 30; H++) {
      const bm = drawn(ellipse, W, H, 1);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let y = 0; y < bm.h; y++) {
        for (let x = 0; x < bm.w; x++) {
          if (bm.data[y * bm.w + x] === WHITE) continue;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
      assert.deepEqual([minX, minY, maxX, maxY], [2, 2, 2 + W - 1, 2 + H - 1], `${W}x${H}`);
    }
  }
});

test('ellipse 1-pixel ring is closed, 8-connected and exactly the 4-boundary of the shape', () => {
  for (let W = 1; W <= 40; W++) {
    for (let H = 1; H <= 40; H++) {
      const bm = drawn(ellipse, W, H, 1);
      const ring = pixelsOf(bm, BLACK);
      const fill = pixelsOf(bm, RED);
      const shape = new Set([...ring, ...fill]);
      assert.ok(sameSet(ring, fourBoundary(shape)), `${W}x${H}: ring is the 4-boundary (no extra pixels)`);
      assert.ok(connected(ring, true), `${W}x${H}: ring 8-connected`);
      assert.ok(connected(shape, false), `${W}x${H}: shape 4-connected`);
      // Closed: no fill pixel touches the outside.
      for (const k of fill) {
        const [x, y] = k.split(',').map(Number) as [number, number];
        for (const n of [key(x + 1, y), key(x - 1, y), key(x, y + 1), key(x, y - 1)]) assert.ok(shape.has(n));
      }
    }
  }
});

test('ellipse 1-pixel ring is never 2 pixels thick along the axes or anywhere else', () => {
  // For any ellipse that is not more than twice as long as it is wide, the
  // curve is flat where it crosses the axes: one ring pixel at each end.
  for (let W = 3; W <= 70; W++) {
    for (let H = 3; H <= 70; H++) {
      if (Math.max(W, H) > 2 * Math.min(W, H)) continue;
      const bm = drawn(ellipse, W, H, 1);
      const at = (x: number, y: number): number => bm.data[(y + 2) * bm.w + x + 2] as number;
      const cols = W % 2 ? [(W - 1) / 2] : [W / 2 - 1, W / 2];
      const rows = H % 2 ? [(H - 1) / 2] : [H / 2 - 1, H / 2];
      for (const c of cols) {
        let n = 0;
        for (let y = 0; y < H; y++) if (at(c, y) === BLACK) n++;
        assert.equal(n, 2, `${W}x${H} column ${c}`);
      }
      for (const r of rows) {
        let n = 0;
        for (let x = 0; x < W; x++) if (at(x, r) === BLACK) n++;
        assert.equal(n, 2, `${W}x${H} row ${r}`);
      }
      for (let y = 0; y < H - 1; y++) {
        for (let x = 0; x < W - 1; x++) {
          const block = at(x, y) === BLACK && at(x + 1, y) === BLACK && at(x, y + 1) === BLACK && at(x + 1, y + 1) === BLACK;
          assert.ok(!block, `${W}x${H}: 2x2 block of ring pixels at ${x},${y}`);
        }
      }
    }
  }
});

test('thick ellipse rings are width pixels thick on the axes, closed and connected', () => {
  for (const [W, H] of [[30, 20], [41, 41], [60, 25], [17, 33], [100, 64]] as const) {
    for (const w of [2, 3, 5]) {
      const bm = drawn(ellipse, W, H, w);
      const ring = pixelsOf(bm, BLACK);
      const fill = pixelsOf(bm, RED);
      assert.ok(connected(ring, true), `${W}x${H} w${w} ring connected`);
      assert.ok(fill.size > 0);
      const shape = new Set([...ring, ...fill]);
      for (const k of fill) {
        const [x, y] = k.split(',').map(Number) as [number, number];
        for (const n of [key(x + 1, y), key(x - 1, y), key(x, y + 1), key(x, y - 1)]) assert.ok(shape.has(n));
      }
      const at = (x: number, y: number): number => bm.data[(y + 2) * bm.w + x + 2] as number;
      const cx = Math.floor((W - 1) / 2);
      const cy = Math.floor((H - 1) / 2);
      let top = 0;
      while (at(cx, top) === BLACK) top++;
      let left = 0;
      while (at(left, cy) === BLACK) left++;
      assert.equal(top, w, `${W}x${H} w${w} top thickness`);
      assert.equal(left, w, `${W}x${H} w${w} left thickness`);
    }
  }
});

test('fill-only ellipse covers the same shape as outline plus fill', () => {
  for (const [W, H] of [[9, 9], [10, 7], [33, 18], [2, 5], [1, 7]] as const) {
    const both = drawn(ellipse, W, H, 2);
    const only = drawn(ellipse, W, H, 2, null, BLUE);
    const shapeBoth = new Set([...pixelsOf(both, BLACK), ...pixelsOf(both, RED)]);
    assert.ok(sameSet(pixelsOf(only, BLUE), shapeBoth), `${W}x${H}`);
    const outlineOnly = createBitmap(W + 4, H + 4, WHITE);
    ellipse(outlineOnly, 2, 2, W + 1, H + 1, 1, BLACK, null);
    assert.equal(pixelsOf(outlineOnly, RED).size, 0);
  }
});

test('1-pixel-wide or -tall ellipses are lines; corner order does not matter', () => {
  for (let n = 1; n <= 12; n++) {
    assert.equal(pixelsOf(drawn(ellipse, 1, n, 1), BLACK).size, n, `1x${n}`);
    assert.equal(pixelsOf(drawn(ellipse, n, 1, 3), BLACK).size, n, `${n}x1`);
  }
  assert.equal(pixelsOf(drawn(ellipse, 2, 2, 1), BLACK).size, 4);
  const ref = createBitmap(30, 30, WHITE);
  ellipse(ref, 4, 6, 24, 19, 1, BLACK, RED);
  for (const [a, b, c, d] of [[24, 19, 4, 6], [4, 19, 24, 6], [24, 6, 4, 19]] as const) {
    const bm = createBitmap(30, 30, WHITE);
    ellipse(bm, a, b, c, d, 1, BLACK, RED);
    assert.deepEqual(bm.data, ref.data);
  }
});

test('ellipse W x H is the transpose of ellipse H x W (circles are diagonal-symmetric)', () => {
  for (const [W, H] of [[12, 12], [13, 13], [20, 9], [7, 30], [64, 40]] as const) {
    for (const w of [1, 3]) {
      const a = drawn(ellipse, W, H, w);
      const b = drawn(ellipse, H, W, w);
      for (let y = 0; y < a.h; y++) {
        for (let x = 0; x < a.w; x++) assert.equal(a.data[y * a.w + x], b.data[x * b.w + y]);
      }
    }
  }
});

test('ellipse clips, keeps dirty correct and is fast', () => {
  const bm = createBitmap(50, 40, WHITE);
  checkDirty(bm, (b) => ellipse(b, -30, -10, 35, 60, 3, BLACK, RED), 'clipped ellipse');
  checkDirty(bm, (b) => ellipse(b, 10, 10, 30, 25, 1, BLUE, null), 'ellipse outline');
  assert.doesNotThrow(() => ellipse(bm, 100, 100, 200, 200, 1, BLACK, RED));
  const big = createBitmap(1000, 1000, WHITE);
  ellipse(big, 0, 0, 999, 999, 1, BLACK, RED); // warm-up
  const t = performance.now();
  ellipse(big, 0, 0, 999, 999, 1, BLUE, WHITE);
  const ms = performance.now() - t;
  assert.ok(ms < 50, `1000x1000 ellipse took ${ms.toFixed(1)} ms`);
});

// ---------------------------------------------------------------------------
// Rounded rectangles

test('roundRect is symmetric and its thin ring is closed and 8-connected', () => {
  for (let W = 1; W <= 40; W += 3) {
    for (let H = 1; H <= 40; H += 2) {
      for (const r of [undefined, 0, 3, 6, 30]) {
        for (const w of [1, 2, 4]) {
          const bm = drawn(roundRect, W, H, w, BLACK, RED, r);
          const s = isMirrorSymmetric(bm);
          assert.ok(s.lr && s.tb, `${W}x${H} r${r} w${w} symmetric`);
          const ring = pixelsOf(bm, BLACK);
          assert.ok(connected(ring, true), `${W}x${H} r${r} w${w} ring connected`);
          const shape = new Set([...ring, ...pixelsOf(bm, RED)]);
          if (w === 1) assert.ok(sameSet(ring, fourBoundary(shape)), `${W}x${H} r${r} thin ring`);
        }
      }
    }
  }
});

test('roundRect radius 0 is a rect; a radius cuts the corners', () => {
  const a = drawn(roundRect, 20, 14, 2, BLACK, RED, 0);
  const b = drawn(rect, 20, 14, 2);
  assert.deepEqual(a.data, b.data);
  const c = drawn(roundRect, 20, 14, 1, BLACK, RED, 5);
  assert.equal(getPixel(c, 2, 2), WHITE, 'top-left corner is cut');
  assert.equal(getPixel(c, 21, 15), WHITE, 'bottom-right corner is cut');
  assert.equal(getPixel(c, 11, 2), BLACK, 'flat top edge is on the box');
  assert.equal(getPixel(c, 2, 8), BLACK, 'flat left edge is on the box');
});

test('roundRect default radius is about 1/8 of the shorter side, clamped to [2, 16]', () => {
  const same = (W: number, H: number, r: number): void => {
    const a = drawn(roundRect, W, H, 1, BLACK, RED);
    const b = drawn(roundRect, W, H, 1, BLACK, RED, r);
    assert.deepEqual(a.data, b.data, `${W}x${H} default radius ${r}`);
  };
  same(10, 12, 2); // 10/8 -> clamped up to 2
  same(80, 120, 10); // 80/8
  same(400, 300, 16); // 300/8 -> clamped down to 16
});

// ---------------------------------------------------------------------------
// Flood fill

test('floodFill fills an enclosed region only and marks it dirty', () => {
  const bm = createBitmap(20, 20, WHITE);
  rect(bm, 4, 4, 14, 12, 1, BLACK, null);
  checkDirty(bm, (b) => assert.equal(floodFill(b, 8, 8, RED), true), 'floodFill');
  assert.equal(pixelsOf(bm, RED).size, 9 * 7);
  assert.equal(getPixel(bm, 0, 0), WHITE);
  assert.deepEqual(bm.dirty, { x0: 5, y0: 5, x1: 13, y1: 11 });
});

test('floodFill does not leak through a one-pixel diagonal gap', () => {
  const bm = createBitmap(12, 12, WHITE);
  // A diagonal wall from top-right to bottom-left: 8-connected, but 4-tight.
  for (let i = 0; i < 12; i++) setPixel(bm, 11 - i, i, BLACK);
  assert.equal(floodFill(bm, 0, 0, RED), true);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const expected = x + y < 11 ? RED : x + y === 11 ? BLACK : WHITE;
      assert.equal(getPixel(bm, x, y), expected, `${x},${y}`);
    }
  }
});

test('floodFill returns false and changes nothing for the same colour or outside', () => {
  const bm = createBitmap(5, 5, WHITE);
  takeDirty(bm);
  assert.equal(floodFill(bm, 2, 2, WHITE), false);
  assert.equal(floodFill(bm, -1, 2, RED), false);
  assert.equal(floodFill(bm, 2, 5, RED), false);
  assert.ok(bm.data.every((v) => v === WHITE));
  assert.equal(bm.dirty, null);
});

test('floodFill handles 4000x4000 and a long serpentine without a stack overflow', () => {
  const big = createBitmap(4000, 4000, WHITE);
  takeDirty(big);
  assert.equal(floodFill(big, 1234, 2345, BLUE), true);
  assert.ok(big.data.every((v) => v === BLUE));
  assert.deepEqual(big.dirty, { x0: 0, y0: 0, x1: 3999, y1: 3999 });
  // Vertical walls with gaps at alternating ends: one long winding path.
  const n = 1000;
  const maze = createBitmap(n, n, WHITE);
  for (let x = 1; x < n; x += 2) {
    for (let y = 0; y < n; y++) setPixel(maze, x, y, BLACK);
    setPixel(maze, x, ((x - 1) / 2) % 2 === 0 ? n - 1 : 0, WHITE);
  }
  assert.equal(floodFill(maze, 0, 0, RED), true);
  assert.equal(pixelsOf(maze, WHITE).size, 0, 'every open pixel was reached');
});

// ---------------------------------------------------------------------------
// Colour eraser, airbrush

test('replaceColor changes only "from" pixels under the stamp', () => {
  const bm = createBitmap(10, 10, WHITE);
  rect(bm, 0, 0, 9, 9, 1, RED, BLUE);
  checkDirty(bm, (b) => replaceColor(b, 0, 0, stamps.square(5), RED, BLACK), 'replaceColor');
  // square(5) at (0,0) covers -2..2; inside the bitmap that is 0..2 x 0..2.
  for (let y = 0; y <= 2; y++) {
    for (let x = 0; x <= 2; x++) {
      const wasRed = x === 0 || y === 0;
      assert.equal(getPixel(bm, x, y), wasRed ? BLACK : BLUE);
    }
  }
  assert.equal(getPixel(bm, 3, 0), RED, 'outside the stamp untouched');
  const before = cloneBitmap(bm);
  takeDirty(bm);
  replaceColor(bm, 5, 5, stamps.square(3), BLUE, BLUE);
  replaceColor(bm, 5, 5, stamps.square(3), WHITE, BLACK);
  assert.deepEqual(bm.data, before.data);
});

test('spray stays inside the disc, is deterministic, and keeps dirty correct', () => {
  const run = (seed: number): Bitmap => {
    const bm = createBitmap(60, 60, WHITE);
    checkDirty(bm, (b) => spray(b, 30, 30, 8, 200, BLACK, mulberry32(seed)), 'spray');
    return bm;
  };
  const a = run(42);
  const b = run(42);
  const c = run(43);
  assert.deepEqual(a.data, b.data, 'same seed, same pixels');
  assert.notDeepEqual(a.data, c.data, 'different seed, different pixels');
  const painted = pixelsOf(a, BLACK);
  assert.ok(painted.size > 50 && painted.size <= 200);
  for (const k of painted) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    assert.ok((x - 30) ** 2 + (y - 30) ** 2 <= 64, `${k} inside the disc`);
  }
  // Roughly uniform: both halves of the disc get paint.
  let left = 0;
  for (const k of painted) if (Number(k.split(',')[0]) < 30) left++;
  assert.ok(left > painted.size * 0.25 && left < painted.size * 0.75);
});

test('spray edge cases: radius 0, clipping, and a degenerate random()', () => {
  const bm = createBitmap(10, 10, WHITE);
  spray(bm, 4, 4, 0, 10, RED, mulberry32(1));
  assert.ok(sameSet(pixelsOf(bm, RED), new Set(['4,4'])));
  checkDirty(bm, (b) => spray(b, 0, 0, 5, 100, BLUE, mulberry32(5)), 'spray at corner');
  assert.doesNotThrow(() => spray(bm, 5, 5, 3, 10, BLACK, () => 0.9999999));
});

// ---------------------------------------------------------------------------
// Constraints

test('constrainLine snaps to horizontal, vertical or 45 degrees in every direction', () => {
  assert.deepEqual(constrainLine(10, 10, 30, 13), [30, 10]);
  assert.deepEqual(constrainLine(10, 10, -5, 7), [-5, 10]);
  assert.deepEqual(constrainLine(10, 10, 12, 40), [10, 40]);
  assert.deepEqual(constrainLine(10, 10, 8, -20), [10, -20]);
  assert.deepEqual(constrainLine(10, 10, 20, 18), [19, 19]);
  assert.deepEqual(constrainLine(10, 10, 0, 0), [0, 0]);
  assert.deepEqual(constrainLine(10, 10, 0, 22), [-1, 21]);
  assert.deepEqual(constrainLine(10, 10, 21, -1), [21, -1]);
  assert.deepEqual(constrainLine(5, 5, 5, 5), [5, 5]);
  const rnd = mulberry32(9);
  for (let i = 0; i < 200; i++) {
    const x1 = Math.floor(rnd() * 200) - 100;
    const y1 = Math.floor(rnd() * 200) - 100;
    const [x, y] = constrainLine(0, 0, x1, y1);
    assert.ok(x === 0 || y === 0 || Math.abs(x) === Math.abs(y), `${x1},${y1} -> ${x},${y}`);
    if (x !== 0) assert.equal(Math.sign(x), Math.sign(x1));
    if (y !== 0) assert.equal(Math.sign(y), Math.sign(y1));
  }
});

test('constrainSquare makes the box square and keeps the drag direction', () => {
  assert.deepEqual(constrainSquare(10, 10, 20, 14), [20, 20]);
  assert.deepEqual(constrainSquare(10, 10, 4, 20), [0, 20]);
  assert.deepEqual(constrainSquare(10, 10, 14, 0), [20, 0]);
  assert.deepEqual(constrainSquare(10, 10, 7, 5), [5, 5]);
  assert.deepEqual(constrainSquare(3, 3, 3, 3), [3, 3]);
  const rnd = mulberry32(13);
  for (let i = 0; i < 200; i++) {
    const x1 = Math.floor(rnd() * 200) - 100;
    const y1 = Math.floor(rnd() * 200) - 100;
    const [x, y] = constrainSquare(0, 0, x1, y1);
    assert.equal(Math.abs(x), Math.abs(y));
    if (x1 !== 0) assert.equal(Math.sign(x), Math.sign(x1));
    if (y1 !== 0) assert.equal(Math.sign(y), Math.sign(y1));
  }
});

// ---------------------------------------------------------------------------
// Whole-image operations

function patterned(w: number, h: number, seed = 1): Bitmap {
  const bm = createBitmap(w, h, WHITE);
  const rnd = mulberry32(seed);
  for (let i = 0; i < bm.data.length; i++) bm.data[i] = rgb(rnd() * 256, rnd() * 256, rnd() * 256);
  return bm;
}

test('resizeCanvas crops and grows from the top-left', () => {
  const src = patterned(10, 8);
  const small = resizeCanvas(src, 4, 3, WHITE);
  assert.equal(small.w, 4);
  assert.equal(small.h, 3);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) assert.equal(getPixel(small, x, y), getPixel(src, x, y));
  const big = resizeCanvas(src, 15, 12, BLUE);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 15; x++) {
      assert.equal(getPixel(big, x, y), x < 10 && y < 8 ? getPixel(src, x, y) : BLUE);
    }
  }
  assert.deepEqual(big.dirty, { x0: 0, y0: 0, x1: 14, y1: 11 });
  const mixed = resizeCanvas(src, 5, 20, RED);
  assert.equal(getPixel(mixed, 4, 7), getPixel(src, 4, 7));
  assert.equal(getPixel(mixed, 4, 8), RED);
});

test('invert flips RGB, keeps alpha, and twice is the identity', () => {
  const bm = createBitmap(3, 1, BLACK);
  bm.data[1] = rgb(10, 20, 30);
  takeDirty(bm);
  invert(bm);
  assert.equal(getPixel(bm, 0, 0), WHITE);
  assert.deepEqual(toRGB(getPixel(bm, 1, 0) as number), [245, 235, 225]);
  assert.equal((getPixel(bm, 1, 0) as number) >>> 24, 255, 'alpha kept');
  assert.deepEqual(bm.dirty, { x0: 0, y0: 0, x1: 2, y1: 0 });
  const p = patterned(31, 17);
  const copy = cloneBitmap(p);
  invert(p);
  invert(p);
  assert.deepEqual(p.data, copy.data);
});

test('extract and restore round-trip, including a box partly outside', () => {
  const bm = patterned(20, 15);
  const box = { x0: 3, y0: 4, x1: 11, y1: 9 };
  const px = extract(bm, box);
  assert.equal(px.length, 9 * 6);
  assert.equal(px[0], getPixel(bm, 3, 4));
  assert.equal(px[9], getPixel(bm, 3, 5), 'row by row');
  const original = cloneBitmap(bm);
  rect(bm, 0, 0, 19, 14, 1, null, BLUE);
  checkDirty(bm, (b) => restore(b, box, px), 'restore');
  for (let y = 4; y <= 9; y++) for (let x = 3; x <= 11; x++) assert.equal(getPixel(bm, x, y), getPixel(original, x, y));
  assert.equal(getPixel(bm, 2, 4), BLUE);
  const edge = { x0: 15, y0: -3, x1: 24, y1: 2 };
  const ex = extract(original, edge);
  assert.equal(ex.length, 10 * 6);
  const target = createBitmap(20, 15, RED);
  restore(target, edge, ex);
  for (let y = 0; y <= 2; y++) for (let x = 15; x <= 19; x++) assert.equal(getPixel(target, x, y), getPixel(original, x, y));
  assert.equal(getPixel(target, 14, 0), RED);
});

test('flipH and flipV mirror the image and are their own inverses', () => {
  const bm = patterned(7, 5);
  const copy = cloneBitmap(bm);
  takeDirty(bm);
  flipH(bm);
  assert.deepEqual(bm.dirty, { x0: 0, y0: 0, x1: 6, y1: 4 });
  for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) assert.equal(getPixel(bm, x, y), getPixel(copy, 6 - x, y));
  flipH(bm);
  assert.deepEqual(bm.data, copy.data);
  flipV(bm);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) assert.equal(getPixel(bm, x, y), getPixel(copy, x, 4 - y));
  flipV(bm);
  assert.deepEqual(bm.data, copy.data);
  const even = patterned(4, 6, 2);
  const evenCopy = cloneBitmap(even);
  flipV(even);
  flipV(even);
  assert.deepEqual(even.data, evenCopy.data);
});

test('rotate turns clockwise and swaps width and height', () => {
  const bm = patterned(5, 3);
  const r90 = rotate(bm, 90);
  assert.equal(r90.w, 3);
  assert.equal(r90.h, 5);
  assert.equal(getPixel(r90, 2, 0), getPixel(bm, 0, 0), 'top-left goes to top-right');
  assert.equal(getPixel(r90, 0, 4), getPixel(bm, 4, 2), 'bottom-right goes to bottom-left');
  for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) assert.equal(getPixel(r90, 2 - y, x), getPixel(bm, x, y));
  const r270 = rotate(bm, 270);
  assert.equal(r270.w, 3);
  assert.equal(getPixel(r270, 0, 4), getPixel(bm, 0, 0), 'top-left goes to bottom-left');
  assert.deepEqual(r270.data, rotate(rotate(r90, 90), 90).data);
  const r180 = rotate(bm, 180);
  const flipped = cloneBitmap(bm);
  flipH(flipped);
  flipV(flipped);
  assert.deepEqual(r180.data, flipped.data);
  assert.deepEqual(r90.dirty, { x0: 0, y0: 0, x1: 2, y1: 4 }, 'a rotated bitmap is fully dirty');
});

test('rotate 90 four times is the identity', () => {
  for (const [w, h] of [[1, 1], [6, 4], [9, 13]] as const) {
    const bm = patterned(w, h, w * h);
    let r = bm;
    for (let i = 0; i < 4; i++) r = rotate(r, 90);
    assert.equal(r.w, w);
    assert.equal(r.h, h);
    assert.deepEqual(r.data, bm.data);
  }
});

// ---------------------------------------------------------------------------
// Dirty boxes across everything

test('dirty boxes cover every changed pixel for random operations', () => {
  const rnd = mulberry32(2024);
  const bm = createBitmap(64, 48, WHITE);
  const R = (n: number): number => Math.floor(rnd() * n) - 8;
  const colours = [BLACK, RED, BLUE, WHITE];
  const col = (): Color => colours[Math.floor(rnd() * colours.length)] as Color;
  const stampList = [stamps.dot, stamps.square(4), stamps.round(7), stamps.slash(5), stamps.backslash(3)];
  const st = (): Stamp => stampList[Math.floor(rnd() * stampList.length)] as Stamp;
  const ops: [string, () => (b: Bitmap) => void][] = [
    ['setPixel', () => { const x = R(80); const y = R(64); const c = col(); return (b) => setPixel(b, x, y, c); }],
    ['stampAt', () => { const x = R(80); const y = R(64); const s = st(); const c = col(); return (b) => stampAt(b, x, y, s, c); }],
    ['strokeLine', () => { const a = [R(80), R(64), R(80), R(64)] as const; const s = st(); const c = col(); return (b) => strokeLine(b, a[0], a[1], a[2], a[3], s, c); }],
    ['rect', () => { const a = [R(80), R(64), R(80), R(64)] as const; const w = 1 + Math.floor(rnd() * 4); const o = col(); const f = rnd() < 0.5 ? null : col(); return (b) => rect(b, a[0], a[1], a[2], a[3], w, o, f); }],
    ['ellipse', () => { const a = [R(80), R(64), R(80), R(64)] as const; const w = 1 + Math.floor(rnd() * 4); const o = rnd() < 0.3 ? null : col(); const f = col(); return (b) => ellipse(b, a[0], a[1], a[2], a[3], w, o, f); }],
    ['roundRect', () => { const a = [R(80), R(64), R(80), R(64)] as const; const w = 1 + Math.floor(rnd() * 4); const o = col(); const f = rnd() < 0.5 ? null : col(); return (b) => roundRect(b, a[0], a[1], a[2], a[3], w, o, f); }],
    ['floodFill', () => { const x = R(80); const y = R(64); const c = col(); return (b) => { floodFill(b, x, y, c); }; }],
    ['replaceColor', () => { const x = R(80); const y = R(64); const s = st(); const f = col(); const t = col(); return (b) => replaceColor(b, x, y, s, f, t); }],
    ['spray', () => { const x = R(80); const y = R(64); const c = col(); const seed = Math.floor(rnd() * 1e6); return (b) => spray(b, x, y, 6, 30, c, mulberry32(seed)); }],
    ['restore', () => { const box = { x0: R(80), y0: R(64), x1: R(80), y1: R(64) }; return (b) => { const px = extract(b, box); px.reverse(); restore(b, box, px); }; }],
    ['invert', () => (b) => invert(b)],
    ['flipH', () => (b) => flipH(b)],
    ['flipV', () => (b) => flipV(b)],
  ];
  for (let i = 0; i < 600; i++) {
    const [name, make] = ops[Math.floor(rnd() * ops.length)] as [string, () => (b: Bitmap) => void];
    checkDirty(bm, make(), `${name} #${i}`);
  }
});


// --- degenerate input (found by the independent engine check) ----------------

test('non-finite coordinates are ignored, never hang and never poison the dirty box', () => {
  const bm = R.createBitmap(20, 20, 0xffffffff);
  R.takeDirty(bm);
  let calls = 0;
  R.bresenham(0, 0, Infinity, 0, () => calls++);
  R.bresenham(5, 5, NaN, 5, () => calls++);
  assert.equal(calls, 0);
  R.strokeLine(bm, 5, 5, NaN, NaN, R.stamps.dot, 1);
  R.strokeLine(bm, -Infinity, 3, 4, 3, R.stamps.square(3), 1);
  R.stampAt(bm, NaN, 4, R.stamps.square(3), 1);
  R.setPixel(bm, NaN, 3, 1);
  R.markDirty(bm, { x0: NaN, y0: 1, x1: 5, y1: 5 });
  assert.equal(bm.dirty, null);
  R.setPixel(bm, 2, 2, 1);
  R.rect(bm, 10, 10, 15, 15, 1, 1, null);
  const d = R.takeDirty(bm)!;
  assert.ok(d.x0 <= 2 && d.y0 <= 2 && d.x1 >= 15 && d.y1 >= 15, JSON.stringify(d));
});

test('a huge, mostly off-picture line is fast, works both ways and matches the visible part', () => {
  for (const stamp of [R.stamps.dot, R.stamps.square(8)]) {
    const a = R.createBitmap(100, 100, 0xffffffff);
    const b = R.createBitmap(100, 100, 0xffffffff);
    const t = Date.now();
    R.strokeLine(a, -5e7, 50, 5e7, 50, stamp, 1);
    R.strokeLine(b, 5e7, 50, -5e7, 50, stamp, 1);
    assert.ok(Date.now() - t < 200, 'took too long');
    assert.deepEqual(a.data, b.data);
    const c = R.createBitmap(100, 100, 0xffffffff);
    R.strokeLine(c, -10, 50, 110, 50, stamp, 1);
    assert.deepEqual(a.data, c.data);
  }
});
