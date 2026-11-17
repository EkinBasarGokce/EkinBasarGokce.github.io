/**
 * Paint: the controller. Tools, colours, undo, files, autosave and dialogs.
 * Pixels are drawn by raster.ts into a Bitmap whose memory is shared with an
 * ImageData, so showing a change is one putImageData of the changed box.
 * Loaded the first time the Paint window opens (see scripts/desktop/apps.ts).
 */
import type { WM } from '../wm';
import * as R from './raster';

type ToolId = 'eraser' | 'fill' | 'pick' | 'pencil' | 'brush' | 'airbrush' | 'line' | 'rect' | 'ellipse' | 'roundrect';
type Patch = { kind: 'box'; box: R.Box; before: Uint32Array; after: Uint32Array } | { kind: 'full'; before: R.Bitmap; after: R.Bitmap };

const WHITE = R.rgb(255, 255, 255);
const BLACK = R.rgb(0, 0, 0);
const STORE = 'paint-autosave-v1';
const MAX_UNDO = 100;
const MAX_UNDO_BYTES = 96 * 1024 * 1024;
const MAX_SIDE = 2048;

const ERASER_SIZES = [4, 6, 8, 10];
const AIR_RADII = [4, 8, 12];
const LINE_WIDTHS = [1, 2, 3, 4, 5];
const BRUSHES: (() => R.Stamp)[] = [
  () => R.stamps.round(8), () => R.stamps.round(5), () => R.stamps.round(2),
  () => R.stamps.square(8), () => R.stamps.square(5), () => R.stamps.square(2),
  () => R.stamps.slash(8), () => R.stamps.slash(5), () => R.stamps.slash(2),
  () => R.stamps.backslash(8), () => R.stamps.backslash(5), () => R.stamps.backslash(2),
];

const HELP: Record<ToolId, string> = {
  eraser: 'Erases to the background color. Right-drag changes only the foreground color.',
  fill: 'Fills an enclosed area with the current color.',
  pick: 'Picks up a color from the picture.',
  pencil: 'Draws a free-form line one pixel wide.',
  brush: 'Draws with the chosen brush shape.',
  airbrush: 'Sprays paint. Hold still for a denser spray.',
  line: 'Draws a straight line. Hold Shift for steps of 45 degrees.',
  rect: 'Draws a rectangle. Hold Shift for a square.',
  ellipse: 'Draws an ellipse. Hold Shift for a circle.',
  roundrect: 'Draws a rounded rectangle. Hold Shift for a square.',
};

