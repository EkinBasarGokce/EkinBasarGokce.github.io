/**
 * The Curve and Polygon tools, as in Windows 98 Paint.
 *
 * Curve: drag a straight line, then drag twice to bend it. During the first
 * bend both control points follow the pointer (one smooth arc, as 98 Paint
 * and its clones do); the second bend moves the second control point only.
 * The curve is a cubic Bezier drawn as a chain of one-pixel strokeLine steps
 * with the round line-width stamp.
 *
 * Polygon: drag the first side, then click (or press, drag and let go) for
 * each further corner. A double-click (or double-tap), a click on the first
 * corner, Enter, switching tools or anything that flushes the tool closes it
 * and draws it with the current fill style. Shift snaps each side to steps of
 * 45 degrees.
 *
 * Each shape is one undo step: the op opens at the first press and closes
 * when the shape is final. Until then the preview lives in the picture and is
 * redrawn from core.opBefore() on every change. Esc cancels the whole shape.
 */
import * as R from '../raster';
import { type Core, type Pt, clipBox } from '../core';
import { lineWidthOptions, fillStyleOptions } from './basic';
import { bezierPixels, polygonSpans } from './polyfill';

/** two presses this close in time (ms) and place (CSS pixels) make a double-click */
const DOUBLE_MS = 500;
const DOUBLE_PX = { mouse: 6, touch: 24 };
/** a polygon closes on a click this near its first corner (picture pixels; touch: at least this many CSS pixels) */
const NEAR_PX = 2;
const NEAR_TOUCH_CSS = 12;

const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;

/** the bounding box of some points, grown by pad on every side */
function boxAround(pts: readonly Pt[], pad: number): R.Box | null {
  if (pts.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/** strokes a chain of points (one point: a single stamp) */
function chain(bm: R.Bitmap, pts: readonly Pt[], stamp: R.Stamp, c: R.Color, closed = false) {
  const first = pts[0];
  if (!first) return;
  if (pts.length === 1) return void R.strokeLine(bm, first.x, first.y, first.x, first.y, stamp, c);
  for (let k = 1; k < pts.length; k++) R.strokeLine(bm, pts[k - 1].x, pts[k - 1].y, pts[k].x, pts[k].y, stamp, c);
  const last = pts[pts.length - 1];
  if (closed && !same(first, last)) R.strokeLine(bm, last.x, last.y, first.x, first.y, stamp, c);
}

/**
 * The picture under the last preview: restore() puts it back from the op's
 * starting picture, keep() remembers the area just drawn.
 */
function previewArea(core: Core) {
  let box: R.Box | null = null;
  return {
    /** false when there is no open op to draw a preview against */
    restore(): boolean {
      const before = core.opBefore();
      if (!before) return false;
      if (box) R.restore(core.bm(), box, R.extract(before, box));
      box = null;
      return true;
    },
    keep(b: R.Box | null) {
      box = b && clipBox(core.bm(), b);
    },
    forget() {
      box = null;
    },
  };
}

/**
 * The core calls move() for every coalesced pointer event, so one frame can
 * bring many. soon() redraws once after the last of them (a microtask runs
 * before the next event) and shows it; now() redraws at once; drop() forgets
 * a redraw still waiting.
 */
function batched(core: Core, draw: () => void) {
  let queued = false;
  return {
    soon() {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        if (!queued) return;
        queued = false;
        draw();
        core.render();
      });
    },
    now() {
      queued = false;
      draw();
    },
    drop() {
      queued = false;
    },
  };
}

