/**
 * Paint: the controller. It owns the picture, undo, files, autosave, dialogs,
 * colours, the view (zoom, overlay) and the menus, and implements the Core
 * contract (core.ts) that the tool and feature modules are written against.
 * Pixels are drawn by raster.ts into a Bitmap whose memory is shared with an
 * ImageData, so showing a change is one putImageData of the changed box.
 * Loaded the first time the Paint window opens (see scripts/desktop/apps.ts).
 */
import type { WM } from '../wm';
import * as R from './raster';
import {
  type Core,
  type Tool,
  type ToolId,
  type PointerInfo,
  type Pt,
  type DialogButton,
  WHITE,
  BLACK,
  MAX_SIDE,
  LINE_WIDTHS,
  hex,
  parseHex,
  union,
  wholeBox,
  imageOf,
} from './core';
import { install as installBasic } from './tools/basic';

type Patch = { kind: 'box'; box: R.Box; before: Uint32Array; after: Uint32Array } | { kind: 'full'; before: R.Bitmap; after: R.Bitmap };

const STORE = 'paint-autosave-v1';
const MAX_UNDO = 100;
const MAX_UNDO_BYTES = 96 * 1024 * 1024;

/** feature modules, installed after the basic tools (each exports install(core)) */
const MODULES = import.meta.glob<{ install: (core: Core) => void }>(['./tools/*.ts', './extras/*.ts', '!./tools/basic.ts', '!./**/*.test.ts'], { eager: true });

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
  const overlay = $('[data-pt-overlay]');
  const ghost = $('[data-pt-ghost]');
  const optionsBox = $('[data-pt-options]');
  const helpLine = $('[data-pt-help]');
  const posLine = $('[data-pt-pos]');
  const sizeLine = $('[data-pt-size]');
  const fileInput = $<HTMLInputElement>('[data-pt-file]');
  const toolButtons = [...win.querySelectorAll<HTMLButtonElement>('[data-tool]')];
  const swatches = [...win.querySelectorAll<HTMLButtonElement>('[data-color]')];

  // ── State ────────────────────────────────────────────────────────
  const st = { fg: BLACK, bg: WHITE, line: 0, fillStyle: 0, opaque: true };
  const tools = new Map<ToolId, Tool>();
  let toolId: ToolId = 'pencil';
  let prevToolId: ToolId = 'pencil';
  let bm = R.createBitmap(canvas.width, canvas.height, WHITE);
  let img = imageOf(bm);
  let zoomLevel = 1;
  let name = 'untitled';
  let named = false;
  let dirty = false;
  const undo: Patch[] = [];
  const redo: Patch[] = [];
  const menus = new Map<string, () => void>();
  const layoutFns: (() => void)[] = [];
  const tool = () => tools.get(toolId);

  /** show the changed part of the picture; inside an operation, remember the box for undo */
  let opBefore: R.Bitmap | null = null;
  let opBox: R.Box | null = null;
  function render() {
    const d = R.takeDirty(bm);
    if (!d) return;
    if (opBefore) opBox = union(opBox, d);
    ctx.putImageData(img, 0, 0, d.x0, d.y0, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1);
  }
  /** size the canvas and the overlay for the picture and the zoom */
  function layout() {
    const w = `${bm.w * zoomLevel}px`;
    const h = `${bm.h * zoomLevel}px`;
    canvas.style.width = w;
    canvas.style.height = h;
    overlay.style.width = w;
    overlay.style.height = h;
    for (const fn of layoutFns) fn();
  }
  /** a new bitmap (new, open, resize, rotate): resize the canvas and show all of it */
  function adopt(next: R.Bitmap) {
    bm = next;
    img = imageOf(bm);
    canvas.width = bm.w;
    canvas.height = bm.h;
    R.takeDirty(bm);
    ctx.putImageData(img, 0, 0);
    layout();
  }

  // ── Undo ─────────────────────────────────────────────────────────
  const bytes = (p: Patch) => (p.kind === 'box' ? p.before.byteLength * 2 : p.before.data.byteLength + p.after.data.byteLength);
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
    if (opBefore && opBox) push({ kind: 'box', box: opBox, before: R.extract(opBefore, opBox), after: R.extract(bm, opBox) });
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
  function wholeOp(fn: () => void) {
    beginOp();
    fn();
    R.markDirty(bm, wholeBox(bm));
    endOp();
  }
  function replaceOp(next: R.Bitmap) {
    const before = R.cloneBitmap(bm);
    adopt(next);
    push({ kind: 'full', before, after: R.cloneBitmap(next) });
  }
  function step(from: Patch[], to: Patch[], back: boolean) {
    if (drag) return;
    flush();
    const p = from.pop();
    if (!p) return;
    if (p.kind === 'box') {
      R.restore(bm, p.box, back ? p.before : p.after);
      render();
    } else adopt(R.cloneBitmap(back ? p.before : p.after));
    to.push(p);
    changed();
  }
  function flush() {
    tool()?.flush?.();
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

  // ── Turning images into bitmaps and back ─────────────────────────
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
    R.takeDirty(out);
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
  function toPng(b: R.Bitmap) {
    const c = document.createElement('canvas');
    c.width = b.w;
    c.height = b.h;
    c.getContext('2d')!.putImageData(imageOf(b), 0, 0);
    return new Promise<Blob>((resolve, reject) => c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG'))), 'image/png'));
  }
  function download(file: string, blob: Blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  /** the hidden file input, shared by Open and Paste From */
  let pickResolve: ((f: File | null) => void) | null = null;
  function pickFile() {
    return new Promise<File | null>((resolve) => {
      pickResolve?.(null);
      pickResolve = resolve;
      fileInput.value = '';
      fileInput.click();
    });
  }
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0] ?? null;
    pickResolve?.(f);
    pickResolve = null;
  });
  fileInput.addEventListener('cancel', () => {
    pickResolve?.(null);
    pickResolve = null;
  });
  async function pickImage() {
    const file = await pickFile();
    if (!file) return null;
    try {
      const pic = await createImageBitmap(file);
      const out = await bitmapFromSource(pic);
      pic.close();
      return out;
    } catch {
      await cantRead();
      return null;
    }
  }
  const cantRead = () =>
    dialog('Paint', el(`<p class="pt-ask">Paint cannot read this file. Try a PNG, JPEG, GIF, BMP or WebP picture.</p>`), [{ label: 'OK', value: 'ok', primary: true }]);

  // ── Dialogs (native <dialog>, dressed as 98 windows) ─────────────
  function dialog(heading: string, body: HTMLElement, buttons: DialogButton[]) {
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
        const bt = document.createElement('button');
        bt.className = b.primary ? 'btn default' : 'btn';
        bt.value = b.value;
        bt.textContent = b.label;
        if (!b.primary) bt.type = b.value === 'cancel' ? 'button' : 'submit';
        if (b.value === 'cancel') bt.addEventListener('click', () => d.close('cancel'));
        row.append(bt);
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
    flush();
    if (!dirty) return true;
    const { value } = await dialog('Paint', el(`<p class="pt-ask">Save changes to ${escapeHtml(name)}?</p>`), [
      { label: 'Yes', value: 'yes', primary: true },
      { label: 'No', value: 'no' },
      { label: 'Cancel', value: 'cancel' },
    ]);
    if (value === 'cancel') return false;
    if (value === 'yes') return save(false);
    return true;
  }

  // ── Files ────────────────────────────────────────────────────────
  async function save(as: boolean): Promise<boolean> {
    flush();
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
    const blob = /\.bmp$/i.test(file) ? encodeBmp(bm) : await toPng(bm).catch(() => null);
    if (!blob) return false;
    download(file, blob);
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
    const file = await pickFile();
    if (!file) return;
    try {
      const pic = await createImageBitmap(file);
      const next = await bitmapFromSource(pic);
      const fits = next.w === pic.width && next.h === pic.height;
      pic.close();
      adopt(next);
      undo.length = 0;
      redo.length = 0;
      name = file.name.replace(/[\u0000-\u001f]/g, '').slice(0, 120) || 'untitled';
      // Save goes through Save As unless the picture is a PNG/BMP kept at its size
      named = /\.(png|bmp)$/i.test(name) && fits;
      dirty = false;
      title();
      autosave();
    } catch {
      await cantRead();
    }
  }

  // ── Image menu ───────────────────────────────────────────────────
  /** flip, rotate, invert, stretch: act on the selection if there is one */
  function transformPicture(fn: (b: R.Bitmap) => R.Bitmap) {
    if (core.selection?.transform(fn)) return;
    flush();
    const next = fn(R.cloneBitmap(bm));
    if (next.w === bm.w && next.h === bm.h) wholeOp(() => bm.data.set(next.data));
    else replaceOp(next);
  }
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
    if (op === 'h') transformPicture((b) => (R.flipH(b), b));
    else if (op === 'v') transformPicture((b) => (R.flipV(b), b));
    else if (op === '90' || op === '180' || op === '270') transformPicture((b) => R.rotate(b, Number(op) as 90 | 180 | 270));
  }
  async function attributes() {
    flush();
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
    flush();
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
  function setTool(id: ToolId) {
    const next = tools.get(id);
    if (!next || drag) return;
    if (id !== toolId) {
      const cur = tool();
      cur?.flush?.();
      cur?.deactivate?.();
      // Pick Color and the Magnifier hand back to the tool used before them
      if (toolId !== 'pick' && toolId !== 'magnifier') prevToolId = toolId;
      toolId = id;
    }
    for (const b of toolButtons) {
      const on = b.dataset.tool === id;
      b.setAttribute('aria-pressed', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    helpLine.textContent = next.help;
    canvas.dataset.tool = id;
    canvas.style.cursor = next.cursor ?? '';
    drawOptions();
    next.activate?.();
  }
  toolButtons.forEach((b, i) => {
    b.addEventListener('click', () => setTool(b.dataset.tool as ToolId));
    b.addEventListener('mouseenter', () => (helpLine.textContent = tools.get(b.dataset.tool as ToolId)?.help ?? ''));
    b.addEventListener('mouseleave', () => (helpLine.textContent = tool()?.help ?? ''));
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
    c.getContext('2d')!.putImageData(imageOf(b), 0, 0);
    return c;
  }
  function optionButtons(
    count: number,
    cols: number,
    w: number,
    h: number,
    current: number,
    label: (i: number) => string,
    draw: (i: number, b: R.Bitmap, ink: R.Color) => void,
    pick: (i: number) => void,
  ) {
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
    tool()?.options?.(optionsBox);
  }

  // ── Colours ──────────────────────────────────────────────────────
  const fgBox = $('[data-pt-fg]');
  const bgBox = $('[data-pt-bg]');
  function showColors() {
    fgBox.style.background = hex(st.fg);
    bgBox.style.background = hex(st.bg);
  }
  const colorOf = (sw: HTMLElement) => parseHex(sw.dataset.color!);
  for (const sw of swatches) {
    let longPress = 0;
    let usedLong = false;
    sw.addEventListener('click', () => {
      if (usedLong) return void (usedLong = false);
      st.fg = colorOf(sw);
      showColors();
    });
    sw.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      st.bg = colorOf(sw);
      showColors();
    });
    // a finger has no right button: a long press picks the background color
    sw.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      usedLong = false;
      longPress = window.setTimeout(() => {
        usedLong = true;
        st.bg = colorOf(sw);
        showColors();
      }, 500);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) sw.addEventListener(ev, () => clearTimeout(longPress));
  }

  // ── Pointer input on the picture ─────────────────────────────────
  let drag: { id: number; button: 0 | 2 } | null = null;

  const toPixel = (e: { clientX: number; clientY: number }): Pt => {
    // At fractional zoom (1.25) picture pixels cover 1 or 2 screen pixels; measure
    // from the centre of the pointer's screen pixel against the canvas edges as
    // they are actually drawn (snapped to device pixels).
    const r = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    const L = snap(r.left);
    const T = snap(r.top);
    return {
      x: Math.floor(((e.clientX + 0.5 / dpr - L) * bm.w) / (snap(r.right) - L)),
      y: Math.floor(((e.clientY + 0.5 / dpr - T) * bm.h) / (snap(r.bottom) - T)),
    };
  };
  const info = (p: Pt, e: PointerEvent, button: 0 | 2): PointerInfo => ({
    p,
    button,
    shift: e.shiftKey,
    ctrl: e.ctrlKey || e.metaKey,
    ink: button === 2 ? st.bg : st.fg,
    paper: button === 2 ? st.fg : st.bg,
    e,
  });

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
    if (t)
      window.setTimeout(() => {
        if (swallowMenu === t) {
          clearTimeout(t);
          swallowMenu = 0;
        }
      }, 400);
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (drag) return;
    const raw = e.pointerType === 'mouse' ? e.button : 0;
    if (raw !== 0 && raw !== 2) return;
    const button = raw as 0 | 2;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    const p = toPixel(e);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return; // the canvas has no size right now
    canvas.setPointerCapture(e.pointerId);
    if (button === 2) armMenuSwallow();
    drag = { id: e.pointerId, button };
    tool()?.down?.(info(p, e, button));
    render();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toPixel(e);
    posLine.textContent = p.x >= 0 && p.y >= 0 && p.x < bm.w && p.y < bm.h ? `${p.x},${p.y}` : '';
    const t = tool();
    if (!drag) {
      t?.hover?.(p, e);
      return;
    }
    if (e.pointerId !== drag.id) return;
    // every point the pointer passed, not just one per frame
    const points = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const q of points.length ? points : [e]) t?.move?.(info(toPixel(q), q, drag.button));
    render();
  });
  function finish(e: PointerEvent, cancelled: boolean) {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    if (d.button === 2) disarmMenuSwallow();
    const t = tool();
    if (cancelled) t?.cancel?.();
    else t?.up?.(info(toPixel(e), e, d.button));
    render();
  }
  canvas.addEventListener('pointerup', (e) => finish(e, false));
  canvas.addEventListener('pointercancel', (e) => finish(e, true));
  canvas.addEventListener('lostpointercapture', (e) => drag && finish(e, true));
  canvas.addEventListener('pointerleave', () => (posLine.textContent = ''));
  canvas.addEventListener('dblclick', (e) => tool()?.dblclick?.(toPixel(e), e));

  // ── Resizing the picture by its handles ──────────────────────────
  win.querySelectorAll<HTMLElement>('[data-pt-handle]').forEach((handle) => {
    handle.addEventListener('click', () => {}); // a tap target, so a finger lands here, not on the canvas
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || drag) return;
      e.preventDefault();
      flush();
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
  const setChecked = (action: string, on: boolean) =>
    win.querySelector(`[data-action="${action}"]`)?.setAttribute('aria-checked', String(on));
  const toggleView = (action: string, sel: string) => {
    const target = win.querySelector<HTMLElement>(sel)!;
    target.hidden = !target.hidden;
    setChecked(action, !target.hidden);
  };
  const onMenu = (action: string, fn: () => void) => void menus.set(action, fn);
  onMenu('new', () => void newPicture());
  onMenu('open', () => void openPicture());
  onMenu('save', () => void save(false));
  onMenu('saveas', () => void save(true));
  onMenu('undo', () => step(undo, redo, true));
  onMenu('redo', () => step(redo, undo, false));
  onMenu('view-tools', () => toggleView('view-tools', '[data-pt-toolbox]'));
  onMenu('view-colors', () => toggleView('view-colors', '[data-pt-colorbox]'));
  onMenu('view-status', () => toggleView('view-status', '.pt-status'));
  onMenu('fliprotate', () => void flipRotate());
  onMenu('invert', () => transformPicture((b) => (R.invert(b), b)));
  onMenu('attributes', () => void attributes());
  onMenu('clear', () => {
    flush();
    wholeOp(() => R.rect(bm, 0, 0, bm.w - 1, bm.h - 1, 1, null, st.bg));
  });
  onMenu('about', () => void about());

  win.addEventListener('menu', (e) => {
    const a = (e as CustomEvent<string>).detail;
    if (drag) return;
    canvas.focus({ preventScroll: true }); // shortcuts keep working; dialogs take focus themselves
    menus.get(a)?.();
  });
  win.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const typing = target.matches('input, textarea, select, [contenteditable]');
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      drag = null;
      tool()?.cancel?.();
      render();
      return;
    }
    if (!typing && tool()?.key?.(e)) {
      e.preventDefault();
      return;
    }
    if (typing) return;
    if (e.key === 'Delete' && menus.has('clearsel')) {
      e.preventDefault();
      menus.get('clearsel')!();
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    // Ctrl+V is left to the browser: the paste event carries the clipboard (tools/select.ts)
    const map: Record<string, string> = { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', s: 'save', o: 'open', i: 'invert', x: 'cut', c: 'copy', a: 'selectall' };
    const action = map[k];
    if (!action || !menus.has(action)) return;
    e.preventDefault();
    win.dispatchEvent(new CustomEvent('menu', { detail: action }));
  });

  // ── The Core every module is written against ─────────────────────
  const core: Core = {
    win,
    canvas,
    view,
    overlay,
    wm,
    bm: () => bm,
    render,
    beginOp,
    endOp,
    cancelOp,
    opBefore: () => opBefore,
    wholeOp,
    replaceOp,
    flush,
    st,
    setFg(c) {
      st.fg = c;
      showColors();
    },
    setBg(c) {
      st.bg = c;
      showColors();
    },
    lineWidth: () => LINE_WIDTHS[st.line] ?? 1,
    shapeColors: (ink, paper) => (st.fillStyle === 0 ? [ink, null] : st.fillStyle === 1 ? [ink, paper] : [null, ink]),
    palette: {
      get: () => swatches.map((s) => s.dataset.color!),
      set(i, h) {
        const sw = swatches[i];
        if (!sw || !/^#[0-9a-f]{6}$/i.test(h)) return;
        sw.dataset.color = h;
        sw.style.setProperty('--c', h);
        sw.setAttribute('aria-label', `Color ${h}`);
      },
    },
    addTool: (t) => void tools.set(t.id, t),
    setTool,
    currentTool: () => toolId,
    previousTool: () => prevToolId,
    redrawOptions: drawOptions,
    optionButtons,
    selection: null,
    zoom: () => zoomLevel,
    setZoom(z, center) {
      const next = Math.max(1, Math.min(8, Math.round(z)));
      if (next === zoomLevel) return;
      zoomLevel = next;
      win.dataset.zoom = String(next);
      layout();
      if (center) {
        view.scrollLeft = center.x * next - view.clientWidth / 2;
        view.scrollTop = center.y * next - view.clientHeight / 2;
      }
    },
    onLayout: (fn) => void layoutFns.push(fn),
    toPixel,
    place(elm, box) {
      const z = zoomLevel;
      elm.style.left = `${box.x0 * z}px`;
      elm.style.top = `${box.y0 * z}px`;
      elm.style.width = `${(box.x1 - box.x0 + 1) * z}px`;
      elm.style.height = `${(box.y1 - box.y0 + 1) * z}px`;
    },
    onMenu,
    setChecked,
    status: { help: (t) => (helpLine.textContent = t), size: (t) => (sizeLine.textContent = t) },
    dialog,
    el,
    escapeHtml,
    pickImage,
    bitmapFromSource,
    toPng,
    download,
  };

  installBasic(core);
  for (const [path, mod] of Object.entries(MODULES)) {
    try {
      mod.install(core);
    } catch (err) {
      console.error(`Paint: ${path} failed to install`, err);
    }
  }

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
  layout();
  void (async () => {
    if (await restoreAutosave()) return;
    // a first picture that fits the window, leaving room for the padding and
    // the resize handles so no scroll bars appear
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
