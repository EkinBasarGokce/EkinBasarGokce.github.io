/**
 * The everyday tools: pencil, brush, eraser / colour eraser, fill, pick
 * colour, airbrush, line, rectangle, ellipse and rounded rectangle.
 * Also exports the line-width and fill-style option boxes for other modules.
 */
import * as R from '../raster';
import { type Core, type Tool, type PointerInfo, type Pt, LINE_WIDTHS, clipBox } from '../core';

const ERASER_SIZES = [4, 6, 8, 10];
const AIR_RADII = [4, 8, 12];
const BRUSHES: (() => R.Stamp)[] = [
  () => R.stamps.round(8),
  () => R.stamps.round(5),
  () => R.stamps.round(2),
  () => R.stamps.square(8),
  () => R.stamps.square(5),
  () => R.stamps.square(2),
  () => R.stamps.slash(8),
  () => R.stamps.slash(5),
  () => R.stamps.slash(2),
  () => R.stamps.backslash(8),
  () => R.stamps.backslash(5),
  () => R.stamps.backslash(2),
];

/** the five line widths (Line, Curve) */
export function lineWidthOptions(core: Core, box: HTMLElement) {
  box.append(
    core.optionButtons(
      5,
      1,
      30,
      9,
      core.st.line,
      (i) => `Line width ${LINE_WIDTHS[i]}`,
      (i, b, ink) => R.strokeLine(b, 4, 4, 25, 4, R.stamps.round(LINE_WIDTHS[i]), ink),
      (i) => (core.st.line = i),
    ),
  );
}

/** outline / outline and fill / fill only (rectangle, ellipse, rounded rectangle, polygon) */
export function fillStyleOptions(core: Core, box: HTMLElement) {
  const labels = ['Outline', 'Outline and fill', 'Fill only'];
  box.append(
    core.optionButtons(
      3,
      1,
      30,
      16,
      core.st.fillStyle,
      (i) => labels[i],
      (i, b, ink) => R.rect(b, 5, 3, 24, 12, 1, i === 2 ? null : ink, i === 0 ? null : R.rgb(128, 128, 128)),
      (i) => (core.st.fillStyle = i),
    ),
  );
}

