// @ts-nocheck: original 2026 engine, kept verbatim
/*
 * Sketch-face engine, lifted from the first version of this site (Aug 2026).
 * Every drawing routine below is the original code; only the palette became
 * swappable and the page-filling "doodle sheet" renderer was replaced by
 * drawFace(), which draws one face into a transparent canvas.
 *
 * Do not reorder RNG calls inside the generators: a seed must keep drawing
 * the same face.
 */
/* eslint-disable */


let ctx = null;          // set by drawFace()
const TAU    = Math.PI * 2;

/* ── Seeded PRNG (mulberry32) ─────────────────────────────────── */
function mkRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let R  = Math.random;   // active random stream — swapped per doodle
let SC = 1;             // active pen scale — tracks doodle size
let PEN = 1;            // stroke-width multiplier for tiny icons; never touches the RNG

const rnd    = (a, b) => a + R() * (b - a);
const pick   = a => a[(R() * a.length) | 0];
const chance = p => R() < p;

/* ── Palette ──────────────────────────────────────────────────── */
let PAPER = '#e2dacd';
let INK = '#20180f';
let DARK = '#2a1c12';
let PALE = '#f2e8d8';
let PINK = '#e0a49c';

let SKIN = ['#e9c9a4', '#dfae82', '#c98f63', '#f0dcb6', '#e8b995', '#b57a51', '#d9a887'];
let HAIR = ['#241b12', '#241b12', '#241b12', '#302416', '#4a3520', '#6b4c30', '#8d5a32',
              '#b9ad99', '#cfc4b0'];
let HAT = ['#5b7c96', '#4d7a58', '#7f7f6d', '#43371f', '#7a5340', '#5d6f6e', '#8a5b52'];

let FUR = {
  fox:   ['#d9884a', '#c9793f', '#e0955c'],
  dog:   ['#c9a06a', '#8b6b4a', '#ddd2bf', '#4c4238', '#b5764a'],
  cat:   ['#9c9287', '#c9925c', '#3d382f', '#e2d8c8', '#7d6a55'],
  mouse: ['#b8b0a4', '#cfc6b8', '#9a8f80'],
  deer:  ['#c08a5a', '#b07a4c', '#a98963'],
  bear:  ['#7b573a', '#4f3c2a', '#a8825a'],
  ant:   ['#4a3a2a', '#7a4a2a', '#362b20'],
  wing:  ['#d9884a', '#c96a5a', '#5b7c96', '#7a6a9a', '#4d7a58', '#d4a94a']
};

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/* ══════════════════════════════════════════════════════════════
   Path plumbing — every shape is a point list, smoothed on trace
   ══════════════════════════════════════════════════════════════ */
