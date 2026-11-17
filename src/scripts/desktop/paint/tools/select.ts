/**
 * Select and Free-Form Select, and everything that works on a selection, as
 * in Windows 98 Paint: moving it (Ctrl moves a copy, Shift leaves a trail),
 * opaque or transparent, Cut / Copy / Paste (the system clipboard and an
 * internal copy), Clear Selection, Select All, Copy To and Paste From. It also
 * sets core.selection, so Flip/Rotate, Invert and Stretch/Skew act on it.
 *
 * A selection is a box in picture pixels. Until it moves it is only a marquee.
 * The first move LIFTS it: its pixels go into a floating bitmap, shown in an
 * overlay canvas, and the hole is filled with the background colour. Dragging
 * outside it, choosing another tool or core.flush() commits it: the floating
 * pixels are stamped back into the picture. Lift ... commit is one undo step
 * (beginOp at the lift or paste, endOp at the commit).
 *
 * A floating bitmap keeps the free-form shape in its alpha channel: pixels
 * outside the shape have alpha 0 (everything in the picture has alpha 255),
 * so flips, rotations and stretches carry the shape along with the pixels.
 */
import './select.css';
import * as R from '../raster';
import { type Core, type PointerInfo, type Pt, type Selection, type Tool, MAX_SIDE, WHITE, clipBox, union, wholeBox } from '../core';

// ── Pure helpers (select.test.ts) ─────────────────────────────────────

/** a floating pixel belongs to the selection when its alpha is not 0 */
const inShape = (c: number) => c >>> 24 !== 0;
const OPAQUE = 0xff000000;
const sameRgb = (a: number, b: number) => ((a ^ b) & 0xffffff) === 0;

/** the inclusive box spanned by two corners given in any order */
export function spanBox(a: Pt, b: Pt): R.Box {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

export const within = (b: R.Box, p: Pt) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;

export const sizeOf = (b: R.Box) => `${b.x1 - b.x0 + 1}x${b.y1 - b.y0 + 1}`;

/**
 * The free-form shape over `box`, row by row (1 = selected): the pixels whose
 * centre lies inside the closed polygon through the pointer points (even-odd
 * rule), plus every pixel on its edges, so a path with no area still keeps
 * the pixels it passed over. Points may lie outside the box.
 */
export function polygonMask(pts: readonly Pt[], box: R.Box): Uint8Array {
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  if (w <= 0 || h <= 0) return new Uint8Array(0);
  const mask = new Uint8Array(w * h);
  const n = pts.length;
  if (n === 0) return mask;
  // where each edge crosses each row (pixel centres are the integer points),
  // counting an edge from its lower end up to, not including, its upper end
  const rows: number[][] = Array.from({ length: h }, () => []);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (a.y === b.y) continue;
    const lo = Math.max(Math.min(a.y, b.y), box.y0);
    const hi = Math.min(Math.max(a.y, b.y) - 1, box.y1);
    for (let y = lo; y <= hi; y++) rows[y - box.y0].push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  for (let r = 0; r < h; r++) {
    const xs = rows[r].sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(Math.ceil(xs[k]), box.x0);
      const to = Math.min(Math.ceil(xs[k + 1]) - 1, box.x1);
      for (let x = from; x <= to; x++) mask[r * w + x - box.x0] = 1;
    }
  }
  const plot = (x: number, y: number) => {
    if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) mask[(y - box.y0) * w + x - box.x0] = 1;
  };
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    R.bresenham(a.x, a.y, b.x, b.y, plot);
  }
  return mask;
}

/** the smallest box holding every set pixel of a mask laid over `box`, or null */
export function maskBounds(mask: Uint8Array, box: R.Box): R.Box | null {
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x0 > x1 ? null : { x0: box.x0 + x0, y0: box.y0 + y0, x1: box.x0 + x1, y1: box.y0 + y1 };
}

/** the part of a mask (laid over `box`) under `sub`, or null when all of that part is set */
export function cropMask(mask: Uint8Array, box: R.Box, sub: R.Box): Uint8Array | null {
  const w = box.x1 - box.x0 + 1;
  const sw = sub.x1 - sub.x0 + 1;
  const sh = sub.y1 - sub.y0 + 1;
  const out = new Uint8Array(sw * sh);
  let full = true;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const v = mask[(sub.y0 - box.y0 + y) * w + (sub.x0 - box.x0 + x)] ? 1 : 0;
      out[y * sw + x] = v;
      if (!v) full = false;
    }
  }
  return full ? null : out;
}