export function install(core: Core) {
  const opt = { eraser: 2, brush: 0, air: 1 };

  // ── free-hand tools: every point the pointer passes ──────────────
  function freehand(id: 'pencil' | 'brush' | 'eraser', help: string, draw: (a: Pt, b: Pt, i: PointerInfo) => void, options?: (box: HTMLElement) => void): Tool {
    let last: Pt | null = null;
    return {
      id,
      help,
      options,
      down(i) {
        core.beginOp();
        last = i.p;
        draw(i.p, i.p, i);
      },
      move(i) {
        if (!last) return;
        draw(last, i.p, i);
        last = i.p;
      },
      up() {
        last = null;
        core.endOp();
      },
      cancel() {
        last = null;
        core.cancelOp();
      },
    };
  }

  core.addTool(freehand('pencil', 'Draws a free-form line one pixel wide.', (a, b, i) => R.strokeLine(core.bm(), a.x, a.y, b.x, b.y, R.stamps.dot, i.ink)));

  core.addTool(
    freehand(
      'brush',
      'Draws with the chosen brush shape.',
      (a, b, i) => R.strokeLine(core.bm(), a.x, a.y, b.x, b.y, BRUSHES[opt.brush](), i.ink),
      (box) =>
        box.append(
          core.optionButtons(12, 3, 11, 11, opt.brush, (i) => `Brush ${i + 1}`, (i, b, ink) => R.stampAt(b, 5, 5, BRUSHES[i](), ink), (i) => (opt.brush = i)),
        ),
    ),
  );

  core.addTool(
    freehand(
      'eraser',
      'Erases to the background color. Right-drag changes only the foreground color.',
      (a, b, i) => {
        const stamp = R.stamps.square(ERASER_SIZES[opt.eraser]);
        const bm = core.bm();
        // right button: the Color Eraser, which only replaces the foreground colour
        if (i.button === 2) R.bresenham(a.x, a.y, b.x, b.y, (x, y) => R.replaceColor(bm, x, y, stamp, core.st.fg, core.st.bg));
        else R.strokeLine(bm, a.x, a.y, b.x, b.y, stamp, core.st.bg);
      },
      (box) =>
        box.append(
          core.optionButtons(
            4,
            1,
            30,
            13,
            opt.eraser,
            (i) => `Eraser size ${ERASER_SIZES[i]}`,
            (i, b, ink) => R.stampAt(b, 15, 6, R.stamps.square(ERASER_SIZES[i]), ink),
            (i) => (opt.eraser = i),
          ),
        ),
    ),
  );

  // ── fill and pick ────────────────────────────────────────────────
  core.addTool({
    id: 'fill',
    help: 'Fills an enclosed area with the current color.',
    cursor: 'cell',
    down(i) {
      core.beginOp();
      R.floodFill(core.bm(), i.p.x, i.p.y, i.ink);
      core.endOp();
    },
  });

  const pickAt = (i: PointerInfo) => {
    const c = R.getPixel(core.bm(), i.p.x, i.p.y);
    if (c === undefined) return;
    if (i.button === 2) core.setBg(c);
    else core.setFg(c);
  };
  core.addTool({
    id: 'pick',
    help: 'Picks up a color from the picture.',
    cursor: 'cell',
    down: pickAt,
    move: pickAt,
    up: () => core.setTool(core.previousTool()),
  });

  // ── airbrush ─────────────────────────────────────────────────────
  {
    let at: Pt | null = null;
    let ink = 0;
    let timer = 0;
    const spray = () => {
      if (!at) return;
      const r = AIR_RADII[opt.air];
      R.spray(core.bm(), at.x, at.y, r, Math.round(r * 1.6), ink, Math.random);
      core.render();
    };
    const stop = () => {
      clearInterval(timer);
      timer = 0;
      at = null;
    };
    core.addTool({
      id: 'airbrush',
      help: 'Sprays paint. Hold still for a denser spray.',
      options: (box) =>
        box.append(
          core.optionButtons(
            3,
            1,
            30,
            22,
            opt.air,
            (i) => `Spray size ${AIR_RADII[i]}`,
            (i, b, c) => {
              let seed = 7;
              R.spray(b, 15, 11, Math.min(10, AIR_RADII[i]), 10 + i * 8, c, () => (seed = (seed * 16807) % 2147483647) / 2147483647);
            },
            (i) => (opt.air = i),
          ),
        ),
      down(i) {
        core.beginOp();
        at = i.p;
        ink = i.ink;
        spray();
        timer = window.setInterval(spray, 40);
      },
      move(i) {
        at = i.p;
      },
      up() {
        stop();
        core.endOp();
      },
      cancel() {
        stop();
        core.cancelOp();
      },
    });
  }

  // ── line and shapes: redrawn from the starting picture on every move ──
  function shape(id: 'line' | 'rect' | 'ellipse' | 'roundrect', help: string): Tool {
    let start: Pt | null = null;
    let preview: R.Box | null = null;
    let ink = 0;
    let paper = 0;
    const draw = (p: Pt, shift: boolean) => {
      const before = core.opBefore();
      if (!start || !before) return;
      const bm = core.bm();
      if (preview) R.restore(bm, preview, R.extract(before, preview));
      let { x, y } = p;
      const width = core.lineWidth();
      if (id === 'line') {
        if (shift) [x, y] = R.constrainLine(start.x, start.y, x, y);
        R.strokeLine(bm, start.x, start.y, x, y, R.stamps.round(width), ink);
        const pad = width + 1;
        preview = clipBox(bm, { x0: Math.min(start.x, x) - pad, y0: Math.min(start.y, y) - pad, x1: Math.max(start.x, x) + pad, y1: Math.max(start.y, y) + pad });
      } else {
        if (shift) [x, y] = R.constrainSquare(start.x, start.y, x, y);
        const [outline, fill] = core.shapeColors(ink, paper);
        const fn = id === 'rect' ? R.rect : id === 'ellipse' ? R.ellipse : R.roundRect;
        fn(bm, start.x, start.y, x, y, width, outline, fill);
        preview = clipBox(bm, { x0: Math.min(start.x, x), y0: Math.min(start.y, y), x1: Math.max(start.x, x), y1: Math.max(start.y, y) });
      }
      core.status.size(`${Math.abs(x - start.x) + 1}x${Math.abs(y - start.y) + 1}`);
    };
    return {
      id,
      help,
      options: (box) => (id === 'line' ? lineWidthOptions(core, box) : fillStyleOptions(core, box)),
      down(i) {
        core.beginOp();
        start = i.p;
        preview = null;
        ink = i.ink;
        paper = i.paper;
        draw(i.p, i.shift);
      },
      move(i) {
        draw(i.p, i.shift);
      },
      up() {
        start = null;
        preview = null;
        core.status.size('');
        core.endOp();
      },
      cancel() {
        start = null;
        preview = null;
        core.status.size('');
        core.cancelOp();
      },
    };
  }
  core.addTool(shape('line', 'Draws a straight line. Hold Shift for steps of 45 degrees.'));
  core.addTool(shape('rect', 'Draws a rectangle. Hold Shift for a square.'));
  core.addTool(shape('ellipse', 'Draws an ellipse. Hold Shift for a circle.'));
  core.addTool(shape('roundrect', 'Draws a rounded rectangle. Hold Shift for a square.'));
}