const hex = (c: R.Color) => '#' + R.toRGB(c).map((v) => v.toString(16).padStart(2, '0')).join('');
const parseHex = (h: string) => R.rgb(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
const union = (a: R.Box | null, b: R.Box | null): R.Box | null =>
  !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
const area = (b: R.Box) => (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
const wholeBox = (bm: R.Bitmap): R.Box => ({ x0: 0, y0: 0, x1: bm.w - 1, y1: bm.h - 1 });

let started = false;

/** Called on every open of the Paint window; sets everything up the first time. */
export function openPaint(wm: WM) {
  if (started) return;
  started = true;
  setup(wm);
}

function setup(wm: WM) {
  const win = document.getElementById('paint')!;
  const $ = <T extends Element = HTMLElement>(sel: string) => win.querySelector<T>(sel)!;
  const canvas = $<HTMLCanvasElement>('[data-pt-canvas]');
  const ctx = canvas.getContext('2d')!;
  const view = $('[data-pt-view]');
  const ghost = $('[data-pt-ghost]');
  const optionsBox = $('[data-pt-options]');
  const helpLine = $('[data-pt-help]');
  const posLine = $('[data-pt-pos]');
  const sizeLine = $('[data-pt-size]');
  const fileInput = $<HTMLInputElement>('[data-pt-file]');
  const toolButtons = [...win.querySelectorAll<HTMLButtonElement>('[data-tool]')];

  // ── State ────────────────────────────────────────────────────────
  const st = {
    tool: 'pencil' as ToolId,
    prevTool: 'pencil' as ToolId,
    fg: BLACK,
    bg: WHITE,
    eraser: 2,
    brush: 0,
    air: 1,
    line: 0,
    fillStyle: 0,
  };
  let bm = R.createBitmap(canvas.width, canvas.height, WHITE);
  let img = imageOf(bm);
  let name = 'untitled';
  let named = false;
  let dirty = false;
  const undo: Patch[] = [];
  const redo: Patch[] = [];

  function imageOf(b: R.Bitmap) {
    return new ImageData(new Uint8ClampedArray(b.data.buffer as ArrayBuffer, b.data.byteOffset, b.data.byteLength), b.w, b.h);
  }
  /** show the changed part of the picture; inside an operation, remember the box for undo */
  let opBefore: R.Bitmap | null = null;
  let opBox: R.Box | null = null;
  function render() {
    const d = R.takeDirty(bm);
    if (!d) return;
    if (opBefore) opBox = union(opBox, d);
    ctx.putImageData(img, 0, 0, d.x0, d.y0, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1);
  }
  /** a new bitmap (new, open, resize, rotate): resize the canvas and show all of it */
  function adopt(next: R.Bitmap) {
    bm = next;
    img = imageOf(bm);
    canvas.width = bm.w;
    canvas.height = bm.h;
    R.takeDirty(bm);
    ctx.putImageData(img, 0, 0);
  }

  // ── Undo ─────────────────────────────────────────────────────────
  const bytes = (p: Patch) => (p.kind === 'box' ? p.before.byteLength * 2 : (p.before.data.byteLength + p.after.data.byteLength));
  function push(p: Patch) {
    undo.push(p);
    redo.length = 0;
    let total = undo.reduce((n, q) => n + bytes(q), 0);
    while (undo.length > MAX_UNDO || (total > MAX_UNDO_BYTES && undo.length > 1)) total -= bytes(undo.shift()!);
    changed();
  }
  function beginOp() {
    render();
    opBefore = R.cloneBitmap(bm);
    opBox = null;
  }
  function endOp() {
    render();
    if (opBefore && opBox) {
      push({ kind: 'box', box: opBox, before: R.extract(opBefore, opBox), after: R.extract(bm, opBox) });
    }
    opBefore = null;
    opBox = null;
  }
  function cancelOp() {
    if (opBefore && opBox) R.restore(bm, opBox, R.extract(opBefore, opBox));
    const box = opBox;
    opBefore = null;
    opBox = null;
    if (box) render();
  }
  /** a change to the whole picture that keeps its size */
  function wholeOp(fn: () => void) {
    beginOp();
    fn();
    R.markDirty(bm, wholeBox(bm));
    endOp();
  }
  /** a change that replaces the bitmap (size may change) */
  function replaceOp(next: R.Bitmap) {
    const before = R.cloneBitmap(bm);
    adopt(next);
    push({ kind: 'full', before, after: R.cloneBitmap(next) });
  }
  function step(from: Patch[], to: Patch[], back: boolean) {
    if (drag) return;
    const p = from.pop();
    if (!p) return;
    if (p.kind === 'box') {
      R.restore(bm, p.box, back ? p.before : p.after);
      render();
    } else adopt(R.cloneBitmap(back ? p.before : p.after));
    to.push(p);
    changed();
  }

  // ── Title, dirty flag and autosave ───────────────────────────────
  const title = () => wm.setTitle('paint', `${name} - Paint`);
  let saveTimer = 0;
  function changed() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(autosave, 700);
  }
  function autosave() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ name, named, dirty, png: canvas.toDataURL('image/png') }));
    } catch {
      // storage full or blocked: the drawing isn't kept across visits, and an
      // older copy must not come back in its place
      try {
        localStorage.removeItem(STORE);
      } catch {}
    }
  }
  function forget() {
    clearTimeout(saveTimer);
    try {
      localStorage.removeItem(STORE);
    } catch {}
  }
  async function restoreAutosave() {
    let saved: { name?: string; named?: boolean; dirty?: boolean; png?: string } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    } catch {}
    if (!saved?.png || !saved.png.startsWith('data:image/png;base64,')) return false;
    const loaded = await bitmapFromUrl(saved.png).catch(() => null);
    if (!loaded) return false;
    adopt(loaded);
    name = typeof saved.name === 'string' ? saved.name.slice(0, 120) : 'untitled';
    named = !!saved.named;
    dirty = !!saved.dirty;
    title();
    return true;
  }

  // ── Turning images into bitmaps ──────────────────────────────────
  async function bitmapFromSource(src: CanvasImageSource & { width: number; height: number }) {
    // pictures larger than Paint can hold are scaled down to fit, not cropped
    const k = Math.min(1, MAX_SIDE / Math.max(src.width, src.height, 1));
    const w = Math.max(1, Math.round(src.width * k));
    const h = Math.max(1, Math.round(src.height * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cx = c.getContext('2d')!;
    cx.fillStyle = '#ffffff'; // transparent parts become white, as Paint had no transparency
    cx.fillRect(0, 0, w, h);
    cx.drawImage(src, 0, 0, w, h);
    const data = cx.getImageData(0, 0, w, h).data;
    const out = R.createBitmap(w, h, WHITE);
    out.data.set(new Uint32Array(data.buffer, data.byteOffset, w * h));
    return out;
  }
  function bitmapFromUrl(url: string) {
    return new Promise<R.Bitmap>((resolve, reject) => {
      const im = new Image();
      im.onload = () => bitmapFromSource(im).then(resolve, reject);
      im.onerror = reject;
      im.src = url;
    });
  }

  // ── Dialogs (native <dialog>, dressed as 98 windows) ─────────────
  function dialog(heading: string, body: HTMLElement, buttons: { label: string; value: string; primary?: boolean }[]) {
    return new Promise<{ value: string; form: HTMLFormElement }>((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'win pt-dialog';
      d.setAttribute('data-active', '');
      d.setAttribute('aria-label', heading);
      const bar = document.createElement('header');
      bar.className = 'title';
      const h = document.createElement('h2');
      h.textContent = heading;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tb';
      close.setAttribute('aria-label', 'Close');
      close.innerHTML = win.querySelector('.title [data-act="close"]')!.innerHTML;
      const btns = document.createElement('div');
      btns.className = 'title-btns';
      btns.append(close);
      bar.append(h, btns);
      const form = document.createElement('form');
      form.className = 'pad';
      form.method = 'dialog';
      const row = document.createElement('div');
      row.className = 'dlg-buttons';
      for (const b of buttons) {
        const el = document.createElement('button');
        el.className = b.primary ? 'btn default' : 'btn';
        el.value = b.value;
        el.textContent = b.label;
        if (!b.primary) el.type = b.value === 'cancel' ? 'button' : 'submit';
        if (b.value === 'cancel') el.addEventListener('click', () => d.close('cancel'));
        row.append(el);
      }
      form.append(body, row);
      d.append(bar, form);
      close.addEventListener('click', () => d.close('cancel'));
      d.addEventListener('close', () => {
        d.remove();
        canvas.focus({ preventScroll: true });
        resolve({ value: d.returnValue || 'cancel', form });
      });
      document.body.append(d);
      d.showModal();
      (d.querySelector<HTMLElement>('input, select') ?? d.querySelector<HTMLElement>('.btn.default'))?.focus();
    });
  }
  const el = (html: string) => {
    const t = document.createElement('div');
    t.innerHTML = html;
    return t;
  };
  const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  /** "Save changes to untitled?" Resolves true when it is fine to go on. */
  async function askToSave() {
    if (!dirty) return true;
    const { value } = await dialog(
      'Paint',
      el(`<p class="pt-ask">Save changes to ${escapeHtml(name)}?</p>`),
      [
        { label: 'Yes', value: 'yes', primary: true },
        { label: 'No', value: 'no' },
        { label: 'Cancel', value: 'cancel' },
      ],
    );
    if (value === 'cancel') return false;
    if (value === 'yes') return save(false);
    return true;
  }

  // ── Files ────────────────────────────────────────────────────────
  async function download(file: string, type: 'png' | 'bmp') {
    const blob = type === 'bmp' ? encodeBmp(bm) : await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return false;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  }
  async function save(as: boolean): Promise<boolean> {
    let file = name;
    if (as || !named) {
      const base = name.replace(/\.(png|bmp|jpe?g|gif|webp|ico|avif|tiff?)$/i, '');
      const wasBmp = /\.bmp$/i.test(name);
      const { value, form } = await dialog(
        'Save As',
        el(
          `<div class="pt-form"><label for="pt-name">File name:</label><input id="pt-name" name="file" type="text" value="${escapeHtml(base)}" autocomplete="off" spellcheck="false" />` +
            `<label for="pt-type">Save as type:</label><select id="pt-type" name="type"><option value="png">PNG (*.png)</option><option value="bmp"${wasBmp ? ' selected' : ''}>24-bit Bitmap (*.bmp)</option></select></div>`,
        ),
        [
          { label: 'Save', value: 'save', primary: true },
          { label: 'Cancel', value: 'cancel' },
        ],
      );
      if (value !== 'save') return false;
      const data = new FormData(form);
      const typed = String(data.get('file') ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim();
      // a typed .bmp or .png wins over the list
      const ext = /\.bmp$/i.test(typed) ? 'bmp' : /\.png$/i.test(typed) ? 'png' : null;
      const type = ext ?? (data.get('type') === 'bmp' ? 'bmp' : 'png');
      const clean = typed.replace(/\.(png|bmp|jpe?g|gif|webp|ico|avif|tiff?)$/i, '') || 'untitled';
      file = `${clean.slice(0, 100)}.${type}`;
    }
    const ok = await download(file, /\.bmp$/i.test(file) ? 'bmp' : 'png');
    if (!ok) return false;
    name = file;
    named = true;
    dirty = false;
    title();
    autosave();
    return true;
  }
  async function newPicture() {
    if (!(await askToSave())) return;
    adopt(R.createBitmap(bm.w, bm.h, WHITE));
    undo.length = 0;
    redo.length = 0;
    name = 'untitled';
    named = false;
    dirty = false;
    title();
    forget();
  }
  async function openPicture() {
    if (!(await askToSave())) return;
    fileInput.value = '';
    fileInput.click();
  }
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const pic = await createImageBitmap(file);
      const next = await bitmapFromSource(pic);
      pic.close();
      adopt(next);
      undo.length = 0;
      redo.length = 0;
      name = file.name.replace(/[\u0000-\u001f]/g, '').slice(0, 120) || 'untitled';
      // Save goes through Save As unless the picture is a PNG/BMP kept at its size
      named = /\.(png|bmp)$/i.test(name) && next.w === pic.width && next.h === pic.height;
      dirty = false;
      title();
      autosave();
    } catch {
      await dialog('Paint', el(`<p class="pt-ask">Paint cannot read this file. Try a PNG, JPEG, GIF, BMP or WebP picture.</p>`), [
        { label: 'OK', value: 'ok', primary: true },
      ]);
    }
  });

  // ── Image menu ───────────────────────────────────────────────────
  async function flipRotate() {
    const { value, form } = await dialog(
      'Flip and Rotate',
      el(
        `<fieldset class="pt-radios"><legend>Flip or rotate</legend>` +
          `<label class="check-row"><input type="radio" name="op" value="h" checked /><span>Flip horizontal</span></label>` +
          `<label class="check-row"><input type="radio" name="op" value="v" /><span>Flip vertical</span></label>` +
          `<label class="check-row"><input type="radio" name="op" value="90" /><span>Rotate by 90°</span></label>` +
          `<label class="check-row"><input type="radio" name="op" value="180" /><span>Rotate by 180°</span></label>` +
          `<label class="check-row"><input type="radio" name="op" value="270" /><span>Rotate by 270°</span></label></fieldset>`,
      ),
      [
        { label: 'OK', value: 'ok', primary: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    );
    if (value !== 'ok') return;
    const op = new FormData(form).get('op');
    if (op === 'h') wholeOp(() => R.flipH(bm));
    else if (op === 'v') wholeOp(() => R.flipV(bm));
    else if (op === '90' || op === '180' || op === '270') replaceOp(R.rotate(bm, Number(op) as 90 | 180 | 270));
  }
  async function attributes() {
    const { value, form } = await dialog(
      'Attributes',
      el(
        `<div class="pt-form"><label for="pt-w">Width:</label><input id="pt-w" name="w" type="number" min="1" max="${MAX_SIDE}" value="${bm.w}" />` +
          `<label for="pt-h">Height:</label><input id="pt-h" name="h" type="number" min="1" max="${MAX_SIDE}" value="${bm.h}" /><span></span><span>Units: pixels</span></div>`,
      ),
      [
        { label: 'OK', value: 'ok', primary: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    );
    if (value !== 'ok') return;
    const data = new FormData(form);
    const w = Math.round(Number(data.get('w')));
    const h = Math.round(Number(data.get('h')));
    if (!(w >= 1 && h >= 1)) return;
    resizeTo(Math.min(MAX_SIDE, w), Math.min(MAX_SIDE, h));
  }
  function resizeTo(w: number, h: number) {
    if (w === bm.w && h === bm.h) return;
    replaceOp(R.resizeCanvas(bm, w, h, st.bg));
  }
  async function about() {
    await dialog(
      'About Paint',
      el(
        `<div class="pt-about"><img src="${win.querySelector<HTMLImageElement>('.title-icon')!.src}" width="32" height="32" alt="" /><p><b>Paint</b><br />A small drawing program for this desktop.<br /><br />Your picture stays in this browser. Nothing is uploaded; Save downloads it to your computer.</p></div>`,
      ),
      [{ label: 'OK', value: 'ok', primary: true }],
    );
  }

  // ── Tools and options ────────────────────────────────────────────
  function setTool(t: ToolId) {
    if (t !== 'pick') st.prevTool = t;
    st.tool = t;
    for (const b of toolButtons) {
      const on = b.dataset.tool === t;
      b.setAttribute('aria-pressed', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    helpLine.textContent = HELP[t];
    canvas.dataset.tool = t;
    drawOptions();
  }
  toolButtons.forEach((b, i) => {
    b.addEventListener('click', () => setTool(b.dataset.tool as ToolId));
    b.addEventListener('mouseenter', () => (helpLine.textContent = HELP[b.dataset.tool as ToolId]));
    b.addEventListener('mouseleave', () => (helpLine.textContent = HELP[st.tool]));
    b.addEventListener('keydown', (e) => {
      const d = { ArrowDown: 2, ArrowUp: -2, ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const next = toolButtons[(i + d + toolButtons.length) % toolButtons.length];
      next.focus();
      setTool(next.dataset.tool as ToolId);
    });
  });

  /** the options box under the tools, drawn with the same pixel engine */
  function preview(w: number, h: number, draw: (b: R.Bitmap, ink: R.Color) => void, selected: boolean) {
    const b = R.createBitmap(w, h, selected ? R.rgb(0, 0, 128) : R.rgb(192, 192, 192));
    draw(b, selected ? WHITE : BLACK);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(b.data.buffer as ArrayBuffer), w, h), 0, 0);
    return c;
  }
  function optionButtons(count: number, cols: number, w: number, h: number, current: number, label: (i: number) => string, draw: (i: number, b: R.Bitmap, ink: R.Color) => void, pick: (i: number) => void) {
    const grid = document.createElement('div');
    grid.className = 'pt-optgrid';
    grid.style.gridTemplateColumns = `repeat(${cols}, ${w}px)`;
    for (let i = 0; i < count; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pt-opt';
      b.setAttribute('aria-pressed', String(i === current));
      b.setAttribute('aria-label', label(i));
      b.append(preview(w, h, (bm2, ink) => draw(i, bm2, ink), i === current));
      b.addEventListener('click', () => {
        pick(i);
        drawOptions();
        optionsBox.querySelectorAll<HTMLElement>('.pt-opt')[i]?.focus();
      });
      grid.append(b);
    }
    return grid;
  }
  function drawOptions() {
    optionsBox.replaceChildren();
    const t = st.tool;
    if (t === 'eraser') {
      optionsBox.append(
        optionButtons(4, 1, 30, 13, st.eraser, (i) => `Eraser size ${ERASER_SIZES[i]}`, (i, b, ink) => R.stampAt(b, 15, 6, R.stamps.square(ERASER_SIZES[i]), ink), (i) => (st.eraser = i)),
      );
    } else if (t === 'brush') {
      optionsBox.append(
        optionButtons(12, 3, 11, 11, st.brush, (i) => `Brush ${i + 1}`, (i, b, ink) => R.stampAt(b, 5, 5, BRUSHES[i](), ink), (i) => (st.brush = i)),
      );
    } else if (t === 'airbrush') {
      optionsBox.append(
        optionButtons(3, 1, 30, 22, st.air, (i) => `Spray size ${AIR_RADII[i]}`, (i, b, ink) => {
          let seed = 7;
          R.spray(b, 15, 11, Math.min(10, AIR_RADII[i]), 10 + i * 8, ink, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
        }, (i) => (st.air = i)),
      );
    } else if (t === 'line') {
      optionsBox.append(
        optionButtons(5, 1, 30, 9, st.line, (i) => `Line width ${LINE_WIDTHS[i]}`, (i, b, ink) => R.strokeLine(b, 4, 4, 25, 4, R.stamps.round(LINE_WIDTHS[i]), ink), (i) => (st.line = i)),
      );
    } else if (t === 'rect' || t === 'ellipse' || t === 'roundrect') {
      const labels = ['Outline', 'Outline and fill', 'Fill only'];
      optionsBox.append(
        optionButtons(3, 1, 30, 16, st.fillStyle, (i) => labels[i], (i, b, ink) => {
          const grey = R.rgb(128, 128, 128);
          R.rect(b, 5, 3, 24, 12, 1, i === 2 ? null : ink, i === 0 ? null : grey);
        }, (i) => (st.fillStyle = i)),
      );
    }
  }

  // ── Colours ──────────────────────────────────────────────────────
  const fgBox = $('[data-pt-fg]');
  const bgBox = $('[data-pt-bg]');
  function showColors() {
    fgBox.style.background = hex(st.fg);
    bgBox.style.background = hex(st.bg);
  }
  win.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((sw) => {
    const color = parseHex(sw.dataset.color!);
    let longPress = 0;
    let usedLong = false;
    sw.addEventListener('click', () => {
      if (usedLong) return void (usedLong = false);
      st.fg = color;
      showColors();
    });
    sw.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      st.bg = color;
      showColors();
    });
    // a finger has no right button: a long press picks the background color
    sw.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      usedLong = false;
      longPress = window.setTimeout(() => {
        usedLong = true;
        st.bg = color;
        showColors();
      }, 500);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) sw.addEventListener(ev, () => clearTimeout(longPress));
  });

  // ── Drawing on the canvas ────────────────────────────────────────
  type Drag = {
    id: number;
    button: number;
    x0: number;
    y0: number;
    x: number;
    y: number;
    ink: R.Color;
    paper: R.Color;
    preview: R.Box | null;
    timer: number;
  };
  let drag: Drag | null = null;

  const toPixel = (e: { clientX: number; clientY: number }) => {
    // At fractional zoom (1.25) picture pixels cover 1 or 2 screen pixels; measure
    // from the centre of the pointer's screen pixel against the canvas edges as
    // they are actually drawn (snapped to device pixels).
    const r = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    const L = snap(r.left);
    const T = snap(r.top);
    return [
      Math.floor(((e.clientX + 0.5 / dpr - L) * bm.w) / (snap(r.right) - L)),
      Math.floor(((e.clientY + 0.5 / dpr - T) * bm.h) / (snap(r.bottom) - T)),
    ] as const;
  };
  const shapeFn = { rect: R.rect, ellipse: R.ellipse, roundrect: R.roundRect } as const;

  /** lines and shapes are redrawn from the starting picture on every move */
  function drawShape(d: Drag, shift: boolean) {
    if (!opBefore) return;
    if (d.preview) R.restore(bm, d.preview, R.extract(opBefore, d.preview));
    let { x, y } = d;
    const width = LINE_WIDTHS[st.line];
    if (st.tool === 'line') {
      if (shift) [x, y] = R.constrainLine(d.x0, d.y0, x, y);
      R.strokeLine(bm, d.x0, d.y0, x, y, R.stamps.round(width), d.ink);
      const pad = width + 1;
      d.preview = clip({ x0: Math.min(d.x0, x) - pad, y0: Math.min(d.y0, y) - pad, x1: Math.max(d.x0, x) + pad, y1: Math.max(d.y0, y) + pad });
    } else {
      if (shift) [x, y] = R.constrainSquare(d.x0, d.y0, x, y);
      const fn = shapeFn[st.tool as keyof typeof shapeFn];
      const [outline, fill] = st.fillStyle === 0 ? [d.ink, null] : st.fillStyle === 1 ? [d.ink, d.paper] : [null, d.ink];
      fn(bm, d.x0, d.y0, x, y, width, outline, fill);
      d.preview = clip({ x0: Math.min(d.x0, x), y0: Math.min(d.y0, y), x1: Math.max(d.x0, x), y1: Math.max(d.y0, y) });
    }
    sizeLine.textContent = `${Math.abs(x - d.x0) + 1}x${Math.abs(y - d.y0) + 1}`;
    render();
  }
  const clip = (b: R.Box): R.Box | null => {
    const c = { x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(bm.w - 1, b.x1), y1: Math.min(bm.h - 1, b.y1) };
    return c.x0 > c.x1 || c.y0 > c.y1 ? null : c;
  };

  function strokeTo(d: Drag, x: number, y: number) {
    const t = st.tool;
    if (t === 'pencil') R.strokeLine(bm, d.x, d.y, x, y, R.stamps.dot, d.ink);
    else if (t === 'brush') R.strokeLine(bm, d.x, d.y, x, y, BRUSHES[st.brush](), d.ink);
    else if (t === 'eraser') {
      const stamp = R.stamps.square(ERASER_SIZES[st.eraser]);
      if (d.button === 2) R.bresenham(d.x, d.y, x, y, (px, py) => R.replaceColor(bm, px, py, stamp, st.fg, st.bg));
      else R.strokeLine(bm, d.x, d.y, x, y, stamp, st.bg);
    }
    d.x = x;
    d.y = y;
  }
  function sprayOnce(d: Drag) {
    const r = AIR_RADII[st.air];
    R.spray(bm, d.x, d.y, r, Math.round(r * 1.6), d.ink, Math.random);
    render();
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // A right-button drag can end outside the picture; on Windows the browser then
  // fires its context menu wherever the pointer is. Swallow that one menu.
  let swallowMenu = 0;
  addEventListener(
    'contextmenu',
    (e) => {
      if (!swallowMenu) return;
      clearTimeout(swallowMenu);
      swallowMenu = 0;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
  const armMenuSwallow = () => {
    clearTimeout(swallowMenu);
    swallowMenu = window.setTimeout(() => (swallowMenu = 0), 60_000);
  };
  const disarmMenuSwallow = () => {
    const t = swallowMenu;
    if (t) window.setTimeout(() => {
      if (swallowMenu === t) {
        clearTimeout(t);
        swallowMenu = 0;
      }
    }, 400);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (drag) return;
    const button = e.pointerType === 'mouse' ? e.button : 0;
    if (button !== 0 && button !== 2) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = toPixel(e);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return; // the canvas has no size right now
    if (button === 2) armMenuSwallow();
    const ink = button === 2 ? st.bg : st.fg;
    const paper = button === 2 ? st.fg : st.bg;
    const d: Drag = { id: e.pointerId, button, x0: x, y0: y, x, y, ink, paper, preview: null, timer: 0 };
    const t = st.tool;
    if (t === 'pick') {
      pickAt(d, x, y);
      drag = d;
      return;
    }
    if (t === 'fill') {
      beginOp();
      R.floodFill(bm, x, y, ink);
      endOp();
      return;
    }
    drag = d;
    beginOp();
    if (t === 'airbrush') {
      sprayOnce(d);
      d.timer = window.setInterval(() => sprayOnce(d), 40);
    } else if (t === 'line' || t === 'rect' || t === 'ellipse' || t === 'roundrect') drawShape(d, e.shiftKey);
    else {
      strokeTo(d, x, y);
      render();
    }
  });
  function pickAt(d: Drag, x: number, y: number) {
    const c = R.getPixel(bm, x, y);
    if (c === undefined) return;
    if (d.button === 2) st.bg = c;
    else st.fg = c;
    showColors();
  }
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = toPixel(e);
    posLine.textContent = x >= 0 && y >= 0 && x < bm.w && y < bm.h ? `${x},${y}` : '';
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    const t = st.tool;
    if (t === 'pick') return pickAt(d, x, y);
    if (t === 'airbrush') {
      d.x = x;
      d.y = y;
      return;
    }
    if (t === 'line' || t === 'rect' || t === 'ellipse' || t === 'roundrect') {
      d.x = x;
      d.y = y;
      return drawShape(d, e.shiftKey);
    }
    // every point the pointer passed, not just one per frame
    const points = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const p of points.length ? points : [e]) {
      const [px, py] = toPixel(p);
      strokeTo(d, px, py);
    }
    render();
  });
  function finish(e: PointerEvent, cancelled = false) {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    clearInterval(d.timer);
    sizeLine.textContent = '';
    if (d.button === 2) disarmMenuSwallow();
    if (st.tool === 'pick') {
      if (!cancelled) setTool(st.prevTool);
      return;
    }
    if (cancelled) cancelOp();
    else endOp();
  }
  canvas.addEventListener('pointerup', (e) => finish(e));
  canvas.addEventListener('pointercancel', (e) => finish(e, true));
  canvas.addEventListener('pointerleave', () => (posLine.textContent = ''));
  canvas.addEventListener('lostpointercapture', (e) => drag && finish(e));

  // ── Resizing the picture by its handles ──────────────────────────
  win.querySelectorAll<HTMLElement>('[data-pt-handle]').forEach((handle) => {
    handle.addEventListener('click', () => {}); // a tap target, so a finger lands here, not on the canvas
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || drag) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const dir = handle.dataset.ptHandle!;
      const r = canvas.getBoundingClientRect();
      const scale = r.width / bm.w; // screen pixels per picture pixel
      const sx = e.clientX;
      const sy = e.clientY;
      let w = bm.w;
      let h = bm.h;
      ghost.hidden = false;
      const local = canvas.offsetWidth / bm.w; // page pixels per picture pixel
      const move = (m: PointerEvent) => {
        if (dir.includes('e')) w = Math.max(1, Math.min(MAX_SIDE, Math.round(bm.w + (m.clientX - sx) / scale)));
        if (dir.includes('s')) h = Math.max(1, Math.min(MAX_SIDE, Math.round(bm.h + (m.clientY - sy) / scale)));
        ghost.style.width = `${w * local}px`;
        ghost.style.height = `${h * local}px`;
        sizeLine.textContent = `${w}x${h}`;
      };
      move(e);
      const end = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        ghost.hidden = true;
        sizeLine.textContent = '';
        resizeTo(w, h);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
  });

  // ── Menus and keys ───────────────────────────────────────────────
  const toggleView = (action: string, sel: string) => {
    const target = win.querySelector<HTMLElement>(sel)!;
    target.hidden = !target.hidden;
    win.querySelector(`[data-action="${action}"]`)?.setAttribute('aria-checked', String(!target.hidden));
  };
  win.addEventListener('menu', (e) => {
    const a = (e as CustomEvent<string>).detail;
    if (drag) return;
    canvas.focus({ preventScroll: true }); // shortcuts keep working; dialogs take focus themselves
    if (a === 'new') void newPicture();
    else if (a === 'open') void openPicture();
    else if (a === 'save') void save(false);
    else if (a === 'saveas') void save(true);
    else if (a === 'undo') step(undo, redo, true);
    else if (a === 'redo') step(redo, undo, false);
    else if (a === 'view-tools') toggleView(a, '[data-pt-toolbox]');
    else if (a === 'view-colors') toggleView(a, '[data-pt-colorbox]');
    else if (a === 'view-status') toggleView(a, '.pt-status');
    else if (a === 'fliprotate') void flipRotate();
    else if (a === 'invert') wholeOp(() => R.invert(bm));
    else if (a === 'attributes') void attributes();
    else if (a === 'clear') wholeOp(() => R.rect(bm, 0, 0, bm.w - 1, bm.h - 1, 1, null, st.bg));
    else if (a === 'about') void about();
  });
  win.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('input, textarea, select')) return;
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      const d = drag;
      drag = null;
      clearInterval(d.timer);
      sizeLine.textContent = '';
      if (st.tool !== 'pick') cancelOp();
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const map: Record<string, string> = { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', s: 'save', o: 'open', i: 'invert' };
    const action = map[k];
    if (!action) return;
    e.preventDefault();
    win.dispatchEvent(new CustomEvent('menu', { detail: action }));
  });

  // ── Opening and closing ──────────────────────────────────────────
  wm.hook('paint', {
    beforeClose: async () => {
      if (drag) return false;
      const ok = await askToSave();
      if (ok) {
        forget();
        dirty = false;
      }
      return ok;
    },
    onClose: () => {
      // a fresh picture next time, as in 98
      adopt(R.createBitmap(bm.w, bm.h, WHITE));
      undo.length = 0;
      redo.length = 0;
      name = 'untitled';
      named = false;
      dirty = false;
      title();
    },
  });
  // keep the drawing if the visitor leaves or reloads while Paint is open
  addEventListener('pagehide', () => {
    if (wm.isOpen('paint') && dirty) autosave();
  });

  setTool('pencil');
  showColors();
  title();
  void (async () => {
    if (await restoreAutosave()) return;
    // a first picture that fits the window
    // leave room for the padding and the resize handles, so no scroll bars appear
    const w = Math.max(64, Math.min(640, view.clientWidth - 22));
    const h = Math.max(64, Math.min(480, view.clientHeight - 22));
    adopt(R.createBitmap(w, h, WHITE));
  })();
}

/** A 24-bit Windows bitmap (.bmp), bottom-up rows padded to 4 bytes. */
function encodeBmp(bm: R.Bitmap): Blob {
  const row = Math.ceil((bm.w * 3) / 4) * 4;
  const size = 54 + row * bm.h;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  v.setUint8(0, 0x42);
  v.setUint8(1, 0x4d);
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, bm.w, true);
  v.setInt32(22, bm.h, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, row * bm.h, true);
  v.setInt32(38, 2835, true); // 72 dpi
  v.setInt32(42, 2835, true);
  const out = new Uint8Array(buf);
  for (let y = 0; y < bm.h; y++) {
    let o = 54 + (bm.h - 1 - y) * row;
    for (let x = 0; x < bm.w; x++) {
      const [r, g, b] = R.toRGB(bm.data[y * bm.w + x]);
      out[o++] = b;
      out[o++] = g;
      out[o++] = r;
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}