/**
 * The pixels of `box` as a floating bitmap. Pixels outside the mask, or
 * outside the picture, get alpha 0: they are not part of the selection.
 */
export function liftPixels(bm: R.Bitmap, box: R.Box, mask: Uint8Array | null): R.Bitmap {
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  const data = R.extract(bm, box); // 0 (alpha 0) outside the picture
  if (mask) for (let i = 0; i < data.length; i++) if (!mask[i]) data[i] = 0;
  return { w, h, data, dirty: null };
}

/** Sets the picture pixels under the shape of `f` (placed at x0, y0) to c. Returns the clipped box it covered. */
export function fillShape(bm: R.Bitmap, f: R.Bitmap, x0: number, y0: number, c: R.Color): R.Box | null {
  const box = clipBox(bm, { x0, y0, x1: x0 + f.w - 1, y1: y0 + f.h - 1 });
  if (!box) return null;
  const col = c >>> 0;
  for (let y = box.y0; y <= box.y1; y++) {
    const src = (y - y0) * f.w - x0;
    const dst = y * bm.w;
    for (let x = box.x0; x <= box.x1; x++) if (inShape(f.data[src + x])) bm.data[dst + x] = col;
  }
  R.markDirty(bm, box);
  return box;
}

/**
 * Stamps the floating bitmap `f` into the picture with its top-left at
 * (x0, y0), clipped. Pixels outside its shape are skipped, and so are pixels
 * of the colour `see` (the background colour in transparent mode; null when
 * opaque). Returns the clipped box it covered.
 */
export function stampFloat(bm: R.Bitmap, f: R.Bitmap, x0: number, y0: number, see: R.Color | null): R.Box | null {
  const box = clipBox(bm, { x0, y0, x1: x0 + f.w - 1, y1: y0 + f.h - 1 });
  if (!box) return null;
  for (let y = box.y0; y <= box.y1; y++) {
    const src = (y - y0) * f.w - x0;
    const dst = y * bm.w;
    for (let x = box.x0; x <= box.x1; x++) {
      const c = f.data[src + x];
      if (!inShape(c) || (see !== null && sameRgb(c, see))) continue;
      bm.data[dst + x] = (c | OPAQUE) >>> 0;
    }
  }
  R.markDirty(bm, box);
  return box;
}

/** what the overlay shows of a floating bitmap: skipped pixels (see stampFloat) fully transparent */
export function showPixels(f: R.Bitmap, see: R.Color | null): Uint32Array {
  const out = new Uint32Array(f.w * f.h);
  for (let i = 0; i < out.length; i++) {
    const c = f.data[i];
    out[i] = !inShape(c) || (see !== null && sameRgb(c, see)) ? 0 : (c | OPAQUE) >>> 0;
  }
  return out;
}

/**
 * RGBA bytes (a decoded clipboard image) to a floating bitmap. Mostly
 * transparent pixels (alpha < 128) are outside the selection's shape, so a
 * free-form selection copied from here comes back with its shape; the rest is
 * laid over white, as Paint has no transparency. An image with no opaque
 * pixel at all is laid over white whole.
 */
export function fromRGBA(rgba: ArrayLike<number>, w: number, h: number): R.Bitmap {
  const n = w * h;
  const data = new Uint32Array(n);
  let any = false;
  for (let i = 0; i < n && !any; i++) if (rgba[i * 4 + 3] >= 128) any = true;
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3];
    if (any && a < 128) continue; // stays 0: outside the shape
    const k = a / 255;
    const over = (v: number) => v * k + 255 * (1 - k);
    data[i] = R.rgb(over(rgba[i * 4]), over(rgba[i * 4 + 1]), over(rgba[i * 4 + 2]));
  }
  return { w, h, data, dirty: null };
}

/** a typed file name, cleaned, as a .png */
export function pngName(typed: string): string {
  const clean = typed
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .replace(/\.(png|bmp|jpe?g|gif|webp|ico|avif|tiff?)$/i, '')
    .replace(/[. ]+$/, '');
  return `${clean.slice(0, 100) || 'untitled'}.png`;
}

