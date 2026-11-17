/**
 * The Text tool, as in Windows 98 Paint: drag a box on the picture and type.
 *
 * A real <textarea> takes the typing, so the keyboard, a phone keyboard,
 * paste, input methods and the browser's own text undo all work. Its letters
 * are see-through: what shows under the caret is a live preview of exactly
 * the pixels that will go into the picture. Lines break where the textarea
 * breaks them (read back from a hidden twin with the same font and width),
 * each word is drawn with canvas fillText where the browser laid it out, and
 * the result is thresholded at 50% alpha, so the letters have hard edges.
 * The preview is a canvas the size of the picture over it (like a floating
 * selection), so the browser puts its pixels on the same screen pixels.
 *
 * As in 98 the box never grows past the bottom of the picture: typing that
 * would need another line there is refused. While the box is open, the Edit
 * menu (Cut, Copy, Paste, Select All, Undo, Repeat) works on the text, and a
 * menu command or dialog that leaves the box open hands the keyboard back.
 *
 * A "Fonts" mini window (typeface, size, bold, italic, underline) floats over
 * the workspace while the tool is chosen, where it covers neither the picture
 * (when there is room) nor the box. The options box picks an opaque or
 * transparent background (core.st.opaque). The text is drawn in the
 * foreground colour, which can change while typing.
 */
import * as R from '../raster';
import { type Core, type Pt, hex } from '../core';
import './text.css';

/** [name in the list, CSS font stack]: faces found nearly everywhere, with fallbacks */
const FONTS: [string, string][] = [
  ['Arial', 'Arial, Helvetica, "Liberation Sans", sans-serif'],
  ['Times New Roman', '"Times New Roman", Times, "Liberation Serif", serif'],
  ['Courier New', '"Courier New", Courier, "Liberation Mono", monospace'],
  ['Comic Sans MS', '"Comic Sans MS", "Comic Sans", "Chalkboard SE", sans-serif'],
  ['Georgia', 'Georgia, "DejaVu Serif", serif'],
  ['Verdana', 'Verdana, Geneva, "DejaVu Sans", sans-serif'],
];
/** font sizes in points, as in the 98 list */
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const EDGES = ['n', 'e', 's', 'w'] as const;