export function install(core: Core) {
  // ── Curve ────────────────────────────────────────────────────────
  {
    /** [start, end, first control, second control], filled in as the curve is drawn */
    let pts: Pt[] = [];
    let dragging = false;
    let ink: R.Color = 0;
    const area = previewArea(core);
    const help = 'Draws a curved line. Drag a straight line, then drag twice to bend it.';

    const draw = () => {
      if (!area.restore()) return reset();
      const [a, b, c1, c2] = pts;
      if (!a || !b) return;
      const bm = core.bm();
      const width = core.lineWidth();
      const stamp = R.stamps.round(width);
      const line = c1 ? bezierPixels(a, c1, c2 ?? c1, b) : [a, b];
      chain(bm, line, stamp, ink);
      area.keep(boxAround(line, width + 1));
    };
    const paint = batched(core, draw);
    const reset = () => {
      pts = [];
      dragging = false;
      paint.drop();
      area.forget();
      core.status.size('');
      core.status.help(help);
    };
    /** the curve as it is now becomes part of the picture */
    const finish = () => {
      if (!pts.length) return;
      reset();
      core.endOp();
    };
    const cancel = () => {
      if (!pts.length) return;
      reset();
      core.cancelOp();
    };
    const point = (p: Pt, shift: boolean): Pt => {
      // only the straight line snaps to 45 degrees, as the Line tool does
      if (pts.length !== 2 || !shift) return p;
      const [x, y] = R.constrainLine(pts[0].x, pts[0].y, p.x, p.y);
      return { x, y };
    };
    /** the point being dragged follows the pointer; true if it moved */
    const follow = (p: Pt, shift: boolean) => {
      const q = point(p, shift);
      const last = pts[pts.length - 1];
      if (last && same(last, q)) return false;
      pts[pts.length - 1] = q;
      if (pts.length === 2) core.status.size(`${Math.abs(q.x - pts[0].x) + 1}x${Math.abs(q.y - pts[0].y) + 1}`);
      return true;
    };

    core.addTool({
      id: 'curve',
      help,
      options: (box) => lineWidthOptions(core, box),
      down(i) {
        if (dragging) return;
        if (!pts.length) {
          core.beginOp();
          ink = i.ink;
          pts = [i.p, i.p];
        } else pts.push(i.p);
        dragging = true;
        paint.now();
      },
      move(i) {
        if (dragging && follow(i.p, i.shift)) paint.soon();
      },
      up(i) {
        if (!dragging) return;
        follow(i.p, i.shift);
        paint.now();
        dragging = false;
        core.status.size('');
        if (pts.length >= 4) finish();
        else core.status.help(pts.length === 2 ? 'Drag to bend the curve. Enter keeps it straight; Esc cancels.' : 'Drag to bend it once more. Enter keeps it as it is; Esc cancels.');
      },
      cancel,
      key(e) {
        if (!pts.length) return false;
        if (e.key === 'Escape') cancel();
        else if (e.key === 'Enter' && !dragging) finish();
        else return false;
        core.render();
        return true;
      },
      flush: finish,
      busy: () => pts.length > 0,
    });
  }

  // ── Polygon ──────────────────────────────────────────────────────
  {
    /** the corners placed so far */
    let pts: Pt[] = [];
    /** the free end of the side being placed (rubber band), or null */
    let band: Pt | null = null;
    let dragging = false;
    /** the second press of a double-click closed the polygon: ignore the rest of that press */
    let swallow = false;
    let ink: R.Color = 0;
    let paper: R.Color = 0;
    let lastDown = -Infinity;
    let lastUp: { x: number; y: number } | null = null;
    const area = previewArea(core);
    const help = 'Draws a polygon. Drag the first side, click each corner, double-click to finish. Shift: 45° steps.';
    const helpBusy = 'Click the next corner. Double-click or click the first corner to finish; Esc cancels.';

    /** the sides so far and the rubber band, in the ink colour */
    const draw = () => {
      if (!area.restore()) return reset();
      if (!pts.length) return;
      const bm = core.bm();
      const width = core.st.fillStyle === 2 ? 1 : core.lineWidth();
      const all = band && !same(band, pts[pts.length - 1]) ? [...pts, band] : pts;
      chain(bm, all, R.stamps.round(width), ink);
      area.keep(boxAround(all, width + 1));
    };
    const paint = batched(core, draw);
    const reset = () => {
      pts = [];
      band = null;
      dragging = false;
      lastUp = null;
      paint.drop();
      area.forget();
      core.status.size('');
      core.status.help(help);
    };
    /** close the polygon and draw it with the current fill style */
    const finish = () => {
      if (!pts.length) return;
      const corners = pts;
      const before = area.restore();
      reset();
      if (!before) return;
      const bm = core.bm();
      const [outline, fill] = core.shapeColors(ink, paper);
      if (fill !== null) {
        polygonSpans(corners, { x0: 0, y0: 0, x1: bm.w - 1, y1: bm.h - 1 }, (y, xa, xb) => R.rect(bm, xa, y, xb, y, 1, null, fill));
        // with no outline the fill also covers the sides themselves, as a filled rectangle covers its border
        if (outline === null) chain(bm, corners, R.stamps.dot, fill, true);
      }
      if (outline !== null) chain(bm, corners, R.stamps.round(core.lineWidth()), outline, true);
      core.endOp();
    };
    const cancel = () => {
      if (!pts.length) return;
      reset();
      core.cancelOp();
    };
    /** the end of the next side for a pointer at p (Shift: 45-degree steps from the last corner) */
    const sideEnd = (p: Pt, shift: boolean): Pt => {
      const last = pts[pts.length - 1];
      if (!shift || !last) return p;
      const [x, y] = R.constrainLine(last.x, last.y, p.x, p.y);
      return { x, y };
    };
    const showSide = () => {
      const last = pts[pts.length - 1];
      if (band && last) core.status.size(`${Math.abs(band.x - last.x) + 1}x${Math.abs(band.y - last.y) + 1}`);
    };
    const nearFirst = (p: Pt, e: PointerEvent) => {
      let tol = NEAR_PX;
      if (e.pointerType !== 'mouse') {
        const scale = core.canvas.getBoundingClientRect().width / core.bm().w; // CSS pixels per picture pixel
        if (scale > 0) tol = Math.max(tol, Math.ceil(NEAR_TOUCH_CSS / scale));
      }
      return Math.max(Math.abs(p.x - pts[0].x), Math.abs(p.y - pts[0].y)) <= tol;
    };

    core.addTool({
      id: 'polygon',
      help,
      options: (box) => fillStyleOptions(core, box),
      down(i) {
        if (dragging || swallow) return;
        const t = i.e.timeStamp;
        if (!pts.length) {
          core.beginOp();
          ink = i.ink;
          paper = i.paper;
          pts = [i.p];
          band = i.p;
        } else {
          // the second press of a double-click (or double-tap) at the corner just placed closes it
          const slop = i.e.pointerType === 'mouse' ? DOUBLE_PX.mouse : DOUBLE_PX.touch;
          if (pts.length >= 2 && lastUp && t - lastDown <= DOUBLE_MS && Math.hypot(i.e.clientX - lastUp.x, i.e.clientY - lastUp.y) <= slop) {
            swallow = true;
            finish();
            return;
          }
          band = sideEnd(i.p, i.shift);
        }
        lastDown = t;
        dragging = true;
        showSide();
        paint.now();
      },
      move(i) {
        if (!dragging) return;
        const q = sideEnd(i.p, i.shift);
        if (band && same(band, q)) return;
        band = q;
        showSide();
        paint.soon();
      },
      up(i) {
        if (swallow) return void (swallow = false);
        if (!dragging) return;
        dragging = false;
        lastUp = { x: i.e.clientX, y: i.e.clientY };
        core.status.size('');
        if (pts.length >= 3 && nearFirst(i.p, i.e)) return finish();
        const q = sideEnd(i.p, i.shift);
        if (!same(q, pts[pts.length - 1])) pts.push(q);
        band = q;
        core.status.help(helpBusy);
        paint.now();
      },
      hover(p, e) {
        if (!pts.length || dragging) return;
        const q = sideEnd(p, e.shiftKey);
        if (band && same(band, q)) return;
        band = q;
        paint.now();
        core.render();
      },
      dblclick() {
        // a double-click the press timing above did not catch (a slow double-click setting)
        if (pts.length < 2 || dragging) return;
        finish();
        core.render();
      },
      cancel() {
        swallow = false;
        cancel();
      },
      key(e) {
        if (!pts.length) return false;
        if (e.key === 'Escape') cancel();
        else if (e.key === 'Enter' && !dragging) finish();
        else return false;
        core.render();
        return true;
      },
      flush: finish,
      busy: () => pts.length > 0,
    });
  }
}