/** true when the two bitmaps (of one size) hold the same pixels inside `box` */
export function sameIn(a: R.Bitmap, b: R.Bitmap, box: R.Box): boolean {
  if (a.w !== b.w || a.h !== b.h) return false;
  const c = clipBox(a, box);
  if (!c) return true;
  for (let y = c.y0; y <= c.y1; y++) {
    for (let x = c.x0, i = y * a.w + c.x0; x <= c.x1; x++, i++) if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

// ── The tools ─────────────────────────────────────────────────────────

interface Sel {
  box: R.Box;
  /** before the lift: the free-form shape over box (null = the whole box) */
  mask: Uint8Array | null;
  /** after the lift (or a paste): the floating pixels; an undo op is open */
  float: R.Bitmap | null;
}
interface MoveDrag {
  kind: 'move';
  start: Pt;
  from: R.Box;
  mask: Uint8Array | null;
  ctrl: boolean;
  /** this drag lifted the selection (so Esc undoes the lift) */
  liftedHere: boolean;
  /** the selection has moved during this drag */
  moved: boolean;
  /** the picture before this drag's first stamp, and what the stamps covered (for Esc) */
  snap: R.Bitmap | null;
  dirty: R.Box | null;
}
type Drag = { kind: 'rect'; anchor: Pt; moved: boolean; box: R.Box | null } | { kind: 'free'; pts: Pt[] } | MoveDrag;

const NS = 'http://www.w3.org/2000/svg';
const SELECTION_ACTIONS = ['cut', 'copy', 'clearsel', 'copyto'];

export function install(core: Core) {
  let sel: Sel | null = null;
  let drag: Drag | null = null;
  /** what the open op has changed in the picture so far */
  let touched: R.Box | null = null;
  /** the internal clipboard (always kept, whatever the system clipboard allows) */
  let clip: R.Bitmap | null = null;
  /**
   * The system clipboard still holds something older than `clip`: the last
   * copy's write to it has not finished yet (it takes 150 ms to a second), or
   * it failed. Pastes then use `clip`.
   */
  let sysStale = false;
  /** the last copy's write to the system clipboard is still running */
  let writing = false;
  /** which copy the running write belongs to (a newer copy overrides an older write) */
  let writeId = 0;
  let newestDone = false; // the newest write has settled
  let lastFailed = false; // the newest write failed or was never possible
  let shownBg: R.Color | null = null;
  let lastBm = core.bm();

  // ── layers over the picture: the floating pixels, then the marquee. Both
  // have exactly the picture canvas's box, so the browser snaps them to the
  // same screen pixels and scales them the same way.
  const floatCanvas = document.createElement('canvas');
  floatCanvas.className = 'pt-sel-float';
  floatCanvas.width = 0;
  floatCanvas.height = 0;
  floatCanvas.hidden = true;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'pt-sel-ants');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.display = 'none';
  const cut = document.createElementNS(NS, 'clipPath');
  cut.id = 'pt-sel-cut';
  cut.setAttribute('clipPathUnits', 'userSpaceOnUse');
  const cutRect = document.createElementNS(NS, 'rect');
  cut.append(cutRect);
  const ants = document.createElementNS(NS, 'g');
  ants.setAttribute('clip-path', 'url(#pt-sel-cut)');
  const under = document.createElementNS(NS, 'path');
  under.setAttribute('class', 'pt-sel-under');
  const over = document.createElementNS(NS, 'path');
  over.setAttribute('class', 'pt-sel-over');
  ants.append(under, over);
  svg.append(cut, ants);
  core.overlay.append(floatCanvas, svg);

  const ours = () => core.currentTool() === 'select' || core.currentTool() === 'freeselect';
  /** the colour that is see-through: the background colour in transparent mode */
  const see = () => (core.st.opaque ? null : core.st.bg);
  const touch = (b: R.Box | null) => void (touched = union(touched, b));

  // ── showing it ──────────────────────────────────────────────────
  /**
   * Where picture pixels land on the screen. The browser draws the canvas
   * snapped to device pixels and scales it nearest-neighbour, so picture
   * column X starts at device column col(X) (counted from the canvas's left
   * edge). The marquee goes on the device pixels just outside the selection,
   * one device pixel wide, in overlay CSS px (k device pixels each).
   */
  function screen() {
    const bm = core.bm();
    const dpr = devicePixelRatio || 1;
    const r = core.canvas.getBoundingClientRect();
    const local = core.canvas.offsetWidth;
    const shown = r.width > 0 && local > 0;
    const k = shown ? (r.width / local) * dpr : dpr;
    const W = shown ? Math.round(r.right * dpr) - Math.round(r.left * dpr) : bm.w * core.zoom() * k;
    const H = shown ? Math.round(r.bottom * dpr) - Math.round(r.top * dpr) : bm.h * core.zoom() * k;
    return {
      k,
      W,
      H,
      col: (X: number) => Math.ceil((X * W) / bm.w - 0.5),
      row: (Y: number) => Math.ceil((Y * H) / bm.h - 0.5),
      /** the middle of device column or row d */
      at: (d: number) => (d + 0.5) / k,
      /** the middle of a picture pixel */
      mid: (p: Pt) => `${num(((p.x + 0.5) * W) / bm.w / k)} ${num(((p.y + 0.5) * H) / bm.h / k)}`,
    };
  }
  type Screen = ReturnType<typeof screen>;
  const num = (v: number) => String(Math.round(v * 1000) / 1000);
  function setAnts(d: string, s: Screen) {
    const t = 1 / s.k;
    for (const p of [under, over]) {
      p.setAttribute('d', d);
      p.setAttribute('stroke-width', num(t));
    }
    over.setAttribute('stroke-dasharray', `${num(4 * t)} ${num(4 * t)}`);
    // clipped to the picture and the one device pixel around it, as in 98
    cutRect.setAttribute('x', num(-t));
    cutRect.setAttribute('y', num(-t));
    cutRect.setAttribute('width', num((s.W + 2) * t));
    cutRect.setAttribute('height', num((s.H + 2) * t));
    svg.style.display = '';
  }
  /** a dashed rectangle on the screen pixels just outside the box */
  function antsBox(b: R.Box) {
    const s = screen();
    const L = num(s.at(s.col(b.x0) - 1));
    const T = num(s.at(s.row(b.y0) - 1));
    const Rt = num(s.at(s.col(b.x1 + 1)));
    const B = num(s.at(s.row(b.y1 + 1)));
    setAnts(`M${L} ${T}H${Rt}V${B}H${L}Z`, s);
  }
  function showAnts() {
    if (drag?.kind === 'free') {
      const s = screen();
      setAnts(drag.pts.map((p, i) => (i ? 'L' : 'M') + s.mid(p)).join(''), s);
      return;
    }
    const b = drag?.kind === 'rect' ? drag.box : sel?.box;
    if (b) antsBox(b);
    else svg.style.display = 'none';
  }

  /**
   * The floating pixels, drawn at their place in a canvas the size of the
   * picture (so they line up with it exactly), once per frame while moving.
   */
  let floatImg: ImageData | null = null;
  let painted: R.Box | null = null;
  let frame = 0;
  let antsFrame = 0;
  function showFloat(redraw: boolean) {
    const f = sel?.float;
    if (!f) {
      floatImg = null;
      painted = null;
      if (!floatCanvas.hidden) {
        floatCanvas.hidden = true;
        floatCanvas.width = 0; // let the memory go
        floatCanvas.height = 0;
      }
      return;
    }
    if (redraw || !floatImg || shownBg !== core.st.bg) {
      floatImg = new ImageData(new Uint8ClampedArray(showPixels(f, see()).buffer as ArrayBuffer), f.w, f.h);
      shownBg = core.st.bg;
    }
    if (!frame) frame = requestAnimationFrame(paintFloat);
  }
  function paintFloat() {
    frame = 0;
    if (!sel?.float || !floatImg) return;
    const bm = core.bm();
    if (floatCanvas.width !== bm.w || floatCanvas.height !== bm.h) {
      floatCanvas.width = bm.w;
      floatCanvas.height = bm.h;
      painted = null;
    }
    const cx = floatCanvas.getContext('2d')!;
    if (painted) cx.clearRect(painted.x0, painted.y0, painted.x1 - painted.x0 + 1, painted.y1 - painted.y0 + 1);
    cx.putImageData(floatImg, sel.box.x0, sel.box.y0);
    painted = { ...sel.box };
    floatCanvas.hidden = false;
  }
  function showStatus() {
    core.status.size(drag?.kind === 'rect' ? (drag.box ? sizeOf(drag.box) : '') : sel ? sizeOf(sel.box) : '');
  }
  function setSel(next: Sel | null) {
    sel = next;
    core.selection = next ? api : null;
    if (!next && ours()) core.canvas.style.cursor = '';
    // as in 98, Cut, Copy, Clear Selection and Copy To need something selected
    for (const a of SELECTION_ACTIONS) {
      const item = core.win.querySelector(`[data-action="${a}"]`);
      if (next) item?.removeAttribute('aria-disabled');
      else item?.setAttribute('aria-disabled', 'true');
    }
    showFloat(true);
    showAnts();
    showStatus();
  }

  // ── lifting, stamping, committing ────────────────────────────────
  /** pick the pixels up into a floating bitmap; unless `copy`, fill the hole with the background colour */
  function lift(copy: boolean) {
    if (!sel || sel.float) return;
    const bm = core.bm();
    core.beginOp();
    touched = null;
    const f = liftPixels(bm, sel.box, sel.mask);
    if (!copy) touch(fillShape(bm, f, sel.box.x0, sel.box.y0, core.st.bg));
    sel.float = f;
    sel.mask = null;
    core.render();
    showFloat(true);
  }
  /** stamp the floating pixels where they are now */
  function stampNow(): R.Box | null {
    if (!sel?.float) return null;
    const b = stampFloat(core.bm(), sel.float, sel.box.x0, sel.box.y0, see());
    touch(b);
    core.render();
    return b;
  }
  /** close the op the lift opened; an op that changed nothing leaves no undo step */
  function endOp() {
    const before = core.opBefore();
    if (before && (!touched || sameIn(before, core.bm(), touched))) core.cancelOp();
    else core.endOp();
    touched = null;
  }
  /** stamp anything floating into the picture (one undo step) and select nothing */
  function commit() {
    if (sel?.float) {
      stampNow();
      endOp();
    }
    setSel(null);
  }
  /** drop the selection: a floating one vanishes (its hole stays), a fixed one is filled with the background colour */
  function clearSelection() {
    if (!sel || drag) return;
    if (!sel.float) {
      const bm = core.bm();
      core.beginOp();
      touched = null;
      touch(fillShape(bm, liftPixels(bm, sel.box, sel.mask), sel.box.x0, sel.box.y0, core.st.bg));
      core.render();
    }
    endOp();
    setSel(null);
  }

  /** move the selection's top-left to (x, y), lifting it first; `d` is the drag doing it, if any */
  function moveTo(d: MoveDrag | null, x: number, y: number, trail: boolean) {
    if (!sel) return;
    const w = sel.box.x1 - sel.box.x0;
    const h = sel.box.y1 - sel.box.y0;
    // it may hang off the picture, but a pixel of it stays over the picture to grab it by
    const bm = core.bm();
    x = Math.max(-w, Math.min(bm.w - 1, x));
    y = Math.max(-h, Math.min(bm.h - 1, y));
    if (x === sel.box.x0 && y === sel.box.y0) return;
    if (!sel.float) {
      lift(!!d?.ctrl);
      if (d) d.liftedHere = true;
    } else if (d?.ctrl && !d.moved) dragStamp(d); // Ctrl on a floating selection: a copy stays behind
    if (trail) dragStamp(d); // Shift: a copy at every step
    if (d) d.moved = true;
    sel.box = { x0: x, y0: y, x1: x + w, y1: y + h };
    showFloat(false);
    showAnts();
    showStatus();
  }
  function dragStamp(d: MoveDrag | null) {
    // keep the picture as it was before this drag's first stamp, for Esc
    if (d && !d.liftedHere && !d.snap) d.snap = R.cloneBitmap(core.bm());
    const b = stampNow();
    if (d) d.dirty = union(d.dirty, b);
  }

  /** a free-form path to a selection: its shape, clipped to the picture, in its tight box */
  function freeSel(pts: Pt[]): Sel | null {
    if (pts.length < 2) return null;
    let bb = spanBox(pts[0], pts[0]);
    for (const p of pts) bb = union(bb, spanBox(p, p))!;
    const box = clipBox(core.bm(), bb);
    if (!box) return null;
    const mask = polygonMask(pts, box);
    const tight = maskBounds(mask, box);
    return tight ? { box: tight, mask: cropMask(mask, box, tight), float: null } : null;
  }

  // ── pointer ──────────────────────────────────────────────────────
  function down(i: PointerInfo, free: boolean) {
    drag = null;
    if (sel && within(sel.box, i.p)) {
      drag = { kind: 'move', start: i.p, from: { ...sel.box }, mask: sel.mask, ctrl: i.ctrl, liftedHere: false, moved: false, snap: null, dirty: null };
      core.canvas.style.cursor = 'move';
      return;
    }
    // pressing outside the selection commits it and starts a new one
    commit();
    drag = free ? { kind: 'free', pts: [i.p] } : { kind: 'rect', anchor: i.p, moved: false, box: clipBox(core.bm(), spanBox(i.p, i.p)) };
    showAnts();
    showStatus();
  }
  function move(i: PointerInfo) {
    const d = drag;
    if (!d) return;
    if (d.kind === 'rect') {
      if (i.p.x !== d.anchor.x || i.p.y !== d.anchor.y) d.moved = true;
      d.box = clipBox(core.bm(), spanBox(d.anchor, i.p));
      showAnts();
      showStatus();
    } else if (d.kind === 'free') {
      const last = d.pts[d.pts.length - 1];
      if (last.x === i.p.x && last.y === i.p.y) return;
      d.pts.push(i.p);
      // the path follows the pointer, redrawn once a frame however many points come in
      antsFrame ||= requestAnimationFrame(() => {
        antsFrame = 0;
        if (drag?.kind === 'free') showAnts();
      });
    } else {
      moveTo(d, d.from.x0 + i.p.x - d.start.x, d.from.y0 + i.p.y - d.start.y, i.shift);
    }
  }
  function up(i: PointerInfo) {
    const d = drag;
    if (!d) return;
    move(i);
    drag = null;
    if (d.kind === 'rect') setSel(d.moved && d.box ? { box: d.box, mask: null, float: null } : null);
    else if (d.kind === 'free') setSel(freeSel(d.pts));
    else core.canvas.style.cursor = sel && within(sel.box, i.p) ? 'move' : '';
  }
  /** Esc or a lost pointer in the middle of a drag: put things back as they were before it */
  function cancel() {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.kind !== 'move') return setSel(null);
    if (!sel) return;
    if (d.liftedHere) {
      core.cancelOp();
      touched = null;
      sel.float = null;
      sel.mask = d.mask;
    } else if (d.snap && d.dirty) {
      R.restore(core.bm(), d.dirty, R.extract(d.snap, d.dirty));
      core.render();
    }
    sel.box = { ...d.from };
    setSel(sel);
  }

  // ── keys ─────────────────────────────────────────────────────────
  const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  function key(e: KeyboardEvent) {
    const t = e.target as Element | null;
    if (!sel || drag || t?.closest?.('[data-menubar], [role="menu"]')) return false;
    // Esc commits a floating selection, as in 98
    if (e.key === 'Escape') {
      commit();
      return true;
    }
    // arrows move the selection a pixel (Shift: ten) while the picture has the focus
    const a = ARROWS[e.key];
    if (!a || t !== core.canvas || e.ctrlKey || e.metaKey || e.altKey) return false;
    const n = e.shiftKey ? 10 : 1;
    moveTo(null, sel.box.x0 + a[0] * n, sel.box.y0 + a[1] * n, false);
    return true;
  }

  // ── opaque / transparent ─────────────────────────────────────────
  function setOpaque(on: boolean) {
    core.st.opaque = on;
    core.setChecked('opaque', on);
    showFloat(true);
  }
  const options = (box: HTMLElement) =>
    box.append(
      core.optionButtons(
        2,
        1,
        30,
        22,
        core.st.opaque ? 0 : 1,
        (i) => (i === 0 ? 'Opaque: the selection covers the picture under it' : 'Transparent: the background color in the selection is see-through'),
        (i, b, ink) => {
          // something under the selection...
          R.ellipse(b, 2, 6, 15, 19, 1, ink, R.rgb(0, 128, 128));
          // ...the selection, whose background hides it when opaque...
          if (i === 0) R.rect(b, 11, 2, 27, 19, 1, null, WHITE);
          for (let x = 11; x <= 27; x += 2) {
            R.setPixel(b, x, 2, ink);
            R.setPixel(b, x, 19, ink);
          }
          for (let y = 2; y <= 19; y += 2) {
            R.setPixel(b, 11, y, ink);
            R.setPixel(b, 27, y, ink);
          }
          // ...and what was selected
          R.rect(b, 16, 6, 23, 13, 1, ink, R.rgb(255, 0, 0));
        },
        (i) => setOpaque(i === 0),
      ),
    );

  // ── the clipboard ────────────────────────────────────────────────
  /** the selected pixels (a copy), or null */
  function selected(): R.Bitmap | null {
    if (!sel) return null;
    return sel.float ? R.cloneBitmap(sel.float) : liftPixels(core.bm(), sel.box, sel.mask);
  }
  function copy() {
    const img = selected();
    if (!img) return false;
    clip = img;
    // the system clipboard too, as a PNG (outside a free-form shape is transparent).
    // Until that write has finished, pastes take `clip`; if it fails, they keep doing so.
    const id = ++writeId;
    sysStale = true;
    writing = false;
    newestDone = false;
    lastFailed = true; // until this write succeeds
    try {
      if (typeof ClipboardItem === 'function' && navigator.clipboard?.write) {
        writing = true;
        navigator.clipboard.write([new ClipboardItem({ 'image/png': core.toPng(img) })]).then(
          () => {
            if (id !== writeId) {
              // an older, slower write landed after the newest one: the
              // system clipboard now holds the older image
              if (newestDone) sysStale = true;
              return;
            }
            writing = false;
            newestDone = true;
            lastFailed = false;
            sysStale = false;
          },
          () => {
            if (id !== writeId) return;
            writing = false;
            newestDone = true;
          },
        );
      }
    } catch {
      writing = false;
    }
    return true;
  }
  /** the image to paste is `clip`, not what the system clipboard holds */
  const pasteClip = () => !!clip && sysStale;
  // Coming back to the page after a copy whose write failed (or was never
  // possible): something may have been copied elsewhere since, so the system
  // clipboard is the newer one again.
  window.addEventListener('focus', () => {
    // only after a write that worked: if Paint could not write, its own copy stays the one to paste
    if (!writing && !lastFailed) sysStale = false;
  });
  /** an image file or blob to a floating bitmap (scaled to fit MAX_SIDE), or null */
  async function decode(blob: Blob): Promise<R.Bitmap | null> {
    let pic: ImageBitmap | null = null;
    try {
      pic = await createImageBitmap(blob);
      const k = Math.min(1, MAX_SIDE / Math.max(pic.width, pic.height, 1));
      const w = Math.max(1, Math.round(pic.width * k));
      const h = Math.max(1, Math.round(pic.height * k));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true })!;
      cx.drawImage(pic, 0, 0, w, h);
      return fromRGBA(cx.getImageData(0, 0, w, h).data, w, h);
    } catch {
      return null;
    } finally {
      pic?.close();
    }
  }
  /** the top-left picture pixel in view (pastes land there, as in 98) */
  function visibleTopLeft(): Pt {
    const bm = core.bm();
    const v = core.view.getBoundingClientRect();
    const c = core.canvas.getBoundingClientRect();
    const p = core.toPixel({ clientX: Math.max(c.left, v.left), clientY: Math.max(c.top, v.top) });
    const fit = (n: number, max: number) => (Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0);
    return { x: fit(p.x, bm.w - 1), y: fit(p.y, bm.h - 1) };
  }
  /** select the Select tool and commit what it holds; false when that is not possible now */
  function takeOver() {
    if (drag) return false;
    if (core.currentTool() !== 'select') core.setTool('select');
    if (core.currentTool() !== 'select') return false; // another tool is in the middle of a drag
    commit();
    return true;
  }
  /** an image becomes a floating selection at the top-left of the view, with the Select tool */
  async function paste(img: R.Bitmap) {
    if (!takeOver()) return;
    const bm = core.bm();
    if (img.w > bm.w || img.h > bm.h) {
      const { value } = await core.dialog(
        'Paint',
        core.el('<p class="pt-ask">The image in the clipboard is larger than the bitmap.<br />Would you like the bitmap enlarged?</p>'),
        [
          { label: 'Yes', value: 'yes', primary: true },
          { label: 'No', value: 'no' },
          { label: 'Cancel', value: 'cancel' },
        ],
      );
      if (value === 'cancel' || !takeOver()) return;
      const now = core.bm();
      if (value === 'yes' && (img.w > now.w || img.h > now.h)) {
        core.replaceOp(R.resizeCanvas(now, Math.min(MAX_SIDE, Math.max(now.w, img.w)), Math.min(MAX_SIDE, Math.max(now.h, img.h)), core.st.bg));
      }
    }
    const at = visibleTopLeft();
    core.beginOp();
    touched = null;
    setSel({ box: { x0: at.x, y0: at.y, x1: at.x + img.w - 1, y1: at.y + img.h - 1 }, mask: null, float: img });
  }
  async function pasteClipboard() {
    if (pasteClip()) return paste(R.cloneBitmap(clip!));
    let img: R.Bitmap | null = null;
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        img = await decode(await item.getType(type));
        if (img) break;
      }
    } catch {
      // no permission, no Clipboard API, or nothing readable: use the internal copy
    }
    img ??= clip && R.cloneBitmap(clip);
    if (img) await paste(img);
  }
  // Ctrl+V: the core leaves it to the browser, whose paste event carries the clipboard
  document.addEventListener('paste', (e) => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || !core.win.contains(a) || a.matches('input, textarea, select') || a.isContentEditable) return;
    const items = [...(e.clipboardData?.items ?? [])];
    const file = pasteClip()
      ? null
      : (items.find((it) => it.kind === 'file' && it.type.startsWith('image/'))?.getAsFile() ??
        [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/')) ??
        null);
    if (!file && !clip) return;
    e.preventDefault();
    void (async () => {
      const img = (file && (await decode(file))) || (clip && R.cloneBitmap(clip));
      if (img) await paste(img);
    })();
  });

  async function copyTo() {
    const img = selected();
    if (!img) return;
    const { value, form } = await core.dialog(
      'Copy To',
      core.el(
        '<div class="pt-form"><label for="pt-copyto">File name:</label><input id="pt-copyto" name="file" type="text" value="untitled" autocomplete="off" spellcheck="false" />' +
          '<span>Save as type:</span><span>PNG (*.png)</span></div>',
      ),
      [
        { label: 'Save', value: 'save', primary: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    );
    if (value !== 'save') return;
    const blob = await core.toPng(img).catch(() => null);
    if (blob) core.download(pngName(String(new FormData(form).get('file') ?? '')), blob);
  }

  // ── what the core and the Image menu see ─────────────────────────
  const api: Selection = {
    active: () => !!sel,
    box: () => (sel ? { ...sel.box } : null),
    transform(fn) {
      if (!sel) return false;
      if (drag) return true;
      lift(false);
      const f = sel.float!;
      const next = fn(f);
      if (next && next.w >= 1 && next.h >= 1 && next.data.length >= next.w * next.h) {
        sel.float = next;
        sel.box = { x0: sel.box.x0, y0: sel.box.y0, x1: sel.box.x0 + next.w - 1, y1: sel.box.y0 + next.h - 1 };
      }
      setSel(sel);
      return true;
    },
  };

  const tool = (id: 'select' | 'freeselect', help: string): Tool => ({
    id,
    help,
    options,
    down: (i) => down(i, id === 'freeselect'),
    move,
    up,
    cancel,
    hover: (p) => (core.canvas.style.cursor = sel && within(sel.box, p) ? 'move' : ''),
    key,
    flush: commit,
    busy: () => !!sel?.float,
    deactivate() {
      drag = null;
      commit();
    },
  });
  core.addTool(tool('freeselect', 'Selects a free-form part of the picture to move, copy, or edit.'));
  core.addTool(tool('select', 'Selects a rectangular part of the picture to move, copy, or edit.'));

  core.onMenu('cut', () => {
    if (copy()) clearSelection();
  });
  core.onMenu('copy', () => void copy());
  core.onMenu('paste', () => void pasteClipboard());
  core.onMenu('clearsel', clearSelection);
  core.onMenu('selectall', () => {
    if (takeOver()) setSel({ box: wholeBox(core.bm()), mask: null, float: null });
  });
  core.onMenu('copyto', () => void copyTo());
  core.onMenu('pastefrom', () =>
    void core.pickImage().then((img) => {
      if (img) return paste(img);
    }),
  );
  core.onMenu('opaque', () => {
    setOpaque(!core.st.opaque);
    core.redrawOptions();
  });
  core.setChecked('opaque', core.st.opaque);

  // a new background colour changes what is see-through in transparent mode
  const bgBox = core.win.querySelector('[data-pt-bg]');
  if (bgBox) new MutationObserver(() => showFloat(false)).observe(bgBox, { attributes: true, attributeFilter: ['style'] });

  // scrolling can shift the picture by part of a screen pixel: re-snap the marquee
  core.view.addEventListener('scroll', () => (sel || drag) && showAnts(), { passive: true });

  core.onLayout(() => {
    const bm = core.bm();
    if (bm !== lastBm) {
      // a new or resized picture: the selection belonged to the old one. The core
      // flushes before replacing the picture, so normally nothing is selected now.
      lastBm = bm;
      drag = null;
      touched = null;
      if (sel) setSel(null);
    }
    showFloat(false);
    showAnts();
  });
  setSel(null);
}
