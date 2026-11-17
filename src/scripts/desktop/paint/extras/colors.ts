/**
 * Colors > Edit Colors... and double-clicking (or double-tapping) a colour-box
 * swatch: the 98 "Edit Colors" dialog. 48 basic colours, 16 custom colours
 * kept in this browser, and "Define Custom Colors >>": a hue/saturation
 * spectrum, a luminance strip, a preview and Hue/Sat/Lum (Windows' 0-240
 * scale; hue stops at 239 as in 98) and Red/Green/Blue fields that follow
 * each other. OK makes the colour the foreground colour and, when the dialog
 * was opened from a swatch, puts it in that swatch.
 *
 * Keyboard: arrows walk the colour grids, Enter on a colour is OK; the
 * spectrum and the luminance strip take arrows (Shift for steps of 10);
 * Alt + the underlined letter jumps to a part, as in 98. A focused colour-box
 * swatch opens the dialog for itself with Shift+Enter.
 */
import * as R from '../raster';
import { type Core, hex, parseHex, paintCanvas } from '../core';
import './colors.css';

// ── Windows' HLS (ColorRGBToHLS / ColorHLSToRGB, integer maths, 0-240) ──
const HLSMAX = 240;
const RGBMAX = 255;
/** the hue Windows reports for greys */
const UNDEFINED_HUE = (HLSMAX * 2) / 3;
const div = (a: number, b: number) => Math.trunc(a / b);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** r, g, b (0-255) to [hue, lum, sat] on Windows' 0-240 scale */
export function rgbToHls(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = div((max + min) * HLSMAX + RGBMAX, 2 * RGBMAX);
  if (max === min) return [UNDEFINED_HUE, l, 0];
  const s =
    l <= HLSMAX / 2
      ? div((max - min) * HLSMAX + div(max + min, 2), max + min)
      : div((max - min) * HLSMAX + div(2 * RGBMAX - max - min, 2), 2 * RGBMAX - max - min);
  const d = (c: number) => div((max - c) * (HLSMAX / 6) + div(max - min, 2), max - min);
  let h = r === max ? d(b) - d(g) : g === max ? HLSMAX / 3 + d(r) - d(b) : (2 * HLSMAX) / 3 + d(g) - d(r);
  if (h < 0) h += HLSMAX;
  if (h > HLSMAX) h -= HLSMAX;
  return [clamp(h, 0, HLSMAX - 1), clamp(l, 0, HLSMAX), clamp(s, 0, HLSMAX)];
}

function hueToRgb(n1: number, n2: number, hue: number) {
  if (hue < 0) hue += HLSMAX;
  if (hue > HLSMAX) hue -= HLSMAX;
  if (hue < HLSMAX / 6) return n1 + div((n2 - n1) * hue + HLSMAX / 12, HLSMAX / 6);
  if (hue < HLSMAX / 2) return n2;
  if (hue < (HLSMAX * 2) / 3) return n1 + div((n2 - n1) * ((HLSMAX * 2) / 3 - hue) + HLSMAX / 12, HLSMAX / 6);
  return n1;
}

/** hue, lum, sat (0-240) to [r, g, b] (0-255) */
export function hlsToRgb(h: number, l: number, s: number): [number, number, number] {
  if (s === 0) {
    const v = clamp(div(l * RGBMAX, HLSMAX), 0, 255);
    return [v, v, v];
  }
  const m2 = l <= HLSMAX / 2 ? div(l * (HLSMAX + s) + HLSMAX / 2, HLSMAX) : l + s - div(l * s + HLSMAX / 2, HLSMAX);
  const m1 = 2 * l - m2;
  const ch = (hue: number) => clamp(div(hueToRgb(m1, m2, hue) * RGBMAX + HLSMAX / 2, HLSMAX), 0, 255);
  return [ch(h + HLSMAX / 3), ch(h), ch(h - HLSMAX / 3)];
}

// ── The colours ──────────────────────────────────────────────────
/** the 48 basic colours of the 98 colour dialog, row by row (6 rows of 8) */
const BASIC = [
  '#ff8080', '#ffff80', '#80ff80', '#00ff80', '#80ffff', '#0080ff', '#ff80c0', '#ff80ff',
  '#ff0000', '#ffff00', '#80ff00', '#00ff40', '#00ffff', '#0080c0', '#8080c0', '#ff00ff',
  '#804040', '#ff8040', '#00ff00', '#008080', '#004080', '#8080ff', '#800040', '#ff0080',
  '#800000', '#ff8000', '#008000', '#008040', '#0000ff', '#0000a0', '#800080', '#8000ff',
  '#400000', '#804000', '#004000', '#004040', '#000080', '#000040', '#400040', '#400080',
  '#000000', '#808000', '#808040', '#808080', '#408080', '#c0c0c0', '#400040', '#ffffff',
];
const CUSTOM_STORE = 'paint-custom-colors-v1';
const HEX = /^#[0-9a-f]{6}$/i;
const COLS = 8;