/** a word drawn at the place the browser put it (x in picture pixels from the box's left) */
interface Run {
  text: string;
  x: number;
}
/** one line as the textarea shows it; from/to is the underline's extent */
interface Line {
  runs: Run[];
  from: number;
  to: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function install(core: Core) {
  const font = { face: 0, size: 12, bold: false, italic: false, underline: false };
  /** the font size in picture pixels (points at 96 dpi, as in 98) */
  const fontPx = () => (font.size * 96) / 72;
  const cssFont = (scale: number) =>
    `${font.italic ? 'italic ' : ''}${font.bold ? 'bold ' : ''}${+(fontPx() * scale).toFixed(3)}px ${FONTS[font.face][1]}`;

  // An offscreen canvas for font metrics and for drawing the letters before thresholding.
  const scratch = document.createElement('canvas');
  const sx = scratch.getContext('2d', { willReadFrequently: true })!;
  /** line height and baseline (from a line's top) in picture pixels */
  let lineH = 18;
  let base = 14;
  function measureFont() {
    sx.font = cssFont(1);
    const m = sx.measureText('Hg');
    let a = m.fontBoundingBoxAscent;
    let d = m.fontBoundingBoxDescent;
    if (!(a > 0 && d >= 0)) {
      a = fontPx() * 0.9;
      d = fontPx() * 0.22;
    }
    lineH = Math.max(1, Math.ceil(a + d));
    // the textarea gets line-height lineH, which centres the font's ascent + descent in it
    base = Math.round((lineH - (a + d)) / 2 + a);
  }
  /** the narrowest box: about one wide letter */
  const minW = () => Math.min(core.bm().w, Math.max(8, Math.ceil(fontPx() * 1.5)));

  // ── The text box ─────────────────────────────────────────────────
  /** the box as the visitor made it (picture pixels); it shows taller when the text needs it */
  let ub: R.Box | null = null;
  let shownH = 0;
  let lines: Line[] = [];
  let frame: HTMLElement | null = null;
  let ta: HTMLTextAreaElement | null = null;
  // a press on a plain part of the window (status bar, grey area, borders)
  // must not take the caret out of an open box, as in 98
  core.win.addEventListener('pointerdown', (e) => {
    if (!ta || e.pointerType !== 'mouse') return;
    const target = e.target as HTMLElement;
    if (!target.closest('button, input, select, textarea, a, canvas, [contenteditable], .pt-overlay, .pt-fontbar, .title, .rz')) e.preventDefault();
  });
  let twin: HTMLElement | null = null;
  let lastAt: Pt = { x: 0, y: 0 };
  /** the text has been edited since the box opened (so the textarea has its own undo) */
  let edited = false;
  /** a handle or edge being dragged: its box before the drag, and a way to stop listening */
  let grab: { orig: R.Box; stop(): void } | null = null;

  // The preview: a canvas the size of the picture, exactly over it (like
  // .pt-sel-float), so its pixels land on the same screen pixels as the
  // picture's at any page zoom. It holds the letters at the box's place.
  const shown = document.createElement('canvas');
  shown.className = 'pt-textshown';
  shown.setAttribute('aria-hidden', 'true');
  shown.width = 0;
  shown.height = 0;
  shown.hidden = true;
  core.overlay.append(shown);
  /** the part of the preview canvas drawn last (cleared before the next draw) */
  let painted: R.Box | null = null;

  const shownBox = (b: R.Box): R.Box => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y0 + shownH - 1 });
  /** the part of the shown box inside the picture, as a width and height from its corner */
  function visible(b: R.Box) {
    const bm = core.bm();
    return { w: Math.max(0, Math.min(b.x1, bm.w - 1) - b.x0 + 1), h: Math.max(0, Math.min(b.y0 + shownH - 1, bm.h - 1) - b.y0 + 1) };
  }

  /**
   * Where the textarea breaks its lines and puts its words, read from the
   * hidden twin (same font, same width, same wrapping rules). Returns null when
   * nothing is laid out (the window is hidden), so the last layout is kept.
   */
  function layoutLines(text: string, boxW: number): Line[] | null {
    const m = twin!;
    // one span per word and per run of spaces (spans do not change where lines
    // break), so each is measured with one cheap call instead of one per letter
    const segs = text.match(/\n|[^\S\n]+|\S+/gu) ?? [];
    const spans: (HTMLSpanElement | null)[] = [];
    const frag = document.createDocumentFragment();
    for (const s of segs) {
      if (s === '\n') {
        frag.append(s);
        spans.push(null);
        continue;
      }
      const sp = document.createElement('span');
      sp.textContent = s;
      frag.append(sp);
      spans.push(sp);
    }
    m.replaceChildren(frag);
    const mr = m.getBoundingClientRect();
    const k = mr.width / boxW; // screen pixels per picture pixel (Paint's zoom times the page's)
    if (!(k > 0)) return null;
    const half = (lineH * k) / 2;
    const out: Line[] = [];
    let line: Line = { runs: [], from: Infinity, to: -Infinity };
    let top = NaN;
    const endLine = () => {
      out.push(line);
      line = { runs: [], from: Infinity, to: -Infinity };
      top = NaN;
    };
    /** a piece of text that lies on one line, with its boxes on screen */
    const place = (s: string, rects: DOMRect[]) => {
      // the browser wrapped before it
      if (top === top && rects[0].top > top + half) endLine();
      if (top !== top) top = rects[0].top;
      const x = (Math.min(...rects.map((r) => r.left)) - mr.left) / k;
      line.from = Math.min(line.from, x);
      if (/^\s/.test(s)) return;
      line.runs.push({ text: s, x });
      line.to = Math.max(line.to, (Math.max(...rects.map((r) => r.right)) - mr.left) / k);
    };
    const boxes = (r: { getClientRects(): DOMRectList }) => [...r.getClientRects()].filter((b) => b.width > 0 || b.height > 0);
    segs.forEach((s, j) => {
      const sp = spans[j];
      if (!sp) return endLine();
      const rects = boxes(sp);
      if (!rects.length) return;
      if (rects.every((r) => Math.abs(r.top - rects[0].top) < half)) return place(s, rects);
      // a word too long for the box, broken across lines: letter by letter
      const node = sp.firstChild!;
      const range = document.createRange();
      let piece = '';
      let pieceRects: DOMRect[] = [];
      for (let i = 0; i < s.length; ) {
        const n = (s.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
        range.setStart(node, i);
        range.setEnd(node, i + n);
        const ch = s.slice(i, i + n);
        i += n;
        const r = boxes(range);
        if (!r.length) {
          piece += ch; // a joiner or a mark stays with its letter
          continue;
        }
        if (pieceRects.length && Math.abs(r[0].top - pieceRects[0].top) >= half) {
          place(piece, pieceRects);
          piece = '';
          pieceRects = [];
        }
        piece += ch;
        pieceRects.push(...r);
      }
      if (pieceRects.length) place(piece, pieceRects);
    });
    endLine();
    return out;
  }

  /** the letters of the current lines as a w x h mask (1 = ink), with hard edges */
  function rasterize(w: number, h: number): Uint8Array {
    scratch.width = w;
    scratch.height = h;
    sx.font = cssFont(1);
    sx.fillStyle = '#000';
    sx.textAlign = 'left';
    sx.textBaseline = 'alphabetic';
    sx.direction = 'ltr';
    const ulOff = Math.max(1, Math.round(fontPx() * 0.09));
    const ulH = Math.max(1, Math.round(fontPx() / 15));
    lines.forEach((ln, k) => {
      const y = k * lineH + base;
      if (y - lineH > h) return;
      for (const r of ln.runs) sx.fillText(r.text, Math.round(r.x), y);
      if (font.underline && ln.to > ln.from) {
        const a = Math.round(ln.from);
        sx.fillRect(a, y + ulOff, Math.max(1, Math.round(ln.to) - a), ulH);
      }
    });
    const data = sx.getImageData(0, 0, w, h).data;
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
    return out;
  }

  /** show exactly what a commit would put into the picture */
  function paintPreview() {
    if (!ub || !ta) return;
    const caret = hex(core.st.fg);
    // (style reads back as rgb(), so remember what was set)
    if (ta.dataset.caret !== caret) ta.style.caretColor = ta.dataset.caret = caret;
    const bm = core.bm();
    if (shown.width !== bm.w || shown.height !== bm.h) {
      shown.width = bm.w;
      shown.height = bm.h;
      painted = null;
    }
    const ctx = shown.getContext('2d')!;
    if (painted) ctx.clearRect(painted.x0, painted.y0, painted.x1 - painted.x0 + 1, painted.y1 - painted.y0 + 1);
    painted = null;
    shown.hidden = false;
    const { w, h } = visible(shownBox(ub));
    if (ta.value === '' || w === 0 || h === 0) return;
    const mask = rasterize(w, h);
    const img = ctx.createImageData(w, h);
    const px = new Uint32Array(img.data.buffer);
    const ink = core.st.fg >>> 0;
    const paper = core.st.opaque ? core.st.bg >>> 0 : 0;
    for (let i = 0; i < mask.length; i++) px[i] = mask[i] ? ink : paper;
    ctx.putImageData(img, ub.x0, ub.y0);
    painted = { x0: ub.x0, y0: ub.y0, x1: ub.x0 + w - 1, y1: ub.y0 + h - 1 };
  }

  /**
   * As in 98, the box stops at the bottom of the picture: false when putting
   * `s` in place of the selected text would need a line more than fits
   * between the box's top and the bottom of the picture.
   */
  function fits(t: HTMLTextAreaElement, s: string) {
    if (!ub) return true;
    const v = t.value;
    const next = layoutLines(v.slice(0, t.selectionStart) + s.replace(/\r\n?/g, '\n') + v.slice(t.selectionEnd), ub.x1 - ub.x0 + 1);
    return !next || next.length <= Math.max(Math.floor((core.bm().h - ub.y0) / lineH), lines.length);
  }

  /** re-read the lines, grow the box to fit them and redraw the preview */
  function refresh() {
    if (!ub || !frame || !ta) return;
    const z = core.zoom();
    const w = ub.x1 - ub.x0 + 1;
    frame.style.left = `${ub.x0 * z}px`;
    frame.style.top = `${ub.y0 * z}px`;
    frame.style.width = `${w * z}px`;
    const next = layoutLines(ta.value, w);
    if (next) lines = next;
    // Typing and pasting past the bottom are refused (fits), but a bigger
    // font, a narrower box or an input method can still need more lines than
    // fit below the box: then the box moves up, so no line falls off the picture.
    const over = lines.length * lineH - (core.bm().h - ub.y0);
    if (over > 0 && ub.y0 > 0) {
      const up = Math.min(ub.y0, over);
      ub = { ...ub, y0: ub.y0 - up, y1: ub.y1 - up };
      frame.style.top = `${ub.y0 * z}px`;
    }
    shownH = Math.max(ub.y1 - ub.y0 + 1, lines.length * lineH);
    core.place(frame, shownBox(ub));
    if (ta.scrollTop || ta.scrollLeft) ta.scrollTop = ta.scrollLeft = 0;
    paintPreview();
  }
  /** after a font, zoom or picture change */
  function relayout() {
    if (frame) {
      const z = core.zoom();
      frame.style.font = cssFont(z);
      frame.style.lineHeight = `${lineH * z}px`;
      refresh();
    }
    placeBar();
  }

  // the text follows the colour boxes and Draw Opaque while it is typed
  let watch = 0;
  let seen = '';
  function tick() {
    watch = 0;
    if (!ub) return;
    const now = `${core.st.fg} ${core.st.bg} ${core.st.opaque}`;
    if (now !== seen) {
      seen = now;
      paintPreview();
    }
    watch = requestAnimationFrame(tick);
  }

  function open(b: R.Box) {
    close();
    measureFont();
    ub = b;
    lastAt = { x: b.x0, y: b.y0 };
    frame = document.createElement('div');
    frame.className = 'pt-textframe';
    twin = document.createElement('div');
    twin.className = 'pt-textflow pt-texttwin';
    twin.setAttribute('aria-hidden', 'true');
    const t = (ta = document.createElement('textarea'));
    t.className = 'pt-textflow pt-textedit';
    t.spellcheck = false;
    t.autocomplete = 'off';
    t.setAttribute('aria-label', 'Text. Type here; Esc puts it into the picture.');
    frame.append(twin, t);
    for (const e of EDGES) frame.append(grip('pt-textedge', e, 'move'));
    for (const d of HANDLES) frame.append(grip('pt-texthandle', d, d));
    edited = false;
    // refuse typing, a paste or a drop that would not fit
    t.addEventListener('beforeinput', (e) => {
      if (e.isComposing || !e.inputType.startsWith('insert')) return;
      const add = /^insert(LineBreak|Paragraph)$/.test(e.inputType) ? '\n' : (e.data ?? e.dataTransfer?.getData('text/plain') ?? null);
      if (add !== null && !fits(t, add)) e.preventDefault();
    });
    t.addEventListener('input', () => {
      edited = true;
      refresh();
      syncEditMenu();
    });
    t.addEventListener('scroll', () => {
      t.scrollTop = 0;
      t.scrollLeft = 0;
    });
    for (const ev of ['select', 'keyup', 'pointerup', 'focus']) t.addEventListener(ev, syncEditMenu);
    t.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        // Esc in the middle of dragging a handle only cancels the drag
        if (!cancelGrab()) commit(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        const style = k === 'b' ? 'bold' : k === 'i' ? 'italic' : k === 'u' ? 'underline' : null;
        if (style) {
          e.preventDefault();
          toggle(style);
        }
      }
    });
    core.overlay.append(frame);
    relayout();
    seen = '';
    tick();
    t.focus({ preventScroll: true });
    syncEditMenu();
  }

  function close() {
    cancelAnimationFrame(watch);
    watch = 0;
    grab?.stop();
    grab = null;
    frame?.remove();
    frame = ta = twin = null;
    ub = null;
    lines = [];
    shownH = 0;
    // let the picture-sized preview's memory go
    shown.hidden = true;
    shown.width = 0;
    shown.height = 0;
    painted = null;
    core.status.size('');
    syncEditMenu();
  }

  /** put the text into the picture (one undo step); an empty box puts nothing */
  function commit(focusCanvas: boolean) {
    if (!ub || !ta) return;
    const hadFocus = document.activeElement === ta;
    if (ta.value !== '') {
      refresh();
      const b = shownBox(ub);
      const { w, h } = visible(b);
      if (w > 0 && h > 0) {
        const mask = rasterize(w, h);
        const bm = core.bm();
        const ink = core.st.fg;
        core.beginOp();
        if (core.st.opaque) R.rect(bm, b.x0, b.y0, b.x1, b.y1, 1, null, core.st.bg);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) R.setPixel(bm, b.x0 + x, b.y0 + y, ink);
        core.endOp();
      }
    }
    close();
    if (hadFocus && focusCanvas) core.canvas.focus({ preventScroll: true });
  }

  /** a box at a point when the visitor clicks without dragging (or presses Enter) */
  function boxAt(p: Pt): R.Box {
    const bm = core.bm();
    const w = Math.min(bm.w, Math.max(minW(), Math.round(fontPx() * 10)));
    const h = Math.min(bm.h, lineH);
    const x0 = clamp(p.x, 0, bm.w - w);
    const y0 = clamp(p.y, 0, bm.h - h);
    return { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 };
  }
  /** a dragged box, at least one letter wide and one line high, inside the picture */
  function boxFrom(a: Pt, b: Pt): R.Box {
    const bm = core.bm();
    let x0 = Math.min(a.x, b.x);
    let y0 = Math.min(a.y, b.y);
    let x1 = Math.max(a.x, b.x);
    let y1 = Math.max(a.y, b.y);
    const mw = minW();
    const mh = Math.min(bm.h, lineH);
    if (x1 - x0 + 1 < mw) x1 = x0 + mw - 1;
    if (y1 - y0 + 1 < mh) y1 = y0 + mh - 1;
    if (x1 > bm.w - 1) [x0, x1] = [Math.max(0, x0 - (x1 - bm.w + 1)), bm.w - 1];
    if (y1 > bm.h - 1) [y0, y1] = [Math.max(0, y0 - (y1 - bm.h + 1)), bm.h - 1];
    return { x0, y0, x1, y1 };
  }

  /** a handle (resize) or an edge strip (move) of the box */
  function grip(cls: string, where: string, kind: string) {
    const g = document.createElement('span');
    g.className = cls;
    g.dataset.at = where;
    g.setAttribute('aria-hidden', 'true');
    g.addEventListener('mousedown', (e) => e.preventDefault()); // the caret stays in the box
    g.addEventListener('pointerdown', (e) => {
      if (!ub || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      e.stopPropagation();
      g.setPointerCapture(e.pointerId);
      grab?.stop();
      measureFont();
      const bm = core.bm();
      const orig = { ...ub };
      const start = shownBox(ub);
      const p0 = core.toPixel(e);
      const mw = minW();
      const mh = Math.min(bm.h, lineH);
      const move = (m: PointerEvent) => {
        if (!ub) return;
        const p = core.toPixel(m);
        const dx = p.x - p0.x;
        const dy = p.y - p0.y;
        const b = { ...start };
        if (kind === 'move') {
          const mx = clamp(dx, -start.x0, bm.w - 1 - start.x1);
          const my = clamp(dy, -start.y0, Math.max(0, bm.h - 1 - start.y1));
          b.x0 += mx;
          b.x1 += mx;
          b.y0 += my;
          b.y1 += my;
        } else {
          if (kind.includes('e')) b.x1 = clamp(start.x1 + dx, start.x0 + mw - 1, bm.w - 1);
          if (kind.includes('w')) b.x0 = clamp(start.x0 + dx, 0, start.x1 - mw + 1);
          if (kind.includes('s')) b.y1 = clamp(start.y1 + dy, start.y0 + mh - 1, Math.max(bm.h - 1, start.y0 + mh - 1));
          if (kind.includes('n')) b.y0 = clamp(start.y0 + dy, 0, start.y1 - mh + 1);
        }
        ub = b;
        refresh();
        core.status.size(`${b.x1 - b.x0 + 1}x${shownH}`);
      };
      const stop = () => {
        g.removeEventListener('pointermove', move);
        g.removeEventListener('pointerup', end);
        g.removeEventListener('pointercancel', end);
        core.status.size('');
        if (g.hasPointerCapture(e.pointerId)) g.releasePointerCapture(e.pointerId);
        grab = null;
      };
      const end = (u: PointerEvent) => {
        stop();
        if (u.type === 'pointercancel' && ub) {
          ub = orig;
          refresh();
        }
        if (ub) lastAt = { x: ub.x0, y: ub.y0 };
        placeBar();
        ta?.focus({ preventScroll: true });
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', end);
      g.addEventListener('pointercancel', end);
      grab = { orig, stop };
    });
    return g;
  }
  /** Esc while a handle or edge is dragged: the box goes back to where it was. False if no drag. */
  function cancelGrab() {
    if (!grab) return false;
    const { orig } = grab;
    grab.stop();
    if (ub) {
      ub = orig;
      refresh();
    }
    ta?.focus({ preventScroll: true });
    return true;
  }

  // ── Fonts: a small 98-style tool window over the workspace ───────
  const bar = document.createElement('div');
  bar.className = 'pt-fontbar';
  bar.hidden = true;
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Fonts');
  const closeGlyph = core.win.querySelector('.title [data-act="close"]')?.innerHTML ?? '';
  bar.innerHTML =
    `<div class="pt-fontbar-title"><span>Fonts</span><button type="button" class="tb" tabindex="-1" aria-label="Hide the Fonts toolbar">${closeGlyph}</button></div>` +
    `<div class="pt-fontbar-row"><select data-f="face" aria-label="Font"></select><select data-f="size" aria-label="Font size in points"></select>` +
    `<button type="button" class="pt-fontbtn" data-f="bold" aria-pressed="false" aria-label="Bold" title="Bold (Ctrl+B)"><b>B</b></button>` +
    `<button type="button" class="pt-fontbtn" data-f="italic" aria-pressed="false" aria-label="Italic" title="Italic (Ctrl+I)"><i>I</i></button>` +
    `<button type="button" class="pt-fontbtn" data-f="underline" aria-pressed="false" aria-label="Underline" title="Underline (Ctrl+U)"><u>U</u></button></div>`;
  const faceSel = bar.querySelector<HTMLSelectElement>('[data-f="face"]')!;
  const sizeSel = bar.querySelector<HTMLSelectElement>('[data-f="size"]')!;
  FONTS.forEach(([name, stack], i) => {
    const o = new Option(name, String(i), i === font.face, i === font.face);
    o.style.fontFamily = stack;
    faceSel.add(o);
  });
  for (const s of SIZES) sizeSel.add(new Option(String(s), String(s), s === font.size, s === font.size));
  const styleBtns = [...bar.querySelectorAll<HTMLButtonElement>('.pt-fontbtn')];
  core.view.before(bar);

  /** back to the text after a click elsewhere in Paint (not after keyboard use) */
  const backToText = () => setTimeout(() => ta?.focus({ preventScroll: true }));
  let byPointer = false;
  bar.addEventListener('pointerdown', () => (byPointer = true), true);
  bar.addEventListener('keydown', (e) => {
    byPointer = false;
    if (e.key === 'Escape' && ta) {
      // back to the text; the Paint window must not see this Esc (it would finish the text)
      e.preventDefault();
      e.stopPropagation();
      ta.focus({ preventScroll: true });
    }
  });
  const fontChanged = () => {
    measureFont();
    relayout();
    if (byPointer) backToText();
  };
  faceSel.addEventListener('change', () => {
    font.face = clamp(Number(faceSel.value) | 0, 0, FONTS.length - 1);
    fontChanged();
  });
  sizeSel.addEventListener('change', () => {
    font.size = SIZES.includes(Number(sizeSel.value)) ? Number(sizeSel.value) : 12;
    fontChanged();
  });
  function toggle(style: 'bold' | 'italic' | 'underline') {
    font[style] = !font[style];
    for (const b of styleBtns) b.setAttribute('aria-pressed', String(font[b.dataset.f as typeof style]));
    measureFont();
    relayout();
  }
  for (const b of styleBtns) {
    b.addEventListener('mousedown', (e) => ta && e.preventDefault()); // keep typing
    b.addEventListener('click', () => toggle(b.dataset.f as 'bold' | 'italic' | 'underline'));
  }

  // Where the bar sits, until the visitor drags it somewhere: the top right of
  // the workspace, or the bottom right, whichever leaves the picture (and its
  // resize handles) uncovered, as on a phone where the picture fills the width
  // but not the height. When both would cover the picture, the one that does
  // not cover the text box.
  let barAt: { x: number; y: number } | null = null;
  function placeBar() {
    if (bar.hidden) return;
    const v = core.view;
    const vw = v.clientWidth;
    const vh = v.clientHeight;
    bar.style.maxWidth = `${Math.max(120, vw)}px`; // a narrow window wraps the buttons to a second row
    const bw = bar.offsetWidth;
    const bh = bar.offsetHeight;
    const put = (x: number, y: number) => {
      // the bar and the view share their offset parent (the window)
      bar.style.left = `${v.offsetLeft + clamp(x, 0, Math.max(0, vw - bw))}px`;
      bar.style.top = `${v.offsetTop + clamp(y, 0, Math.max(0, vh - bh))}px`;
    };
    if (barAt) return put(barAt.x, barAt.y);
    const spots: [number, number][] = [
      [vw - bw - 4, 4],
      [vw - bw - 4, vh - bh - 4],
    ];
    // the part of the picture in view, with room for its handles (screen pixels)
    const vr = v.getBoundingClientRect();
    const cr = core.canvas.getBoundingClientRect();
    const m = 14 * (vr.width / (v.offsetWidth || 1) || 1);
    const pic = { left: Math.max(cr.left, vr.left), top: Math.max(cr.top, vr.top), right: Math.min(cr.right + m, vr.right), bottom: Math.min(cr.bottom + m, vr.bottom) };
    const box = frame?.getBoundingClientRect();
    const covers = (r: { left: number; top: number; right: number; bottom: number } | undefined) => {
      if (!r || r.left >= r.right || r.top >= r.bottom) return false;
      const a = bar.getBoundingClientRect();
      return a.left < r.right && r.left < a.right && a.top < r.bottom && r.top < a.bottom;
    };
    for (const ok of [() => !covers(pic) && !covers(box), () => !covers(box)]) {
      for (const [x, y] of spots) {
        put(x, y);
        if (ok()) return;
      }
    }
    put(...spots[0]);
  }
  new ResizeObserver(placeBar).observe(core.view);
  const title = bar.querySelector<HTMLElement>('.pt-fontbar-title')!;
  title.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    title.setPointerCapture(e.pointerId);
    const z = core.win.getBoundingClientRect().width / (core.win.offsetWidth || 1) || 1; // the page's zoom
    const sx0 = bar.offsetLeft - core.view.offsetLeft;
    const sy0 = bar.offsetTop - core.view.offsetTop;
    const cx = e.clientX;
    const cy = e.clientY;
    const move = (m: PointerEvent) => {
      barAt = { x: sx0 + (m.clientX - cx) / z, y: sy0 + (m.clientY - cy) / z };
      placeBar();
    };
    const end = () => {
      title.removeEventListener('pointermove', move);
      title.removeEventListener('pointerup', end);
      title.removeEventListener('pointercancel', end);
      if (barAt) barAt = { x: bar.offsetLeft - core.view.offsetLeft, y: bar.offsetTop - core.view.offsetTop };
      if (ta) backToText();
    };
    title.addEventListener('pointermove', move);
    title.addEventListener('pointerup', end);
    title.addEventListener('pointercancel', end);
  });
  title.querySelector('button')!.addEventListener('click', () => {
    bar.hidden = true;
    if (ta) backToText();
  });

  // a click on the colours or the options box while typing goes back to the text
  const toText = (e: MouseEvent) => {
    if (!ta || (e.type === 'click' && e.detail === 0)) return;
    if ((e.target as HTMLElement).closest('[data-pt-colorbox], [data-pt-options]')) backToText();
  };
  core.win.addEventListener('click', toText);
  core.win.addEventListener('contextmenu', toText);

  // Image > Draw Opaque. If no other module handled the menu item (st.opaque
  // did not change), toggle it here so it works for text on its own.
  let opaqueBefore = core.st.opaque;
  core.win.addEventListener('menu', (e) => (e as CustomEvent<string>).detail === 'opaque' && (opaqueBefore = core.st.opaque), true);
  core.win.addEventListener('menu', (e) => {
    if ((e as CustomEvent<string>).detail !== 'opaque') return;
    if (core.st.opaque === opaqueBefore) core.st.opaque = !core.st.opaque;
    core.setChecked('opaque', core.st.opaque);
    if (core.currentTool() === 'text') core.redrawOptions();
    paintPreview();
  });

  // ── The Edit menu while the box is open: it works on the text, as in 98 ──
  const EDIT_ACTIONS = new Set(['cut', 'copy', 'paste', 'selectall', 'undo', 'redo']);
  /** Cut and Copy: for selected text while the box is open, otherwise for a picture selection */
  function syncEditMenu() {
    const on = ta ? ta.selectionStart !== ta.selectionEnd : !!core.selection?.active();
    for (const a of ['cut', 'copy']) {
      const item = core.win.querySelector(`[data-action="${a}"]`);
      if (on) item?.removeAttribute('aria-disabled');
      else item?.setAttribute('aria-disabled', 'true');
    }
  }
  document.addEventListener('selectionchange', () => ta && syncEditMenu());
  core.win.addEventListener('pointerdown', (e) => ta && (e.target as Element).closest?.('.mb-btn') && syncEditMenu(), true);
  /** put text in place of the selection as if typed (so the textarea can undo it) */
  function insertText(t: HTMLTextAreaElement, s: string) {
    if (document.execCommand('insertText', false, s)) return;
    // no execCommand: put it in by hand
    t.setRangeText(s, t.selectionStart, t.selectionEnd, 'end');
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }
  async function editText(t: HTMLTextAreaElement, a: string) {
    t.focus({ preventScroll: true });
    if (a === 'selectall') {
      t.select();
      syncEditMenu();
    } else if (a === 'cut' || a === 'copy') {
      const s = t.value.slice(t.selectionStart, t.selectionEnd);
      if (!s || document.execCommand(a)) return;
      try {
        await navigator.clipboard.writeText(s);
      } catch {
        return;
      }
      if (a === 'cut' && ta === t) {
        t.focus({ preventScroll: true });
        if (!document.execCommand('delete')) insertText(t, '');
      }
    } else if (a === 'paste') {
      let s = '';
      try {
        s = await navigator.clipboard.readText();
      } catch {
        return; // no permission or no Clipboard API; Ctrl+V still works
      }
      s = s.replace(/\r\n?/g, '\n');
      // (execCommand sends no beforeinput, so the fit is checked here)
      if (!s || ta !== t || !fits(t, s)) return;
      t.focus({ preventScroll: true });
      insertText(t, s);
    } else if (edited) {
      document.execCommand(a); // undo / redo the typing
    } else {
      // nothing typed in this box: put it away and undo (or redo) the picture
      commit(false);
      core.win.dispatchEvent(new CustomEvent('menu', { detail: a }));
    }
  }
  // Before any other module (the core's Undo, select.ts's Paste...) sees it.
  document.addEventListener(
    'menu',
    (e) => {
      const a = (e as CustomEvent<string>).detail;
      const t = ta;
      if (!t || !EDIT_ACTIONS.has(a) || !(e.target instanceof Node) || !core.win.contains(e.target)) return;
      e.stopPropagation();
      void editText(t, a);
    },
    true,
  );

  // A menu command or a dialog that leaves the box open hands the keyboard
  // back to it, if it had the keyboard before (the core focuses the picture).
  let hadKeys = false;
  document.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement;
    if (t === ta) hadKeys = true;
    else if (core.win.contains(t) && t !== core.win && t !== core.canvas && !t.closest('.mi, .mb-btn, [data-pt-colorbox], [data-pt-options]')) hadKeys = false;
  });
  const keysBack = () => {
    const t = ta;
    if (!t || !hadKeys) return;
    setTimeout(() => ta === t && !document.querySelector('dialog[open]') && t.focus({ preventScroll: true }));
  };
  core.win.addEventListener('menu', keysBack);
  document.addEventListener('close', (e) => (e.target as Element).matches?.('.pt-dialog, .pt-viewbitmap') && keysBack(), true);

  // a zoom change scrolls the view after the layout: place the bar again once it has
  let barFrame = 0;
  core.onLayout(() => {
    relayout();
    cancelAnimationFrame(barFrame);
    barFrame = requestAnimationFrame(placeBar);
  });

  // ── The tool ─────────────────────────────────────────────────────
  let band: { a: Pt; b: Pt; el: HTMLElement; cx: number; cy: number; moved: boolean; hadBox: boolean } | null = null;
  const clampPt = (p: Pt): Pt => {
    const bm = core.bm();
    return { x: clamp(p.x, 0, bm.w - 1), y: clamp(p.y, 0, bm.h - 1) };
  };
  const endBand = () => {
    band?.el.remove();
    band = null;
    core.status.size('');
  };

  core.addTool({
    id: 'text',
    help: 'Inserts text into the picture. Drag a box, then type.',
    cursor: 'crosshair',
    options(box) {
      const white = R.rgb(255, 255, 255);
      box.append(
        core.optionButtons(
          2,
          1,
          34,
          22,
          core.st.opaque ? 0 : 1,
          (i) => (i === 0 ? 'Opaque background' : 'Transparent background'),
          (i, b, ink) => {
            if (i === 0) R.rect(b, 3, 2, 30, 19, 1, ink, white);
            R.ellipse(b, 6, 5, 17, 16, 1, ink, R.rgb(255, 255, 0));
            R.rect(b, 14, 8, 27, 16, 1, ink, R.rgb(255, 0, 0));
          },
          (i) => {
            core.st.opaque = i === 0;
            core.setChecked('opaque', core.st.opaque);
            paintPreview();
          },
        ),
      );
    },
    down(i) {
      const hadBox = !!ub;
      commit(false);
      measureFont();
      const a = clampPt(i.p);
      const el = document.createElement('div');
      el.className = 'pt-textband';
      core.overlay.append(el);
      band = { a, b: a, el, cx: i.e.clientX, cy: i.e.clientY, moved: false, hadBox };
      core.place(el, { x0: a.x, y0: a.y, x1: a.x, y1: a.y });
    },
    move(i) {
      if (!band) return;
      band.b = clampPt(i.p);
      if (Math.abs(i.e.clientX - band.cx) > 3 || Math.abs(i.e.clientY - band.cy) > 3) band.moved = true;
      const { a, b } = band;
      core.place(band.el, { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) });
      core.status.size(`${Math.abs(b.x - a.x) + 1}x${Math.abs(b.y - a.y) + 1}`);
    },
    up() {
      if (!band) return;
      const { a, b, moved, hadBox } = band;
      endBand();
      // a click outside an open box only finishes it; a click elsewhere starts a box there
      if (!moved && hadBox) return;
      open(moved ? boxFrom(a, b) : boxAt(a));
    },
    cancel: endBand,
    key(e) {
      if (e.key === 'Escape' && ub) {
        if (!cancelGrab()) commit(true);
        return true;
      }
      // the keyboard way in: Enter on the picture opens a box where the last one was
      if (e.key === 'Enter' && !ub && e.target === core.canvas) {
        measureFont();
        open(boxAt(lastAt));
        return true;
      }
      return false;
    },
    activate() {
      measureFont();
      faceSel.value = String(font.face);
      sizeSel.value = String(font.size);
      bar.hidden = false;
      placeBar();
    },
    deactivate() {
      commit(false);
      endBand();
      bar.hidden = true;
    },
    flush: () => commit(true),
    busy: () => !!ta && ta.value !== '',
  });
}
