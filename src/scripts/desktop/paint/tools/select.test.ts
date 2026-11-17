// Tests for the pure helpers of tools/select.ts. Run from the repo root:
//   node --test "src/scripts/desktop/paint/tools/select.test.ts"
// select.ts is written for Vite (extensionless imports, a CSS import), so a
// small resolve hook maps those for Node before it is loaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.css')) return { url: 'data:text/javascript,', shortCircuit: true };
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const R = await import('../raster.ts');
const S = await import('./select.ts');

type Box = { x0: number; y0: number; x1: number; y1: number };
const W = R.rgb(255, 255, 255);
const K = R.rgb(0, 0, 0);
const RED = R.rgb(255, 0, 0);
const BLUE = R.rgb(0, 0, 255);

/** a mask as rows of '#' and '.' */
const rows = (mask: Uint8Array, w: number) => {
  const out: string[] = [];
  for (let i = 0; i < mask.length; i += w) out.push([...mask.subarray(i, i + w)].map((v) => (v ? '#' : '.')).join(''));
  return out;
};

test('spanBox and within: corners in any order, inclusive', () => {
  assert.deepEqual(S.spanBox({ x: 5, y: 1 }, { x: 2, y: 4 }), { x0: 2, y0: 1, x1: 5, y1: 4 });
  assert.deepEqual(S.spanBox({ x: 3, y: 3 }, { x: 3, y: 3 }), { x0: 3, y0: 3, x1: 3, y1: 3 });
  const b: Box = { x0: 2, y0: 1, x1: 5, y1: 4 };
  assert.ok(S.within(b, { x: 2, y: 1 }) && S.within(b, { x: 5, y: 4 }));
  assert.ok(!S.within(b, { x: 6, y: 4 }) && !S.within(b, { x: 2, y: 0 }));
  assert.equal(S.sizeOf(b), '4x4');
});

test('polygonMask: a closed square path fills the whole square', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ];
  const box = { x0: 0, y0: 0, x1: 4, y1: 3 };
  assert.deepEqual(rows(S.polygonMask(pts, box), 5), ['#####', '#####', '#####', '#####']);
});

test('polygonMask: a triangle keeps its outline and its inside, nothing else', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 6, y: 6 },
    { x: 0, y: 6 },
  ];
  const box = { x0: 0, y0: 0, x1: 6, y1: 6 };
  assert.deepEqual(rows(S.polygonMask(pts, box), 7), ['#......', '##.....', '###....', '####...', '#####..', '######.', '#######']);
});

test('polygonMask: a path with no area keeps the pixels it passed over', () => {
  const pts = [
    { x: 1, y: 1 },
    { x: 5, y: 1 },
  ];
  const box = { x0: 0, y0: 0, x1: 6, y1: 2 };
  assert.deepEqual(rows(S.polygonMask(pts, box), 7), ['.......', '.#####.', '.......']);
});

test('polygonMask: even-odd, so where a path crosses itself the middle is out', () => {
  // a pentagram: its inner pentagon is crossed twice
  const c = 20;
  const pts = [0, 2, 4, 1, 3].map((k) => {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
    return { x: Math.round(c + 18 * Math.cos(a)), y: Math.round(c + 18 * Math.sin(a)) };
  });
  const box = { x0: 0, y0: 0, x1: 40, y1: 40 };
  const m = S.polygonMask(pts, box);
  const at = (x: number, y: number) => m[y * 41 + x];
  assert.equal(at(c, c), 0, 'centre of the star is outside (crossed twice)');
  assert.equal(at(c, 6), 1, 'top point is inside');
  assert.equal(at(1, 1), 0, 'corner is outside');
});

test('polygonMask: points outside the box are clipped, the shape is not', () => {
  const pts = [
    { x: -10, y: -10 },
    { x: 10, y: -10 },
    { x: 10, y: 10 },
    { x: -10, y: 10 },
  ];
  const box = { x0: 0, y0: 0, x1: 3, y1: 2 };
  assert.deepEqual(rows(S.polygonMask(pts, box), 4), ['####', '####', '####']);
  assert.equal(S.polygonMask(pts, { x0: 2, y0: 2, x1: 1, y1: 1 }).length, 0);
});

test('maskBounds and cropMask', () => {
  const box = { x0: 10, y0: 20, x1: 14, y1: 22 };
  const mask = new Uint8Array([0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0]);
  const b = S.maskBounds(mask, box)!;
  assert.deepEqual(b, { x0: 11, y0: 21, x1: 12, y1: 22 });
  assert.deepEqual([...S.cropMask(mask, box, b)!], [1, 1, 1, 0]);
  assert.equal(S.maskBounds(new Uint8Array(15), box), null);
  // a crop that is all set needs no mask
  assert.equal(S.cropMask(mask, box, { x0: 11, y0: 21, x1: 12, y1: 21 }), null);
});

test('liftPixels: outside the mask and outside the picture get alpha 0', () => {
  const bm = R.createBitmap(4, 3, W);
  R.setPixel(bm, 3, 2, RED);
  const f = S.liftPixels(bm, { x0: 2, y0: 1, x1: 4, y1: 2 }, null);
  assert.equal(f.w, 3);
  assert.equal(f.h, 2);
  assert.deepEqual([...f.data], [W, W, 0, W, RED, 0]);
  const g = S.liftPixels(bm, { x0: 2, y0: 1, x1: 3, y1: 2 }, new Uint8Array([1, 0, 0, 1]));
  assert.deepEqual([...g.data], [W, 0, 0, RED]);
});