function loadCustom(): string[] {
  const out: string[] = Array(16).fill('#ffffff');
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CUSTOM_STORE) ?? 'null');
    if (Array.isArray(v)) v.slice(0, 16).forEach((c, i) => typeof c === 'string' && HEX.test(c) && (out[i] = c.toLowerCase()));
  } catch {}
  return out;
}
function saveCustom(colors: string[]) {
  try {
    localStorage.setItem(CUSTOM_STORE, JSON.stringify(colors));
  } catch {
    // storage full or blocked: the custom colours last until the page closes
  }
}

// ── Sizes of the spectrum (canvas pixels = page pixels) ─────────────
const SW = 180; // hue 0-239 across
const SH = 150; // saturation 240 (top) to 0 (bottom)
const LW = 10; // the luminance strip

const toHex = (r: number, g: number, b: number) => hex(R.rgb(r, g, b));
const rgbOf = (h: string): [number, number, number] => R.toRGB(parseHex(h));

/** a small hard-edged picture as a canvas */
function pixels(w: number, h: number, draw: (b: R.Bitmap) => void, cls: string) {
  const b = R.createBitmap(w, h, 0);
  draw(b);
  const c = document.createElement('canvas');
  c.className = cls;
  c.setAttribute('aria-hidden', 'true');
  paintCanvas(c, b);
  return c;
}