function tracePath(p) {
  const n = p.length;
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  if (n === 2) { ctx.lineTo(p[1][0], p[1][1]); return; }
  for (let i = 1; i < n - 1; i++) {
    ctx.quadraticCurveTo(p[i][0], p[i][1],
                         (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
  }
  ctx.lineTo(p[n - 1][0], p[n - 1][1]);
}

function traceClosed(p) {
  const n = p.length;
  ctx.beginPath();
  ctx.moveTo((p[n - 1][0] + p[0][0]) / 2, (p[n - 1][1] + p[0][1]) / 2);
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  ctx.closePath();
}

function jitter(p, amt) {
  const out = new Array(p.length);
  for (let i = 0; i < p.length; i++) {
    out[i] = [p[i][0] + (R() - .5) * amt, p[i][1] + (R() - .5) * amt];
  }
  return out;
}

/* Multi-pass stroke — the lighter second pass is what reads as pen. */
function ink(pts, o) {
  o = o || {};
  const passes = o.passes == null ? 2 : o.passes;
  const amt    = (o.j == null ? 1 : o.j) * SC;
  const w      = (o.w == null ? 1.15 : o.w) * SC * PEN;
  const base   = o.a == null ? 1 : o.a;
  ctx.strokeStyle = o.c || INK;
  for (let k = 0; k < passes; k++) {
    ctx.lineWidth   = w * (k ? .78 : 1);
    ctx.globalAlpha = base * (k ? .42 : 1);
    const jp = amt > 0 ? jitter(pts, amt) : pts;
    if (o.close) traceClosed(jp); else tracePath(jp);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function fillPts(p, col, a) {
  ctx.save();
  ctx.globalAlpha = a == null ? 1 : a;
  ctx.fillStyle = col;
  traceClosed(p); ctx.fill();
  ctx.restore();
}

function dot(x, y, r, col, a) {
  ctx.save();
  ctx.globalAlpha = a == null ? 1 : a;
  ctx.fillStyle = col || INK;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
}

function bbox(p) {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (let i = 0; i < p.length; i++) {
    if (p[i][0] < a) a = p[i][0];
    if (p[i][1] < b) b = p[i][1];
    if (p[i][0] > c) c = p[i][0];
    if (p[i][1] > d) d = p[i][1];
  }
  return [a, b, c, d];
}

function shrink(p, k, dx, dy) {
  const b = bbox(p), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  return p.map(q => [cx + (q[0] - cx) * k + (dx || 0), cy + (q[1] - cy) * k + (dy || 0)]);
}

/* ── Shape generators ─────────────────────────────────────────── */

/* Lumpy silhouette: ellipse + three harmonics + optional squareness */
function blob(cx, cy, rx, ry, sq, n) {
  const N  = n || 34;
  const k1 = (R() - .5) * .17, k2 = (R() - .5) * .13, k3 = (R() - .5) * .085;
  const p1 = R() * TAU, p2 = R() * TAU, p3 = R() * TAU;
  const e  = sq ? 1 - sq * .45 : 1;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    let c = Math.cos(a), s = Math.sin(a);
    if (sq) {
      c = Math.sign(c) * Math.pow(Math.abs(c), e);
      s = Math.sign(s) * Math.pow(Math.abs(s), e);
    }
    const m = 1 + k1 * Math.sin(2 * a + p1) + k2 * Math.sin(3 * a + p2) + k3 * Math.sin(5 * a + p3);
    pts.push([cx + c * rx * m, cy + s * ry * m]);
  }
  return pts;
}

function arcPts(cx, cy, rx, ry, a0, a1, n) {
  n = n || 14;
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    p.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return p;
}

/* Top-of-head cap, cut at height `cut` (fraction of ry above centre) */
function capShape(rx, ry, cut, n) {
  const b  = Math.asin(Math.max(-.92, Math.min(.92, cut)));
  const t0 = -b, t1 = -Math.PI + b;
  const N  = n || 22, p = [];
  for (let i = 0; i <= N; i++) {
    const t = t0 + (t1 - t0) * (i / N);
    p.push([Math.cos(t) * rx, Math.sin(t) * ry]);
  }
  return p;
}

/* ── Fill textures ────────────────────────────────────────────── */

/* Colour patch, deliberately mis-registered against the ink line */
function wash(pts, col, alpha) {
  const b  = bbox(pts);
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  const dx = rnd(-.10, .10) * (b[2] - b[0]);
  const dy = rnd(-.10, .10) * (b[3] - b[1]);
  const s  = rnd(.93, 1.09);
  const p2 = pts.map(p => [
    cx + (p[0] - cx) * s + dx + (R() - .5) * 3 * SC,
    cy + (p[1] - cy) * s + dy + (R() - .5) * 3 * SC
  ]);
  fillPts(p2, col, alpha == null ? rnd(.6, .84) : alpha);
  return p2;
}

function hatchIn(pts, ang, gap, col, a, w) {
  ctx.save();
  traceClosed(pts); ctx.clip();
  const b   = bbox(pts);
  const cx  = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  const rad = Math.hypot(b[2] - b[0], b[3] - b[1]) / 2 + 3;
  const ux  = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
  for (let d = -rad; d <= rad; d += gap) {
    const px = cx + vx * d, py = cy + vy * d;
    const wob = (R() - .5) * gap * .35;
    ink([[px - ux * rad, py - uy * rad + wob],
         [px, py],
         [px + ux * rad, py + uy * rad - wob]],
        { w: w, passes: 1, j: .6, c: col, a: a });
  }
  ctx.restore();
}

function stippleIn(pts, n, col, rmin, rmax) {
  ctx.save();
  traceClosed(pts); ctx.clip();
  const b = bbox(pts);
  ctx.fillStyle = col;
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = rnd(.4, .95);
    ctx.beginPath();
    ctx.arc(rnd(b[0], b[2]), rnd(b[1], b[3]), rnd(rmin, rmax) * SC, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════
   Human features
   ══════════════════════════════════════════════════════════════ */

function drawEye(x, y, r, style) {
  if (style === 0) {                                   // plain dot
    dot(x, y, r * .40, INK);
  } else if (style === 1) {                            // ring + pupil
    ink(blob(x, y, r, r * .92, 0, 14), { close: true, w: 1, j: .7 });
    dot(x + rnd(-.25, .25) * r, y + rnd(-.25, .25) * r, r * .34, INK);
  } else if (style === 2) {                            // wide stare
    ink(blob(x, y, r * 1.28, r * .95, 0, 16), { close: true, w: 1, j: .7 });
    dot(x + rnd(-.35, .35) * r, y - r * .12, r * .30, INK);
  } else if (style === 3) {                            // shut, lashes
    ink(arcPts(x, y, r * 1.05, r * .8, Math.PI, Math.PI * 2, 10), { w: 1.05, j: .7 });
    if (chance(.5)) for (let i = -1; i <= 1; i++)
      ink([[x + i * r * .55, y - r * .55], [x + i * r * .7, y - r * .95]], { w: .8, passes: 1 });
  } else if (style === 4) {                            // heavy lower lid
    ink(arcPts(x, y, r * 1.05, r * .8, 0, Math.PI, 10), { w: 1.05, j: .7 });
    dot(x, y + r * .3, r * .26, INK);
  } else if (style === 5) {                            // scribbled out
    const s = r * .78;
    ink([[x - s, y - s], [x + s, y + s]], { w: 1, j: .8 });
    ink([[x + s, y - s], [x - s, y + s]], { w: 1, j: .8 });
  } else {                                             // hooded
    ink([[x - r * 1.15, y - r * .28], [x, y - r * .66], [x + r * 1.15, y - r * .26]], { w: 1.2, j: .7 });
    dot(x, y + r * .1, r * .30, INK);
  }
}

function drawNose(hw, hh, sz, style) {
  const ny = hh * rnd(.02, .18);
  if (style === 0) {                                   // long hook
    const x0 = rnd(-.12, .12) * hw;
    ink([[x0, -hh * .20], [x0 - hw * .12, ny * .45], [x0 - hw * .08, ny],
         [x0 + hw * .24, ny + sz * .012]], { w: 1.15 });
  } else if (style === 1) {                            // wedge
    ink([[0, -hh * .14], [-hw * .28, ny], [hw * .12, ny + sz * .008]], { w: 1.15 });
    ink([[-hw * .28, ny], [-hw * .14, ny + sz * .032]], { w: 1, passes: 1 });
  } else if (style === 2) {                            // bulb + nostrils
    ink(blob(0, ny, hw * .21, hh * .16, 0, 12), { close: true, w: 1.05 });
    dot(-hw * .13, ny + hh * .05, sz * .011, INK);
    dot(hw * .13, ny + hh * .05, sz * .011, INK);
  } else if (style === 3) {                            // shallow V
    ink([[-hw * .18, ny - hh * .11], [0, ny], [hw * .18, ny - hh * .11]], { w: 1.1 });
  } else {                                             // ridge + curl
    ink([[0, -hh * .22], [hw * .04, ny * .6], [0, ny]], { w: 1.1 });
    ink(arcPts(-hw * .08, ny, hw * .10, hh * .07, -.3, Math.PI * .9, 8), { w: 1, passes: 1 });
  }
}

function drawMouth(hw, hh, sz, style) {
  const my = hh * rnd(.36, .56);
  const mw = hw * rnd(.26, .48);
  if (style === 0) {
    ink([[-mw, my], [0, my + rnd(-1.4, 1.4) * SC], [mw, my]], { w: 1.15 });
  } else if (style === 1) {
    ink(arcPts(0, my - sz * .02, mw, sz * .05, .25, Math.PI - .25, 10), { w: 1.2 });
  } else if (style === 2) {
    ink(arcPts(0, my + sz * .04, mw, sz * .05, -Math.PI + .25, -.25, 10), { w: 1.2 });
  } else if (style === 3) {                            // open, dark
    const o = blob(0, my, mw * .52, sz * .045, 0, 12);
    fillPts(o, DARK, .88);
    ink(o, { close: true, w: 1.05 });
  } else if (style === 4) {                            // squiggle
    const p = [];
    for (let i = 0; i <= 6; i++) p.push([-mw + (i / 6) * mw * 2, my + (i % 2 ? 1 : -1) * sz * .015]);
    ink(p, { w: 1.05 });
  } else {                                             // teeth
    const o = [[-mw, my - sz * .028], [mw, my - sz * .028],
               [mw, my + sz * .028], [-mw, my + sz * .028]];
    ink(o, { close: true, w: 1.05, j: .7 });
    for (let i = 1; i < 3; i++) {
      const gx = -mw + (i / 3) * mw * 2;
      ink([[gx, my - sz * .028], [gx, my + sz * .028]], { w: .75, passes: 1 });
    }
  }
}

function drawHair(hw, hh, sz, col) {
  const light   = lum(col) > .55;
  const outline = () => light ? INK : col;
  const style   = (R() * 9) | 0;

  if (style === 0 || style === 1) {                    // hatched cap
    const cap = capShape(hw * 1.04, hh * 1.06, rnd(.02, .42));
    hatchIn(cap, rnd(1.25, 1.9), rnd(1.8, 3.2) * SC, col, light ? .55 : .85, .75);
    ink(cap, { close: true, w: .95, j: 1.3, c: outline(), a: .9 });
  } else if (style === 2) {                            // solid crop
    const cap = capShape(hw * 1.05, hh * 1.08, rnd(.05, .35));
    fillPts(cap, col, light ? .5 : .92);
    ink(cap, { close: true, w: 1, j: 1.4, c: outline() });
    for (let i = 0; i < 8; i++) {                      // ragged edge
      const t  = rnd(-Math.PI * .95, -Math.PI * .05);
      const bx = Math.cos(t) * hw * 1.05, by = Math.sin(t) * hh * 1.08;
      ink([[bx, by], [bx + Math.cos(t) * rnd(2, 6) * SC, by + Math.sin(t) * rnd(2, 6) * SC]],
          { w: .8, passes: 1, c: outline() });
    }
  } else if (style === 3) {                            // spikes
    const n = 9 + ((R() * 8) | 0);
    for (let i = 0; i < n; i++) {
      const t  = -Math.PI * .97 + (i / (n - 1)) * Math.PI * .94;
      const bx = Math.cos(t) * hw * .94, by = Math.sin(t) * hh * .94;
      const ln = rnd(5, 15) * SC;
      const sa = t + rnd(-.45, .45);
      ink([[bx, by],
           [bx + Math.cos(sa) * ln * .5, by + Math.sin(sa) * ln * .5 - ln * .1],
           [bx + Math.cos(sa) * ln, by + Math.sin(sa) * ln - ln * .18]],
          { w: rnd(.8, 1.3), passes: 1, c: outline() });
    }
  } else if (style === 4) {                            // curls
    const n = 13 + ((R() * 9) | 0);
    for (let i = 0; i < n; i++) {
      const t  = -Math.PI * 1.02 + (i / (n - 1)) * Math.PI * 1.04;
      const bx = Math.cos(t) * hw * rnd(.95, 1.08) + rnd(-3, 3) * SC;
      const by = Math.sin(t) * hh * rnd(.95, 1.08) + rnd(-3, 3) * SC;
      ink(blob(bx, by, rnd(2.2, 4.6) * SC, rnd(2, 4) * SC, 0, 9),
          { close: true, w: .85, passes: 1, j: .5, c: outline() });
    }
  } else if (style === 5) {                            // side-swept
    const p = [[-hw * 1.02, -hh * .32], [-hw * .6, -hh * 1.14], [hw * .35, -hh * 1.2],
               [hw * 1.0, -hh * .5], [hw * .55, -hh * .72], [-hw * .1, -hh * .52],
               [-hw * .55, -hh * .74]];
    fillPts(p, col, light ? .5 : .9);
    ink(p, { close: true, w: 1, j: 1.2, c: outline() });
  } else if (style === 6) {                            // receding, side tufts
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const t  = sd < 0 ? rnd(-Math.PI, -Math.PI * .62) : rnd(-Math.PI * .38, 0);
        const bx = Math.cos(t) * hw * .95, by = Math.sin(t) * hh * .95;
        ink([[bx, by], [bx + Math.cos(t) * rnd(3, 8) * SC, by + Math.sin(t) * rnd(3, 8) * SC]],
            { w: .85, passes: 1, c: outline() });
      }
    }
  } else if (style === 7) {                            // wavy strands
    const n = 7;
    for (let i = 0; i < n; i++) {
      const wx = -hw + (i / (n - 1)) * hw * 2;
      const wy = -hh * Math.sqrt(Math.max(0, 1 - Math.pow(wx / (hw * 1.05), 2))) * 1.02;
      const p  = [[wx, wy]];
      let px = wx, py = wy;
      for (let j = 0; j < 4; j++) {
        px += rnd(-4, 4) * SC;
        py -= rnd(2.5, 5) * SC;
        p.push([px, py]);
      }
      ink(p, { w: .95, passes: 1, j: .8, c: outline() });
    }
  } else {                                             // tuft / mohawk
    const cap = capShape(hw * 1.02, hh * 1.04, rnd(.3, .55));
    hatchIn(cap, 1.57, 2.4 * SC, col, light ? .5 : .8, .7);
    for (let i = -3; i <= 3; i++) {
      const mx = i * hw * .13;
      ink([[mx, -hh * .82], [mx + rnd(-2, 2) * SC, -hh * 1.02 - rnd(4, 12) * SC]],
          { w: 1, passes: 1, c: outline() });
    }
  }
}

function drawHat(hw, hh, sz) {
  const col = pick(HAT);
  const t   = (R() * 4) | 0;

  if (t === 0) {                                       // beanie
    const cap = capShape(hw * 1.09, hh * 1.16, rnd(-.12, .06));
    fillPts(cap, col, .9);
    ink(cap, { close: true, w: 1.25 });
    const y = -hh * rnd(.05, .3);
    ink([[-hw * 1.05, y], [0, y + rnd(-2, 2) * SC], [hw * 1.05, y]], { w: 2.4 });
    if (chance(.4)) dot(0, -hh * 1.2, sz * .028, col, .95);
  } else if (t === 1) {                                // flat cap + peak
    const cap = capShape(hw * 1.06, hh * 1.1, rnd(.05, .25));
    fillPts(cap, col, .9);
    hatchIn(cap, rnd(.5, 1.1), 4 * SC, INK, .18, .7);
    ink(cap, { close: true, w: 1.25 });
    const sd = chance(.5) ? -1 : 1;
    const y  = -hh * rnd(.12, .3);
    const peak = [[sd * hw * .9, y], [sd * hw * 1.42, y + hh * .1], [sd * hw * .85, y + hh * .2]];
    fillPts(peak, col, .92);
    ink(peak, { close: true, w: 1.15 });
  } else if (t === 2) {                                // headband
    const y = -hh * rnd(.3, .55);
    const band = [[-hw * 1.04, y], [0, y - hh * .07], [hw * 1.04, y],
                  [hw * 1.02, y + hh * .2], [0, y + hh * .13], [-hw * 1.02, y + hh * .2]];
    fillPts(band, col, .9);
    ink(band, { close: true, w: 1.15 });
  } else {                                             // brimmed
    const cap = capShape(hw * .92, hh * 1.14, rnd(-.05, .12));
    fillPts(cap, col, .9);
    ink(cap, { close: true, w: 1.2 });
    const y = -hh * rnd(.05, .2);
    ink([[-hw * 1.3, y], [0, y + rnd(1, 3) * SC], [hw * 1.3, y]], { w: 1.8 });
  }
}

function human(sz) {
  const hw = sz * rnd(.30, .40);
  const hh = sz * rnd(.34, .46);
  const head    = blob(0, 0, hw, hh, chance(.42) ? rnd(.35, .95) : 0);
  const skin    = chance(.62) ? pick(SKIN) : null;
  const hairCol = pick(HAIR);

  if (skin) wash(head, skin);

  /* ears */
  for (const sd of [-1, 1]) {
    if (!chance(.74)) continue;
    const ey = rnd(-.06, .14) * hh;
    const p  = arcPts(0, 0, hw * .17, hh * .18, -1.35, 1.35, 8)
                 .map(q => [sd * (hw * .93 + q[0]), ey + q[1]]);
    ink(p, { w: 1, passes: 1, j: .8 });
  }

  ink(head, { close: true, w: 1.3, j: 1.1 });

  /* raked cheek shading, as on the reference sheet */
  if (chance(.16)) {
    hatchIn(head, rnd(-1.0, -.35), rnd(4, 8) * SC,
            pick(['#c98f63', '#b07a55', '#8d6a4a']), .45, .8);
  }

  /* eyes — often mismatched, which is what makes them read as doodles */
  const eyY   = hh * rnd(-.24, -.02);
  const eyX   = hw * rnd(.34, .52);
  const baseR = sz * rnd(.045, .075);
  const twin  = chance(.42);
  const s0 = (R() * 7) | 0, s1 = twin ? s0 : (R() * 7) | 0;
  drawEye(-eyX + rnd(-2, 2) * SC, eyY + rnd(-3, 3) * SC, baseR * rnd(.78, 1.2), s0);
  drawEye(eyX + rnd(-2, 2) * SC, eyY + rnd(-3, 3) * SC, baseR * (twin ? 1 : rnd(.6, 1.35)), s1);

  /* brows */
  if (chance(.34)) {
    for (const sd of [-1, 1]) {
      const bx = sd * eyX, by = eyY - baseR * rnd(1.7, 2.5);
      ink([[bx - baseR * .9, by + rnd(-1, 1) * SC], [bx, by - baseR * .3],
           [bx + baseR * .9, by + rnd(-1, 1) * SC]], { w: 1.1, passes: 1, j: .8 });
    }
  }

  /* eyewear */
  if (chance(.26)) {
    const gr = baseR * 1.35;
    if (chance(.55)) {
      for (const sd of [-1, 1])
        ink(blob(sd * eyX, eyY, gr, gr * .95, 0, 16), { close: true, w: 1, j: .6 });
    } else {
      for (const sd of [-1, 1]) {
        const gx = sd * eyX, gw = gr * 1.25, gh = gr * .8;
        ink([[gx - gw, eyY - gh], [gx + gw, eyY - gh], [gx + gw, eyY + gh], [gx - gw, eyY + gh]],
            { close: true, w: 1, j: .7 });
      }
    }
    ink([[-eyX + gr, eyY], [0, eyY - SC], [eyX - gr, eyY]], { w: .9, passes: 1 });
    for (const sd of [-1, 1])
      ink([[sd * (eyX + gr), eyY], [sd * hw * .98, eyY - hh * .04]], { w: .9, passes: 1 });
  } else if (chance(.07)) {                            // monocle
    const sd = chance(.5) ? -1 : 1;
    ink(blob(sd * eyX, eyY, baseR * 1.5, baseR * 1.5, 0, 16), { close: true, w: 1, j: .6 });
    ink([[sd * eyX, eyY + baseR * 1.5], [sd * eyX * 1.3, eyY + hh * .5], [sd * eyX * 1.1, hh * .95]],
        { w: .8, passes: 1 });
  }

  drawNose(hw, hh, sz, (R() * 5) | 0);

  /* moustache */
  if (chance(.2)) {
    const my = hh * .3;
    ink([[-hw * .42, my], [-hw * .12, my - sz * .022], [0, my + sz * .006],
         [hw * .12, my - sz * .022], [hw * .42, my]], { w: 1.6, j: .7 });
  }

  drawMouth(hw, hh, sz, (R() * 6) | 0);

  /* beard / stubble over the jaw */
  if (chance(.26)) {
    const jaw = arcPts(0, 0, hw * .98, hh * .98, .18, Math.PI - .18, 16)
                  .concat(arcPts(0, hh * .12, hw * .6, hh * .5, Math.PI - .3, .3, 12));
    if (chance(.5)) {
      stippleIn(jaw, 46, INK, .5, 1.3);
    } else {
      ctx.save(); traceClosed(jaw); ctx.clip();
      for (let i = 0; i < 22; i++) {
        const a  = rnd(.12, Math.PI - .12), d = rnd(.6, .98);
        const px = Math.cos(a) * hw * d, py = Math.sin(a) * hh * d;
        ink([[px, py], [px + rnd(-2, 2) * SC, py + rnd(3, 8) * SC]], { w: .7, passes: 1 });
      }
      ctx.restore();
    }
  }

  /* headwear or hair */
  if (chance(.26)) {
    if (chance(.5)) drawHair(hw, hh, sz, hairCol);
    drawHat(hw, hh, sz);
  } else {
    drawHair(hw, hh, sz, hairCol);
  }

  /* neck + shoulders */
  if (chance(.45)) {
    const by = hh * .96, nw = hw * .24, sh = sz * .09;
    ink([[-nw, by], [-nw - sz * .008, by + sh]], { w: 1, passes: 1 });
    ink([[nw, by], [nw + sz * .008, by + sh]], { w: 1, passes: 1 });
    ink([[-hw * .95, by + sh + sz * .01], [0, by + sh], [hw * .95, by + sh + sz * .01]], { w: 1.05 });
    if (chance(.3)) {                                  // bowtie
      const ty = by + sh * .55;
      fillPts([[0, ty], [-sz * .06, ty - sz * .026], [-sz * .06, ty + sz * .026]], INK, .9);
      fillPts([[0, ty], [sz * .06, ty - sz * .026], [sz * .06, ty + sz * .026]], INK, .9);
    } else if (chance(.35)) {                          // collar
      ink([[-nw * 1.2, by + sh * .6], [0, by + sh * 1.15], [nw * 1.2, by + sh * .6]],
          { w: 1, passes: 1 });
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   Animals
   ══════════════════════════════════════════════════════════════ */

function whiskers(x, y, len, n) {
  for (const sd of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const a = -.32 + (i / (n - 1)) * .64;
      ink([[sd * x, y + a * len * .3],
           [sd * (x + len * .55), y + a * len * .55],
           [sd * (x + len), y + a * len * .95]], { w: .8, passes: 1, j: .6 });
    }
  }
}

function cat(sz) {
  const hw = sz * rnd(.31, .37), hh = sz * rnd(.28, .34);
  const col  = pick(FUR.cat);
  const head = blob(0, 0, hw, hh, chance(.5) ? rnd(.3, .7) : 0);

  for (const sd of [-1, 1]) {                          // pointed ears
    const ear = [[sd * hw * .32, -hh * .78],
                 [sd * hw * rnd(.72, .95), -hh * rnd(1.5, 1.9)],
                 [sd * hw * .92, -hh * .55]];
    wash(ear, col, .7);
    fillPts(shrink(ear, .5, 0, hh * .08), PINK, .55);
    ink(ear, { close: true, w: 1.15, j: .9 });
  }

  wash(head, col);
  ink(head, { close: true, w: 1.3, j: 1.05 });

  if (chance(.55)) {                                   // tabby marks
    for (let i = -1; i <= 1; i++)
      ink([[i * hw * .16, -hh * .82], [i * hw * .2, -hh * .5]], { w: 1, passes: 1 });
  }

  const eyY = -hh * .1, eyX = hw * .42, er = sz * rnd(.055, .075);
  for (const sd of [-1, 1]) {
    const e = blob(sd * eyX, eyY, er, er * .82, 0, 16);
    fillPts(e, PALE, .55);
    ink(e, { close: true, w: 1.05, j: .6 });
    if (chance(.5)) fillPts(blob(sd * eyX, eyY, er * .26, er * .68, 0, 12), INK, .95);  // slit
    else dot(sd * eyX, eyY, er * .38, INK);
    dot(sd * eyX - er * .3, eyY - er * .28, er * .16, PALE, .9);
  }

  const ny = hh * .3;
  const nose = [[-hw * .13, ny - sz * .012], [hw * .13, ny - sz * .012], [0, ny + sz * .028]];
  fillPts(nose, '#b5645e', .9);
  ink(nose, { close: true, w: .9, passes: 1 });
  ink(arcPts(-hw * .11, ny + sz * .03, hw * .11, hh * .11, -.1, Math.PI * .95, 8), { w: 1, passes: 1 });
  ink(arcPts(hw * .11, ny + sz * .03, hw * .11, hh * .11, Math.PI * .05, Math.PI * 1.1, 8), { w: 1, passes: 1 });
  whiskers(hw * .5, ny, sz * .38, 3);
}

function fox(sz) {
  const hw = sz * rnd(.30, .36), hh = sz * rnd(.32, .38);
  const col  = pick(FUR.fox);
  const head = [
    [0, -hh * 1.02], [hw * .82, -hh * .78], [hw * 1.02, -hh * .05],
    [hw * .46, hh * .45], [hw * .17, hh * .95], [0, hh * 1.08],
    [-hw * .17, hh * .95], [-hw * .46, hh * .45], [-hw * 1.02, -hh * .05],
    [-hw * .82, -hh * .78]
  ];

  for (const sd of [-1, 1]) {                          // tall ears, dark tips
    const ear = [[sd * hw * .38, -hh * .86],
                 [sd * hw * rnd(.85, 1.05), -hh * rnd(1.75, 2.1)],
                 [sd * hw * 1.0, -hh * .48]];
    wash(ear, col, .72);
    fillPts([ear[1],
             [ear[1][0] + (ear[0][0] - ear[1][0]) * .35, ear[1][1] + (ear[0][1] - ear[1][1]) * .35],
             [ear[1][0] + (ear[2][0] - ear[1][0]) * .35, ear[1][1] + (ear[2][1] - ear[1][1]) * .35]],
            INK, .85);
    ink(ear, { close: true, w: 1.15, j: .9 });
  }

  wash(head, col);
  fillPts([[0, hh * .22], [hw * .34, hh * .55], [hw * .17, hh * .98], [0, hh * 1.06],
           [-hw * .17, hh * .98], [-hw * .34, hh * .55]], PALE, .7);
  ink(head, { close: true, w: 1.3, j: 1.05 });

  for (const sd of [-1, 1]) {                          // cheek ruff
    for (let i = 0; i < 4; i++) {
      const t  = -.15 + i * .3;
      const bx = sd * Math.cos(t) * hw * .95, by = Math.sin(t) * hh * .5 - hh * .1;
      ink([[bx, by], [bx + sd * rnd(4, 9) * SC, by + rnd(2, 7) * SC]], { w: .85, passes: 1 });
    }
  }

  const eyY = -hh * .2, eyX = hw * .42, er = sz * rnd(.05, .065);
  for (const sd of [-1, 1]) {                          // slanted almonds
    const e = [[sd * (eyX - er * 1.2), eyY + er * .2], [sd * eyX, eyY - er * .75],
               [sd * (eyX + er * 1.2), eyY - er * .1], [sd * eyX, eyY + er * .7]];
    fillPts(e, INK, .9);
    ink(e, { close: true, w: .9, passes: 1 });
    dot(sd * (eyX + er * .25), eyY - er * .2, er * .2, PALE, .85);
  }

  const nose = [[-hw * .12, hh * .92], [hw * .12, hh * .92], [0, hh * 1.12]];
  fillPts(nose, INK, .92);
  ink(nose, { close: true, w: .9, passes: 1 });
  ink([[0, hh * 1.1], [0, hh * .78]], { w: .9, passes: 1 });
  whiskers(hw * .3, hh * .82, sz * .3, 3);
}

function dog(sz) {
  const hw = sz * rnd(.30, .37), hh = sz * rnd(.30, .36);
  const col    = pick(FUR.dog);
  const head   = blob(0, 0, hw, hh, chance(.4) ? rnd(.3, .8) : 0);
  const floppy = chance(.7);

  for (const sd of [-1, 1]) {                          // ears
    const ear = floppy
      ? blob(sd * hw * 1.0, hh * .22, hw * .3, hh * .62, 0, 18)
      : [[sd * hw * .5, -hh * .75], [sd * hw * .95, -hh * 1.6], [sd * hw * 1.0, -hh * .4]];
    wash(ear, col, .7);
    hatchIn(ear, rnd(1.1, 1.7), 3.4 * SC, INK, .16, .7);
    ink(ear, { close: true, w: 1.15, j: .9 });
  }

  wash(head, col);
  ink(head, { close: true, w: 1.3, j: 1.05 });

  if (chance(.45)) {                                   // eye patch
    const sd = chance(.5) ? -1 : 1;
    fillPts(blob(sd * hw * .44, -hh * .12, hw * .34, hh * .32, 0, 16),
            chance(.5) ? '#4c4238' : '#8b6b4a', .55);
  }

  const muzzle = blob(0, hh * .48, hw * .55, hh * .38, 0, 20);
  fillPts(muzzle, PALE, .6);
  ink(muzzle, { close: true, w: 1.05, j: .9 });

  const eyY = -hh * .14, eyX = hw * .4, er = sz * rnd(.05, .07);
  for (const sd of [-1, 1]) {
    ink(blob(sd * eyX, eyY, er, er * .9, 0, 14), { close: true, w: 1, j: .6 });
    dot(sd * eyX + er * .15, eyY + er * .1, er * .45, INK);
    dot(sd * eyX - er * .2, eyY - er * .28, er * .17, PALE, .9);
  }

  fillPts(blob(0, hh * .3, hw * .2, hh * .15, .4, 14), INK, .92);
  dot(-hw * .07, hh * .26, sz * .012, PALE, .55);
  ink([[0, hh * .44], [0, hh * .6]], { w: 1, passes: 1 });
  ink(arcPts(-hw * .17, hh * .6, hw * .17, hh * .14, -.1, Math.PI * .95, 8), { w: 1.05 });
  ink(arcPts(hw * .17, hh * .6, hw * .17, hh * .14, Math.PI * .05, Math.PI * 1.1, 8), { w: 1.05 });
  if (chance(.35)) {                                   // tongue
    const t = blob(0, hh * .78, hw * .13, hh * .18, 0, 12);
    fillPts(t, '#c9706a', .8);
    ink(t, { close: true, w: .9, passes: 1 });
  }
}

function mouse(sz) {
  const hw = sz * rnd(.24, .29), hh = sz * rnd(.26, .31);
  const col  = pick(FUR.mouse);
  const head = [[0, -hh], [hw * .92, -hh * .5], [hw * .72, hh * .38],
                [hw * .22, hh * .95], [0, hh * 1.1],
                [-hw * .22, hh * .95], [-hw * .72, hh * .38], [-hw * .92, -hh * .5]];

  for (const sd of [-1, 1]) {                          // big round ears
    const ear = blob(sd * hw * .82, -hh, hw * .58, hh * .58, 0, 20);
    wash(ear, col, .72);
    fillPts(shrink(ear, .55), PINK, .5);
    ink(ear, { close: true, w: 1.15, j: .8 });
    ink(shrink(ear, .55), { close: true, w: .8, passes: 1, j: .6 });
  }

  wash(head, col);
  ink(head, { close: true, w: 1.25, j: 1 });

  const eyY = -hh * .12, eyX = hw * .38, er = sz * rnd(.035, .05);
  for (const sd of [-1, 1]) {
    dot(sd * eyX, eyY, er, INK, .95);
    dot(sd * eyX - er * .35, eyY - er * .35, er * .3, PALE, .9);
  }

  dot(0, hh, sz * .018, '#b5645e', .95);
  ink([[0, hh], [0, hh * .72]], { w: .85, passes: 1 });
  whiskers(hw * .25, hh * .82, sz * .34, 3);

  if (chance(.5)) {                                    // buck teeth
    for (const sd of [-1, 1]) {
      const tx = sd * sz * .016;
      const t  = [[tx - sz * .014, hh * 1.06], [tx + sz * .014, hh * 1.06],
                  [tx + sz * .014, hh * 1.06 + sz * .04], [tx - sz * .014, hh * 1.06 + sz * .04]];
      fillPts(t, PALE, .85);
      ink(t, { close: true, w: .8, passes: 1, j: .4 });
    }
  }
}

function deer(sz) {
  const hw = sz * rnd(.22, .27), hh = sz * rnd(.36, .44);
  const col  = pick(FUR.deer);
  const head = [[0, -hh], [hw * .95, -hh * .62], [hw * .88, hh * .05],
                [hw * .55, hh * .68], [hw * .3, hh * 1.02], [0, hh * 1.1],
                [-hw * .3, hh * 1.02], [-hw * .55, hh * .68], [-hw * .88, hh * .05],
                [-hw * .95, -hh * .62]];

  if (chance(.68)) {                                   // antlers
    const branch = (x, y, ang, len, depth) => {
      const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
      ink([[x, y], [(x + ex) / 2 + rnd(-2, 2) * SC, (y + ey) / 2 + rnd(-2, 2) * SC], [ex, ey]],
          { w: 1.25 });
      if (depth > 0) {
        branch(ex, ey, ang - rnd(.35, .75), len * rnd(.5, .72), depth - 1);
        if (chance(.75)) branch(ex, ey, ang + rnd(.25, .6), len * rnd(.4, .62), depth - 1);
      }
    };
    for (const sd of [-1, 1])
      branch(sd * hw * .5, -hh * .88, -Math.PI / 2 + sd * rnd(.25, .55), sz * rnd(.16, .23), 2);
  }

  for (const sd of [-1, 1]) {                          // leaf ears
    const ear = blob(sd * hw * 1.28, -hh * .5, hw * .48, hh * .22, 0, 18);
    wash(ear, col, .7);
    fillPts(shrink(ear, .5), PINK, .4);
    ink(ear, { close: true, w: 1.1, j: .8 });
  }

  wash(head, col);
  fillPts([[0, hh * .3], [hw * .4, hh * .68], [hw * .3, hh * 1.02], [0, hh * 1.1],
           [-hw * .3, hh * 1.02], [-hw * .4, hh * .68]], PALE, .55);
  ink(head, { close: true, w: 1.28, j: 1.05 });

  const eyY = -hh * .28, eyX = hw * .55, er = sz * rnd(.045, .06);
  for (const sd of [-1, 1]) {
    fillPts(blob(sd * eyX, eyY, er * 1.1, er * .88, 0, 16), INK, .92);
    dot(sd * eyX - er * .35, eyY - er * .3, er * .24, PALE, .9);
    ink([[sd * (eyX - er * 1.2), eyY - er * 1.5], [sd * eyX, eyY - er * 1.9],
         [sd * (eyX + er * 1.2), eyY - er * 1.4]], { w: .8, passes: 1 });
  }

  fillPts(blob(0, hh * .92, hw * .38, hh * .13, .3, 16), INK, .9);
  dot(-hw * .14, hh * .9, sz * .011, PALE, .5);
  dot(hw * .14, hh * .9, sz * .011, PALE, .5);

  if (chance(.5)) {                                    // dapple
    for (let i = 0; i < 5; i++)
      dot(rnd(-hw * .7, hw * .7), rnd(-hh * .1, hh * .5), rnd(1.5, 3) * SC, PALE, .5);
  }
}

function bear(sz) {
  const hw = sz * rnd(.34, .40), hh = sz * rnd(.30, .36);
  const col  = pick(FUR.bear);
  const head = blob(0, 0, hw, hh, chance(.35) ? rnd(.3, .6) : 0);

  for (const sd of [-1, 1]) {                          // round ears
    const ear = blob(sd * hw * .74, -hh * .88, hw * .27, hh * .3, 0, 18);
    wash(ear, col, .72);
    fillPts(shrink(ear, .5), '#a8825a', .45);
    ink(ear, { close: true, w: 1.2, j: .85 });
  }

  wash(head, col);
  ink(head, { close: true, w: 1.35, j: 1.1 });

  for (let i = 0; i < 20; i++) {                       // fur ticks on the rim
    const t  = rnd(-Math.PI, Math.PI);
    const bx = Math.cos(t) * hw * .98, by = Math.sin(t) * hh * .98;
    ink([[bx, by], [bx + Math.cos(t) * rnd(2, 5) * SC, by + Math.sin(t) * rnd(2, 5) * SC]],
        { w: .75, passes: 1 });
  }

  const muzzle = blob(0, hh * .42, hw * .48, hh * .34, 0, 20);
  fillPts(muzzle, PALE, .6);
  ink(muzzle, { close: true, w: 1.05, j: .85 });

  const eyY = -hh * .18, eyX = hw * .36, er = sz * rnd(.032, .045);
  for (const sd of [-1, 1]) {
    dot(sd * eyX, eyY, er, INK, .95);
    dot(sd * eyX - er * .35, eyY - er * .35, er * .3, PALE, .85);
  }

  const nose = [[-hw * .17, hh * .22], [hw * .17, hh * .22], [hw * .1, hh * .42], [-hw * .1, hh * .42]];
  fillPts(nose, INK, .92);
  ink(nose, { close: true, w: .9, passes: 1 });
  ink([[0, hh * .42], [0, hh * .6]], { w: 1.05 });
  ink(arcPts(-hw * .16, hh * .6, hw * .16, hh * .16, -.1, Math.PI * .95, 8), { w: 1.05 });
  ink(arcPts(hw * .16, hh * .6, hw * .16, hh * .16, Math.PI * .05, Math.PI * 1.1, 8), { w: 1.05 });
}

function ant(sz) {
  const hw = sz * rnd(.26, .32), hh = sz * rnd(.28, .34);
  const col = pick(FUR.ant);
  /* rounded-square head with a shallow dip at the crown */
  const head = [[0, -hh * .78], [hw * .55, -hh], [hw, -hh * .35],
                [hw * .92, hh * .45], [hw * .45, hh * .98], [0, hh * 1.05],
                [-hw * .45, hh * .98], [-hw * .92, hh * .45], [-hw, -hh * .35],
                [-hw * .55, -hh]];

  for (const sd of [-1, 1]) {                          // elbowed antennae
    const bx = sd * hw * .5, by = -hh * .92;
    const kx = sd * hw * rnd(1.0, 1.3), ky = -hh * rnd(1.5, 1.75);
    const tx = sd * hw * rnd(1.5, 1.9), ty = -hh * rnd(1.15, 1.4);
    ink([[bx, by], [kx, ky]], { w: 1.15 });
    ink([[kx, ky], [(kx + tx) / 2, (ky + ty) / 2 - sz * .01], [tx, ty]], { w: 1.15 });
    dot(tx, ty, sz * .022, INK, .9);
  }

  wash(head, col);
  ink(head, { close: true, w: 1.3, j: 1.05 });

  const eyY = -hh * .12, eyX = hw * .48, er = sz * rnd(.07, .095);
  for (const sd of [-1, 1]) {                          // big compound eyes
    const e = [[sd * (eyX - er * .8), eyY - er * .55], [sd * (eyX + er * .85), eyY - er * .15],
               [sd * (eyX + er * .7), eyY + er * .75], [sd * (eyX - er * .85), eyY + er * .35]];
    fillPts(e, INK, .9);
    ink(e, { close: true, w: .9, passes: 1 });
    ink([[sd * (eyX - er * .4), eyY - er * .3], [sd * (eyX + er * .2), eyY - er * .05]],
        { w: 1.1, passes: 1, c: PALE, a: .8 });
  }

  for (const sd of [-1, 1]) {                          // mandibles
    ink([[sd * hw * .42, hh * .92], [sd * hw * .5, hh * 1.28], [sd * hw * .05, hh * 1.42]],
        { w: 1.25 });
  }
  ink([[-hw * .3, hh * .68], [0, hh * .78], [hw * .3, hh * .68]], { w: 1, passes: 1 });

  if (chance(.6)) {                                    // a hint of thorax
    const th = blob(0, hh * 1.75, hw * .5, hh * .32, 0, 16);
    wash(th, col, .65);
    ink(th, { close: true, w: 1.1, j: .8 });
    for (const sd of [-1, 1])
      ink([[sd * hw * .45, hh * 1.7], [sd * hw * .85, hh * 1.62], [sd * hw, hh * 1.95]],
          { w: .95, passes: 1 });
  }
}

function butterfly(sz) {
  const hw = sz * .2, hh = sz * .2;
  const col = pick(FUR.wing), col2 = pick(FUR.wing);

  for (const sd of [-1, 1]) {                          // wings frame the face
    const up = [[sd * hw * .3, -hh * .3], [sd * hw * 1.5, -hh * 2.4],
                [sd * hw * 3.1, -hh * 1.9], [sd * hw * 2.7, -hh * .1],
                [sd * hw * 1.2, hh * .25]];
    wash(up, col, .62);
    ink(up, { close: true, w: 1.2, j: 1 });
    hatchIn(up, rnd(.4, 1.2), 5 * SC, INK, .12, .7);
    for (let i = 0; i < 3; i++)
      dot(sd * hw * rnd(1.4, 2.6), -hh * rnd(.4, 1.7), rnd(2, 4.5) * SC, INK, .5);

    const lo = [[sd * hw * .35, hh * .2], [sd * hw * 1.9, hh * .5],
                [sd * hw * 2.2, hh * 1.9], [sd * hw * .9, hh * 1.5]];
    wash(lo, col2, .55);
    ink(lo, { close: true, w: 1.15, j: 1 });
    dot(sd * hw * 1.5, hh * 1.05, rnd(2.5, 4) * SC, INK, .45);
  }

  const body = blob(0, hh * .55, hw * .28, hh * 1.15, 0, 18);
  fillPts(body, '#4a3a2a', .78);
  ink(body, { close: true, w: 1.1, j: .8 });
  for (let i = 1; i < 4; i++)
    ink([[-hw * .24, hh * (-.2 + i * .5)], [hw * .24, hh * (-.2 + i * .5)]], { w: .8, passes: 1 });

  const head = blob(0, -hh * .95, hw * .52, hh * .48, 0, 18);
  fillPts(head, '#4a3a2a', .7);
  ink(head, { close: true, w: 1.2, j: .8 });
  for (const sd of [-1, 1]) {
    fillPts(blob(sd * hw * .3, -hh * .98, hw * .26, hh * .27, 0, 14), INK, .92);
    dot(sd * hw * .3 - hw * .08, -hh * 1.06, hw * .08, PALE, .85);
  }
  ink(arcPts(0, -hh * .7, hw * .18, hh * .12, .2, Math.PI - .2, 8), { w: .9, passes: 1 });

  for (const sd of [-1, 1]) {                          // clubbed antennae
    const tx = sd * hw * 1.15, ty = -hh * 2.5;
    ink([[sd * hw * .22, -hh * 1.3], [sd * hw * .5, -hh * 2.1], [tx, ty]], { w: 1.1 });
    dot(tx, ty, sz * .02, INK, .9);
  }

  if (chance(.5))                                      // proboscis curl
    ink(arcPts(hw * .18, -hh * .35, hw * .3, hh * .3, -Math.PI * .5, Math.PI * 1.2, 12),
        { w: .85, passes: 1 });
}

/* ══════════════════════════════════════════════════════════════
   Sheet
   ══════════════════════════════════════════════════════════════ */

const KINDS = [human, human, human, human, human, human,
               cat, dog, fox, mouse, deer, bear, ant, butterfly];

/* ── Public API ───────────────────────────────────────────────── */

const DEFAULT = { INK, DARK, PALE, PINK, SKIN: SKIN.slice(), HAIR: HAIR.slice(), HAT: HAT.slice() };

/**
 * Swap the ink and wash colours, e.g. for the dark theme.
 * Any key left out falls back to the original palette.
 */
export function setPalette(p = {}) {
  INK  = p.ink  || DEFAULT.INK;
  DARK = p.dark || DEFAULT.DARK;
  PALE = p.pale || DEFAULT.PALE;
  PINK = p.pink || DEFAULT.PINK;
  SKIN = p.skin || DEFAULT.SKIN;
  HAIR = p.hair || DEFAULT.HAIR;
  HAT  = p.hat  || DEFAULT.HAT;
}

/** A random 32-bit seed. */
export function randomSeed() {
  return (Math.random() * 4294967296) >>> 0;
}

/**
 * Draw one face centred at (cx, cy) in CSS pixels on a context whose
 * transform already includes the device pixel ratio.
 * kind: 'human' (default) or one of the animals, for easter eggs.
 */
export function drawFace(context, { seed, size, cx, cy, kind = 'human', pen = 1 }) {
  const kinds = { human, cat, fox, dog, mouse, deer, bear, ant, butterfly };
  ctx = context;
  R = mkRng(seed);
  SC = Math.max(.72, Math.min(1.45, size / 96));
  PEN = pen;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.translate(cx, cy);
  ctx.rotate(rnd(-.06, .06));
  (kinds[kind] || human)(size);
  ctx.restore();
  PEN = 1;
  ctx.globalAlpha = 1;
}