test('fillShape fills only the shape, clipped, and reports the box', () => {
  const bm = R.createBitmap(4, 4, K);
  R.takeDirty(bm);
  const shape = { w: 2, h: 2, data: new Uint32Array([RED, 0, 0, RED]), dirty: null };
  assert.deepEqual(S.fillShape(bm, shape, 1, 1, W), { x0: 1, y0: 1, x1: 2, y1: 2 });
  assert.equal(R.getPixel(bm, 1, 1), W);
  assert.equal(R.getPixel(bm, 2, 1), K);
  assert.equal(R.getPixel(bm, 1, 2), K);
  assert.equal(R.getPixel(bm, 2, 2), W);
  assert.deepEqual(bm.dirty, { x0: 1, y0: 1, x1: 2, y1: 2 });
  // partly outside: clipped
  assert.deepEqual(S.fillShape(bm, shape, 3, 3, BLUE), { x0: 3, y0: 3, x1: 3, y1: 3 });
  assert.equal(R.getPixel(bm, 3, 3), BLUE);
  // wholly outside: nothing
  assert.equal(S.fillShape(bm, shape, -5, 0, BLUE), null);
});

test('stampFloat: opaque, transparent, shape and clipping', () => {
  const f = { w: 3, h: 1, data: new Uint32Array([RED, W, 0]), dirty: null };
  const bm = R.createBitmap(3, 2, BLUE);
  // opaque: white is drawn, the alpha-0 pixel is not
  S.stampFloat(bm, f, 0, 0, null);
  assert.deepEqual([...bm.data.subarray(0, 3)], [RED, W, BLUE]);
  // transparent with a white background: white is see-through
  S.stampFloat(bm, f, 0, 1, W);
  assert.deepEqual([...bm.data.subarray(3, 6)], [RED, BLUE, BLUE]);
  // partly off the left edge
  const bm2 = R.createBitmap(3, 1, BLUE);
  assert.deepEqual(S.stampFloat(bm2, f, -1, 0, null), { x0: 0, y0: 0, x1: 1, y1: 0 });
  assert.deepEqual([...bm2.data], [W, BLUE, BLUE]);
  assert.equal(S.stampFloat(bm2, f, 0, 5, null), null);
});

test('stampFloat writes opaque pixels even from partly transparent floating pixels', () => {
  const semi = (RED & 0xffffff) | (0x80 << 24);
  const f = { w: 1, h: 1, data: new Uint32Array([semi >>> 0]), dirty: null };
  const bm = R.createBitmap(1, 1, W);
  S.stampFloat(bm, f, 0, 0, null);
  assert.equal(bm.data[0], RED);
});

test('showPixels hides what stampFloat would skip', () => {
  const f = { w: 3, h: 1, data: new Uint32Array([RED, W, 0]), dirty: null };
  assert.deepEqual([...S.showPixels(f, null)], [RED, W, 0]);
  assert.deepEqual([...S.showPixels(f, W)], [RED, 0, 0]);
});

test('a lifted free-form shape survives flips and rotations (it lives in alpha)', () => {
  const bm = R.createBitmap(3, 2, W);
  R.setPixel(bm, 0, 0, RED);
  // an L-shaped mask: (0,0), (0,1), (1,1)
  const f = S.liftPixels(bm, { x0: 0, y0: 0, x1: 1, y1: 1 }, new Uint8Array([1, 0, 1, 1]));
  const r = R.rotate(f, 90);
  // (x, y) -> (h - 1 - y, x): (0,0) -> (1,0), (0,1) -> (0,0), (1,1) -> (0,1); (1,0) -> (1,1) is out
  assert.deepEqual([...r.data], [W, RED, W, 0]);
  R.invert(r);
  assert.equal(r.data[3] >>> 24, 0, 'invert keeps alpha, so the shape too');
  const out = R.createBitmap(2, 2, BLUE);
  S.stampFloat(out, r, 0, 0, null);
  assert.equal(out.data[3], BLUE);
});

test('fromRGBA: transparent pixels are outside the shape, the rest is laid over white', () => {
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 128]);
  const b = S.fromRGBA(rgba, 3, 1);
  assert.equal(b.data[0], RED);
  assert.equal(b.data[1], 0);
  assert.equal(b.data[2], R.rgb(127, 127, 127));
  // nothing opaque at all: the whole image over white
  const clear = S.fromRGBA(new Uint8Array([0, 0, 0, 0, 10, 10, 10, 0]), 2, 1);
  assert.deepEqual([...clear.data], [W, W]);
});

test('pngName cleans a typed name', () => {
  assert.equal(S.pngName('  my picture.bmp '), 'my picture.png');
  assert.equal(S.pngName('a/b\\c:d*?"<>|'), 'abcd.png');
  assert.equal(S.pngName(''), 'untitled.png');
  assert.equal(S.pngName('dots...'), 'dots.png');
  assert.equal(S.pngName('x'.repeat(300)).length, 104);
});

test('sameIn compares only inside the box', () => {
  const a = R.createBitmap(3, 3, W);
  const b = R.cloneBitmap(a);
  R.setPixel(b, 2, 2, RED);
  assert.ok(S.sameIn(a, b, { x0: 0, y0: 0, x1: 1, y1: 1 }));
  assert.ok(!S.sameIn(a, b, { x0: 0, y0: 0, x1: 2, y1: 2 }));
  assert.ok(!S.sameIn(a, R.createBitmap(2, 3, W), { x0: 0, y0: 0, x1: 0, y1: 0 }));
});