export function install(core: Core) {
  let showing = false;

  async function editColors(initial: string, swatch: number | null) {
    if (showing) return;
    showing = true;
    try {
      const chosen = await dialog(initial);
      if (!chosen) return;
      core.setFg(parseHex(chosen));
      if (swatch !== null) core.palette.set(swatch, chosen);
    } finally {
      showing = false;
    }
  }

  function dialog(initial: string): Promise<string | null> {
    const custom = loadCustom();
    const u = (s: string) => `<span class="u">${s}</span>`;
    const swatches = (colors: string[], kind: string) =>
      colors.map((c, i) => `<button type="button" class="ec-sw" role="radio" aria-checked="false" tabindex="-1" data-${kind}="${i}" data-c="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('');
    const field = (id: string, label: string, max: number) =>
      `<label for="pt-ec-${id}">${label}</label><input id="pt-ec-${id}" data-f="${id}" type="number" inputmode="numeric" required min="0" max="${max}" step="1" />`;
    const body = core.el(
      `<div class="ec">` +
        `<div class="ec-left">` +
        `<p class="ec-label" id="pt-ec-basic">${u('B')}asic colors:</p>` +
        `<div class="ec-grid" role="radiogroup" aria-labelledby="pt-ec-basic" data-grid="basic">${swatches(BASIC, 'basic')}</div>` +
        `<p class="ec-label" id="pt-ec-custom">${u('C')}ustom colors:</p>` +
        `<div class="ec-grid" role="radiogroup" aria-labelledby="pt-ec-custom" data-grid="custom">${swatches(custom, 'custom')}</div>` +
        `<button type="button" class="btn ec-wide" data-define aria-expanded="false" aria-controls="pt-ec-define">${u('D')}efine Custom Colors &gt;&gt;</button>` +
        `</div>` +
        `<div class="ec-right" id="pt-ec-define" hidden>` +
        `<div class="ec-pickers">` +
        `<div class="ec-spec" tabindex="0" role="slider" aria-label="Hue and saturation" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="239" data-spec><div class="ec-spec-in"></div></div>` +
        `<div class="ec-lum" tabindex="0" role="slider" aria-label="Luminosity" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="240" data-lum><div class="ec-arrow-col"></div></div>` +
        `</div>` +
        `<div class="ec-bottom">` +
        `<div class="ec-preview-box"><div class="ec-preview" data-preview></div><span>Color|Solid</span></div>` +
        `<div class="ec-fields">` +
        field('h', `Hu${u('e')}:`, HLSMAX - 1) +
        field('r', `${u('R')}ed:`, 255) +
        field('s', `${u('S')}at:`, HLSMAX) +
        field('g', `${u('G')}reen:`, 255) +
        field('l', `${u('L')}um:`, HLSMAX) +
        field('b', `Bl${u('u')}e:`, 255) +
        `</div></div>` +
        `<button type="button" class="btn ec-wide" data-add>${u('A')}dd to Custom Colors</button>` +
        `</div></div>`,
    );
    const $ = <T extends HTMLElement = HTMLElement>(sel: string) => body.querySelector<T>(sel)!;
    const basicBtns = [...body.querySelectorAll<HTMLButtonElement>('[data-basic]')];
    const customBtns = [...body.querySelectorAll<HTMLButtonElement>('[data-custom]')];
    const defineBtn = $<HTMLButtonElement>('[data-define]');
    const right = $('#pt-ec-define');
    const spec = $('[data-spec]');
    const lumBox = $('[data-lum]');
    const preview = $('[data-preview]');
    const addBtn = $<HTMLButtonElement>('[data-add]');
    const fields = Object.fromEntries([...body.querySelectorAll<HTMLInputElement>('[data-f]')].map((f) => [f.dataset.f!, f])) as Record<
      'h' | 's' | 'l' | 'r' | 'g' | 'b',
      HTMLInputElement
    >;

    // the spectrum: hue across, saturation down, at the middle luminosity
    const specCanvas = pixels(
      SW,
      SH,
      (b) => {
        for (let y = 0; y < SH; y++) {
          const s = Math.round(((SH - 1 - y) * HLSMAX) / (SH - 1));
          for (let x = 0; x < SW; x++) {
            const [r, g, bl] = hlsToRgb(Math.floor((x * HLSMAX) / SW), HLSMAX / 2, s);
            b.data[y * SW + x] = R.rgb(r, g, bl);
          }
        }
      },
      'ec-spec-canvas',
    );
    // the 98 cross-hair: four black arms around an empty middle
    const cross = pixels(
      19,
      19,
      (b) => {
        const k = R.rgb(0, 0, 0);
        R.rect(b, 8, 0, 10, 5, 1, null, k);
        R.rect(b, 8, 13, 10, 18, 1, null, k);
        R.rect(b, 0, 8, 5, 10, 1, null, k);
        R.rect(b, 13, 8, 18, 10, 1, null, k);
      },
      'ec-cross',
    );
    spec.firstElementChild!.append(specCanvas, cross);
    const lumCanvas = document.createElement('canvas');
    lumCanvas.width = LW;
    lumCanvas.height = SH;
    lumCanvas.className = 'ec-lum-canvas';
    lumCanvas.setAttribute('aria-hidden', 'true');
    // the arrow beside the strip, pointing at the luminosity
    const arrow = pixels(
      7,
      13,
      (b) => {
        for (let y = 0; y < 13; y++) R.strokeLine(b, Math.abs(y - 6), y, 6, y, R.stamps.dot, R.rgb(0, 0, 0));
      },
      'ec-arrow',
    );
    lumBox.prepend(lumCanvas);
    lumBox.querySelector('.ec-arrow-col')!.append(arrow);

    // ── the colour being edited ──
    let [r, g, b] = rgbOf(HEX.test(initial) ? initial : '#000000');
    let [h, l, s] = rgbToHls(r, g, b);
    let next = 0; // the custom slot "Add to Custom Colors" fills
    const current = () => toHex(r, g, b);

    function drawLum() {
      const ctx = lumCanvas.getContext('2d')!;
      const img = ctx.createImageData(LW, SH);
      const px = new Uint32Array(img.data.buffer);
      for (let y = 0; y < SH; y++) {
        const [cr, cg, cb] = hlsToRgb(h, Math.round(((SH - 1 - y) * HLSMAX) / (SH - 1)), s);
        px.fill(R.rgb(cr, cg, cb), y * LW, y * LW + LW);
      }
      ctx.putImageData(img, 0, 0);
    }
    let lumFor = '';
    /** show the colour everywhere, except in the field being typed in */
    function show(from?: HTMLInputElement) {
      const values = { h, s, l, r, g, b };
      for (const [k, f] of Object.entries(fields)) if (f !== from) f.value = String(values[k as keyof typeof values]);
      preview.style.background = current();
      cross.style.left = `${Math.min(SW - 1, Math.round((h * SW) / HLSMAX))}px`;
      cross.style.top = `${Math.round(((HLSMAX - s) * (SH - 1)) / HLSMAX)}px`;
      arrow.style.top = `${Math.round(((HLSMAX - l) * (SH - 1)) / HLSMAX)}px`;
      spec.setAttribute('aria-valuenow', String(h));
      spec.setAttribute('aria-valuetext', `Hue ${h}, saturation ${s}`);
      lumBox.setAttribute('aria-valuenow', String(l));
      if (lumFor !== `${h},${s}`) {
        lumFor = `${h},${s}`;
        drawLum();
      }
    }
    // the swatch showing the colour has a frame (aria-checked); defining a colour clears it
    const all = [...basicBtns, ...customBtns];
    function mark(btn: HTMLButtonElement | null) {
      for (const x of all) x.setAttribute('aria-checked', String(x === btn));
      if (btn) for (const grid of [basicBtns, customBtns]) if (grid.includes(btn)) grid.forEach((x) => (x.tabIndex = x === btn ? 0 : -1));
    }
    function setRGB(nr: number, ng: number, nb: number, from?: HTMLInputElement) {
      [r, g, b] = [nr, ng, nb];
      [h, l, s] = rgbToHls(r, g, b);
      if (from) mark(null);
      show(from);
    }
    function setHLS(nh: number, nl: number, ns: number, from?: HTMLInputElement) {
      [h, l, s] = [clamp(nh, 0, HLSMAX - 1), clamp(nl, 0, HLSMAX), clamp(ns, 0, HLSMAX)];
      [r, g, b] = hlsToRgb(h, l, s);
      mark(null);
      show(from);
    }

    // ── the two colour grids ──
    function pick(btn: HTMLButtonElement) {
      if (btn.dataset.custom !== undefined) next = Number(btn.dataset.custom);
      setRGB(...rgbOf(btn.dataset.c!));
      mark(btn);
      btn.focus();
    }
    const okButton = () => body.closest('form')?.querySelector<HTMLButtonElement>('button[value="ok"]');
    for (const grid of [basicBtns, customBtns]) {
      grid.forEach((btn, i) => {
        btn.addEventListener('click', () => pick(btn));
        btn.addEventListener('keydown', (e) => {
          if (e.altKey || e.ctrlKey || e.metaKey) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            pick(btn);
            okButton()?.click();
            return;
          }
          const rows = Math.ceil(grid.length / COLS);
          const col = i % COLS;
          const row = Math.floor(i / COLS);
          const to: Record<string, number> = {
            ArrowLeft: row * COLS + ((col + COLS - 1) % COLS),
            ArrowRight: row * COLS + ((col + 1) % COLS),
            ArrowUp: ((row + rows - 1) % rows) * COLS + col,
            ArrowDown: ((row + 1) % rows) * COLS + col,
            Home: 0,
            End: grid.length - 1,
          };
          if (!(e.key in to)) return;
          e.preventDefault();
          pick(grid[to[e.key]]);
        });
      });
      grid[0].tabIndex = 0;
    }

    // ── Define Custom Colors >> ──
    function expand() {
      if (!right.hidden) return;
      right.hidden = false;
      spec.focus(); // before the button it was on is disabled
      defineBtn.disabled = true;
      defineBtn.setAttribute('aria-expanded', 'true');
    }
    defineBtn.addEventListener('click', expand);

    // spectrum and luminance strip: press and drag (mouse, pen or finger)
    function drag(el: HTMLElement, target: HTMLElement, set: (fx: number, fy: number) => void) {
      const at = (e: PointerEvent) => {
        const rc = target.getBoundingClientRect();
        set(clamp((e.clientX - rc.left) / rc.width, 0, 0.999999), clamp((e.clientY - rc.top) / rc.height, 0, 1));
      };
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        el.focus();
        el.setPointerCapture(e.pointerId);
        at(e);
      });
      el.addEventListener('pointermove', (e) => el.hasPointerCapture(e.pointerId) && at(e));
    }
    drag(spec, specCanvas, (fx, fy) => setHLS(Math.floor(fx * HLSMAX), l, Math.round((1 - fy) * HLSMAX)));
    drag(lumBox, lumCanvas, (_fx, fy) => setHLS(h, Math.round((1 - fy) * HLSMAX), s));
    spec.addEventListener('keydown', (e) => {
      const n = e.shiftKey ? 10 : 1;
      const d: Record<string, [number, number]> = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, n], ArrowDown: [0, -n] };
      if (!d[e.key] || e.altKey || e.ctrlKey) return;
      e.preventDefault();
      setHLS(h + d[e.key][0], l, s + d[e.key][1]);
    });
    lumBox.addEventListener('keydown', (e) => {
      const n = e.shiftKey ? 10 : 1;
      const d: Record<string, number> = { ArrowUp: n, ArrowRight: n, ArrowDown: -n, ArrowLeft: -n, PageUp: 10, PageDown: -10, Home: -HLSMAX, End: HLSMAX };
      if (d[e.key] === undefined || e.altKey || e.ctrlKey) return;
      e.preventDefault();
      setHLS(h, l + d[e.key], s);
    });

    // the number fields: typing a whole number in range applies it at once; leaving the field tidies it
    const read = (f: HTMLInputElement) => {
      const t = f.value.trim();
      return /^-?\d+$/.test(t) ? Number(t) : NaN;
    };
    const apply = (f: HTMLInputElement, v: number) => {
      const k = f.dataset.f!;
      if (k === 'h' || k === 's' || k === 'l') setHLS(k === 'h' ? v : h, k === 'l' ? v : l, k === 's' ? v : s, f);
      else setRGB(k === 'r' ? v : r, k === 'g' ? v : g, k === 'b' ? v : b, f);
    };
    for (const f of Object.values(fields)) {
      const max = Number(f.max);
      f.addEventListener('input', () => {
        const v = read(f);
        if (v >= 0 && v <= max) apply(f, v);
      });
      const tidy = () => {
        const v = read(f);
        if (Number.isFinite(v)) apply(f, clamp(v, 0, max));
        show();
      };
      f.addEventListener('change', tidy);
      // Enter is OK: tidy first, so an out-of-range number does not block it
      f.addEventListener('keydown', (e) => e.key === 'Enter' && tidy());
      f.addEventListener('focus', () => f.select());
    }

    addBtn.addEventListener('click', () => {
      const c = current();
      custom[next] = c;
      saveCustom(custom);
      const btn = customBtns[next];
      btn.dataset.c = c;
      btn.style.setProperty('--c', c);
      btn.setAttribute('aria-label', c);
      mark(btn);
      next = (next + 1) % custom.length;
    });

    // Alt + the underlined letter, as in 98
    body.addEventListener('keydown', (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const tabbable = (grid: HTMLButtonElement[]) => grid.find((x) => x.tabIndex === 0);
      const go: Record<string, () => void> = {
        b: () => tabbable(basicBtns)?.focus(),
        c: () => tabbable(customBtns)?.focus(),
        d: expand,
      };
      if (!right.hidden) {
        Object.assign(go, {
          e: () => fields.h.focus(),
          s: () => fields.s.focus(),
          l: () => fields.l.focus(),
          r: () => fields.r.focus(),
          g: () => fields.g.focus(),
          u: () => fields.b.focus(),
          a: () => addBtn.click(),
        });
      }
      const fn = go[e.key.toLowerCase()];
      if (!fn) return;
      e.preventDefault();
      fn();
    });

    // ── open ──
    const shown = core.dialog('Edit Colors', body, [
      { label: 'OK', value: 'ok', primary: true },
      { label: 'Cancel', value: 'cancel' },
    ]);
    body.closest('dialog')?.classList.add('pt-ec');
    const start = current();
    const match = basicBtns.find((x) => x.dataset.c === start) ?? customBtns.find((x) => x.dataset.c === start);
    if (match) pick(match);
    else {
      show();
      basicBtns[0].focus();
    }
    return shown.then(({ value }) => (value === 'ok' ? current() : null));
  }

  core.onMenu('editcolors', () => void editColors(hex(core.st.fg), null));

  // double-click (or double-tap) a colour-box swatch: edit that colour; Shift+Enter does it from the keyboard
  const swatches = [...core.win.querySelectorAll<HTMLButtonElement>('[data-color]')];
  swatches.forEach((sw, i) => {
    let pointer = 'mouse';
    let downAt = 0;
    let lastTap = 0;
    const open = () => void editColors(sw.dataset.color!, i);
    sw.setAttribute('aria-keyshortcuts', 'Shift+Enter');
    sw.addEventListener('pointerdown', (e) => {
      pointer = e.pointerType;
      downAt = e.timeStamp;
    });
    // Only a mouse's dblclick: Chrome also sends one for two quick taps on
    // neighbouring swatches, or a long press and then a tap. A finger's or a
    // pen's double tap on this swatch is caught below.
    sw.addEventListener('dblclick', () => pointer === 'mouse' && open());
    sw.addEventListener('click', (e) => {
      // a finger's double tap does not always become a dblclick
      if (pointer === 'mouse' || e.detail === 0) return;
      const now = e.timeStamp;
      if (now - downAt > 450) lastTap = 0; // a long press (the background colour) is not a tap
      else if (now - lastTap < 450) {
        lastTap = 0;
        open();
      } else lastTap = now;
    });
    sw.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      core.setFg(parseHex(sw.dataset.color!));
      open();
    });
  });
}
