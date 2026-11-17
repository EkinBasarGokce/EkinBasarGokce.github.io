/**
 * The Magnifier and View > Zoom, as in Windows 98 Paint: Normal Size, Large
 * Size, Custom..., Show Grid and View Bitmap, with their shortcuts
 * (Ctrl+PageUp, Ctrl+PageDown, Ctrl+G, Ctrl+F).
 *
 * The Magnifier never changes the picture. At 1x a click zooms in on the
 * clicked point (a rectangle shows the part that will fill the view); when
 * zoomed, a click or a right-click goes back to 1x. Either way it then hands
 * back to the tool used before it, as 98 does.
 */
import * as R from '../raster';
import { type Core, type Pt, paintCanvas } from '../core';
import './magnifier.css';

/** the options box, as in 98 (Large Size, 4x, is on the View menu) */
const LEVELS = [1, 2, 6, 8];
/** Custom Zoom's choices */
const CUSTOM = [1, 2, 4, 6, 8];
const LARGE = 4;
/** the grid shows from this zoom up */
const GRID_FROM = 4;
const SVG = 'http://www.w3.org/2000/svg';

// 5x7 glyphs for the option labels, drawn with the pixel engine like the rest of the options box
const GLYPHS: Record<string, string[]> = {
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
};
function drawLabel(b: R.Bitmap, text: string, c: R.Color) {
  let x = Math.floor((b.w - (text.length * 6 - 1)) / 2);
  const y = Math.floor((b.h - 7) / 2);
  for (const ch of text) {
    GLYPHS[ch]?.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) if (row[dx] === '#') R.setPixel(b, x + dx, y + dy, c);
    });
    x += 6;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function install(core: Core) {
  const { win, canvas, view, overlay } = core;
  /** what a click on the picture at 1x zooms to (the last level chosen in the options box) */
  let level = LARGE;
  let gridOn = false;
  let pressed: { p: Pt; button: 0 | 2 } | null = null;
  let shownZoom = core.zoom();

  /** device pixels per CSS pixel inside the Paint window (page zoom x devicePixelRatio) */
  const deviceScale = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const page = el.offsetWidth > 0 && r.width > 0 ? r.width / el.offsetWidth : 1;
    return page * (devicePixelRatio || 1);
  };

  /** where the canvas sits in the grey view's scrolling content (local CSS pixels) */
  function canvasOffset() {
    let x = 0;
    let y = 0;
    for (let e: HTMLElement | null = canvas; e && e !== view; e = e.offsetParent as HTMLElement | null) {
      x += e.offsetLeft;
      y += e.offsetTop;
    }
    return { x, y };
  }

  /** the picture pixel in the middle of the part of the picture in view */
  function viewCentre(): Pt {
    const bm = core.bm();
    const z = core.zoom();
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (!W || !H) return { x: bm.w >> 1, y: bm.h >> 1 };
    const o = canvasOffset();
    const x0 = clamp(view.scrollLeft - o.x, 0, W);
    const x1 = clamp(view.scrollLeft - o.x + view.clientWidth, 0, W);
    const y0 = clamp(view.scrollTop - o.y, 0, H);
    const y1 = clamp(view.scrollTop - o.y + view.clientHeight, 0, H);
    return { x: clamp(Math.floor((x0 + x1) / 2 / z), 0, bm.w - 1), y: clamp(Math.floor((y0 + y1) / 2 / z), 0, bm.h - 1) };
  }

  const zoomTo = (z: number, at: Pt = viewCentre()) => core.setZoom(z, at);

  // ── The Magnifier ────────────────────────────────────────────────
  /** the part of the picture that zooming in on p to z brings into view */
  function zoomBox(p: Pt, z: number): R.Box {
    const bm = core.bm();
    const cs = getComputedStyle(view);
    const vw = view.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const vh = view.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const w = clamp(Math.floor(vw / z), 1, bm.w);
    const h = clamp(Math.floor(vh / z), 1, bm.h);
    const x0 = clamp(p.x - (w >> 1), 0, bm.w - w);
    const y0 = clamp(p.y - (h >> 1), 0, bm.h - h);
    return { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 };
  }
  const middle = (b: R.Box): Pt => ({ x: (b.x0 + b.x1 + 1) >> 1, y: (b.y0 + b.y1 + 1) >> 1 });

  // at 1x, an inverted rectangle shows what a click will zoom in on (as in 98)
  const preview = document.createElement('div');
  preview.className = 'pt-mag-rect';
  preview.hidden = true;
  overlay.append(preview);
  const hidePreview = () => void (preview.hidden = true);
  canvas.addEventListener('pointerleave', hidePreview);

  const cursor = () => void (canvas.style.cursor = core.zoom() > 1 ? 'zoom-out' : 'zoom-in');

  /** a click (or Enter) at p: zoom in at 1x, otherwise back to 1x; then hand back */
  function magnify(p: Pt, button: 0 | 2) {
    const bm = core.bm();
    const at = { x: clamp(p.x, 0, bm.w - 1), y: clamp(p.y, 0, bm.h - 1) };
    hidePreview();
    if (core.zoom() === 1) {
      if (button !== 0) return; // right-click zooms out; there is nothing to zoom out of
      zoomTo(level, middle(zoomBox(at, level)));
    } else zoomTo(1, at);
    core.setTool(core.previousTool());
  }

  core.addTool({
    id: 'magnifier',
    help: 'Changes the magnification.',
    cursor: 'zoom-in',
    options(box) {
      const z = core.zoom();
      const opts = core.optionButtons(
        LEVELS.length,
        1,
        30,
        11,
        LEVELS.indexOf(z),
        (i) => `Zoom ${LEVELS[i]}x`,
        (i, b, ink) => drawLabel(b, `${LEVELS[i]}x`, ink),
        (i) => {
          const next = LEVELS[i];
          if (next !== 1) level = next;
          zoomTo(next);
        },
      );
      opts.classList.add('pt-mag-opts');
      box.append(opts);
      // Large Size (4x) has no button: say what the zoom is
      if (!LEVELS.includes(z)) {
        const now = document.createElement('p');
        now.className = 'pt-mag-now';
        now.textContent = `Now ${z}x`;
        box.append(now);
      }
    },
    hover(p) {
      const bm = core.bm();
      const inside = p.x >= 0 && p.y >= 0 && p.x < bm.w && p.y < bm.h;
      if (inside && core.zoom() === 1) core.place(preview, zoomBox(p, level));
      preview.hidden = !inside || core.zoom() !== 1;
    },
    down(i) {
      pressed = { p: i.p, button: i.button };
      hidePreview();
    },
    up() {
      const d = pressed;
      pressed = null;
      if (d) magnify(d.p, d.button);
    },
    cancel() {
      pressed = null;
    },
    key(e) {
      // Enter or Space on the picture acts like a click in the middle of the view
      if (e.target !== canvas || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'Enter' && e.key !== ' ')) return false;
      magnify(viewCentre(), 0);
      return true;
    },
    activate: cursor,
    deactivate() {
      pressed = null;
      hidePreview();
    },
  });

  // ── Show Grid ────────────────────────────────────────────────────
  // One rectangle one device pixel wide along the left and top edge of every
  // picture pixel, drawn without anti-aliasing, so each line covers exactly
  // the first row or column of screen pixels that the canvas gives that pixel.
  // Rows and columns go in separate, short paths: Chrome stops drawing a path
  // with thousands of crossing parts.
  const grid = document.createElementNS(SVG, 'svg');
  grid.setAttribute('class', 'pt-grid');
  grid.setAttribute('aria-hidden', 'true');
  overlay.prepend(grid); // under marquees and text boxes
  let gridKey = '';

  function drawGrid() {
    const z = core.zoom();
    const show = gridOn && z >= GRID_FROM;
    grid.style.display = show ? '' : 'none';
    if (!show || !canvas.offsetWidth) return; // (not laid out: keep the last grid)
    const bm = core.bm();
    const k = deviceScale(canvas);
    const key = `${bm.w}x${bm.h}@${z}/${k}`;
    if (key === gridKey) return;
    gridKey = key;
    const W = bm.w * z;
    const H = bm.h * z;
    const t = 1 / k; // one device pixel
    const e = 0.01 / k; // a hair to the left, so a line on a half device pixel lands on the canvas's own pixel edge
    const f = (n: number) => +n.toFixed(5);
    grid.setAttribute('width', String(W));
    grid.setAttribute('height', String(H));
    grid.setAttribute('viewBox', `0 0 ${W} ${H}`);
    grid.style.width = `${W}px`;
    grid.style.height = `${H}px`;
    const paths: SVGPathElement[] = [];
    const add = (n: number, line: (i: number) => string) => {
      for (let i = 0; i < n; i += 256) {
        const p = document.createElementNS(SVG, 'path');
        p.setAttribute('shape-rendering', 'crispEdges');
        let d = '';
        for (let j = i; j < Math.min(n, i + 256); j++) d += line(j);
        p.setAttribute('d', d);
        paths.push(p);
      }
    };
    add(bm.w, (x) => `M${f(x * z - e)} 0h${f(t)}V${H}h${f(-t)}z`);
    add(bm.h, (y) => `M0 ${f(y * z - e)}h${W}v${f(t)}H0z`);
    grid.replaceChildren(...paths);
  }
  addEventListener('resize', () => gridOn && drawGrid()); // page zoom or devicePixelRatio may have changed

  // ── View Bitmap: the picture at actual size, filling the screen ─
  let viewing: HTMLDialogElement | null = null;
  function viewBitmap() {
    if (viewing) return;
    const bm = core.bm();
    const d = document.createElement('dialog');
    d.className = 'pt-viewbitmap';
    d.tabIndex = -1;
    d.setAttribute('aria-label', 'View Bitmap');
    const pic = document.createElement('canvas');
    pic.setAttribute('role', 'img');
    pic.setAttribute('aria-label', 'The picture at actual size. Press any key or click to return to Paint.');
    paintCanvas(pic, bm);
    d.append(pic);
    viewing = d;
    // one picture pixel to a whole number of device pixels (one, on an ordinary screen)
    const fit = () => {
      const dpr = devicePixelRatio || 1;
      const css = Math.max(1, Math.round(dpr)) / deviceScale(d);
      pic.style.width = `${bm.w * css}px`;
      pic.style.height = `${bm.h * css}px`;
    };
    const done = () => d.open && d.close();
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) done(); // a held Ctrl+F must not close it again at once
    };
    d.addEventListener('click', done);
    d.addEventListener('auxclick', done);
    d.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      done();
    });
    addEventListener('keydown', onKey, true);
    addEventListener('resize', fit);
    d.addEventListener('close', () => {
      removeEventListener('keydown', onKey, true);
      removeEventListener('resize', fit);
      d.remove();
      viewing = null;
      canvas.focus({ preventScroll: true });
    });
    document.body.append(d);
    d.showModal();
    fit();
    d.focus({ preventScroll: true });
  }

  // ── Custom Zoom ──────────────────────────────────────────────────
  async function customZoom() {
    const z = core.zoom();
    const body = core.el(
      `<p class="pt-mag-current">Current zoom: ${z * 100}%</p>` +
        `<fieldset class="pt-radios pt-mag-zoomto"><legend>Zoom to</legend>` +
        CUSTOM.map((v) => `<label class="check-row"><input type="radio" name="zoom" value="${v}"${v === z ? ' checked' : ''} /><span>${v * 100}%</span></label>`).join('') +
        `</fieldset>`,
    );
    const answer = core.dialog('Custom Zoom', body, [
      { label: 'OK', value: 'ok', primary: true },
      { label: 'Cancel', value: 'cancel' },
    ]);
    body.querySelector<HTMLInputElement>('input:checked')?.focus(); // start on the current zoom
    const { value, form } = await answer;
    if (value !== 'ok') return;
    const next = Number(new FormData(form).get('zoom'));
    if (CUSTOM.includes(next)) zoomTo(next);
  }

  // ── Menus, keys and layout ───────────────────────────────────────
  core.onMenu('zoom-1', () => zoomTo(1));
  core.onMenu('zoom-4', () => zoomTo(LARGE));
  core.onMenu('zoom-custom', () => void customZoom());
  core.onMenu('grid', () => {
    gridOn = !gridOn;
    core.setChecked('grid', gridOn);
    drawGrid();
  });
  core.onMenu('viewbitmap', viewBitmap);

  // these work whichever tool is chosen, so they live here rather than in Tool.key
  win.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.isContentEditable || t.matches('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    const action = e.key === 'PageDown' ? 'zoom-4' : e.key === 'PageUp' ? 'zoom-1' : e.shiftKey ? '' : k === 'g' ? 'grid' : k === 'f' ? 'viewbitmap' : '';
    if (!action) return;
    e.preventDefault();
    if (e.repeat && (action === 'grid' || action === 'viewbitmap')) return; // a held key toggles once
    win.dispatchEvent(new CustomEvent('menu', { detail: action }));
  });

  core.onLayout(() => {
    drawGrid();
    const z = core.zoom();
    if (z !== 1) hidePreview();
    if (z === shownZoom) return;
    shownZoom = z;
    if (core.currentTool() === 'magnifier') {
      cursor();
      core.redrawOptions();
    }
  });
}
