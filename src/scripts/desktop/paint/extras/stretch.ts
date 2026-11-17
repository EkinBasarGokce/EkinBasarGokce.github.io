/**
 * Image > Stretch/Skew...: stretch by a percentage (nearest neighbour, so
 * pixels stay hard-edged) and skew by an angle, on the selection if there is
 * one, else on the whole picture. Skewing widens (or heightens) the picture to
 * fit the slanted image and fills the new corners with the background colour.
 *
 * Directions: a positive horizontal skew leans the picture like italic text
 * (its top moves right); a positive vertical skew lifts its right side.
 */
import * as R from '../raster';
import { type Core, MAX_SIDE, paintCanvas } from '../core';

const clampSide = (n: number) => Math.max(1, Math.min(MAX_SIDE, Math.round(n)));

/** nearest-neighbour resize to w x h */
export function scaleBitmap(b: R.Bitmap, w: number, h: number): R.Bitmap {
  w = clampSide(w);
  h = clampSide(h);
  const out = R.createBitmap(w, h, 0);
  const xs = new Int32Array(w);
  for (let x = 0; x < w; x++) xs[x] = Math.min(b.w - 1, Math.floor((x * b.w) / w));
  for (let y = 0; y < h; y++) {
    const src = Math.min(b.h - 1, Math.floor((y * b.h) / h)) * b.w;
    const dst = y * w;
    for (let x = 0; x < w; x++) out.data[dst + x] = b.data[src + xs[x]];
  }
  return out;
}

/** how far row (or column) i of n moves for a shear of slope t; 0 for the row that stays put */
const shift = (i: number, n: number, t: number) => (t > 0 ? Math.round((n - 1 - i) * t) : Math.round(i * -t));

/** each row slides sideways: the top moves right for a positive slope */
export function skewH(b: R.Bitmap, t: number, bg: R.Color): R.Bitmap {
  const W = clampSide(b.w + Math.round((b.h - 1) * Math.abs(t)));
  const out = R.createBitmap(W, b.h, bg);
  for (let y = 0; y < b.h; y++) {
    const off = shift(y, b.h, t);
    const n = Math.min(b.w, W - off);
    if (n > 0) out.data.set(b.data.subarray(y * b.w, y * b.w + n), y * W + off);
  }
  return out;
}

/** each column slides up or down: the right side rises for a positive slope */
export function skewV(b: R.Bitmap, t: number, bg: R.Color): R.Bitmap {
  const H = clampSide(b.h + Math.round((b.w - 1) * Math.abs(t)));
  const out = R.createBitmap(b.w, H, bg);
  for (let x = 0; x < b.w; x++) {
    const off = shift(x, b.w, t);
    const n = Math.min(b.h, H - off);
    for (let y = 0; y < n; y++) out.data[(y + off) * b.w + x] = b.data[y * b.w + x];
  }
  return out;
}

const slope = (deg: number) => Math.tan((deg * Math.PI) / 180);

/**
 * The size of a stretch (percent) then skew (degrees) of a w x h picture.
 * A stretch past MAX_SIDE is scaled down on both sides alike, so the picture
 * keeps its shape (`fitted`). A skew is never cut short: `fits` is false
 * when its result would pass MAX_SIDE.
 */
export function stretchSkewSize(w: number, h: number, sh: number, sv: number, kh: number, kv: number) {
  let fitted = false;
  if (sh !== 100 || sv !== 100) {
    const W = (w * sh) / 100;
    const H = (h * sv) / 100;
    const k = Math.min(1, MAX_SIDE / W, MAX_SIDE / H);
    fitted = k < 1;
    w = clampSide(W * k);
    h = clampSide(H * k);
  }
  const stretched = { w, h };
  if (kh) w += Math.round((h - 1) * Math.abs(slope(kh)));
  if (kv) h += Math.round((w - 1) * Math.abs(slope(kv)));
  return { stretched, w, h, fitted, fits: w <= MAX_SIDE && h <= MAX_SIDE };
}

/** stretch (percent) then skew (degrees), as one step; the picture comes back unchanged if the skew would not fit */
export function stretchSkew(b: R.Bitmap, sh: number, sv: number, kh: number, kv: number, bg: R.Color): R.Bitmap {
  const size = stretchSkewSize(b.w, b.h, sh, sv, kh, kv);
  if (!size.fits) return b;
  let out = b;
  if (sh !== 100 || sv !== 100) out = scaleBitmap(out, size.stretched.w, size.stretched.h);
  if (kh) out = skewH(out, slope(kh), bg);
  if (kv) out = skewV(out, slope(kv), bg);
  return out;
}

// the dialog's little pictures, drawn with the pixel engine
const ICONS: ((b: R.Bitmap, ink: R.Color) => void)[] = [
  // stretch horizontal: a box with a two-headed arrow across it
  (b, k) => {
    R.rect(b, 6, 4, 17, 15, 1, k, null);
    R.strokeLine(b, 1, 9, 22, 9, R.stamps.dot, k);
    for (const [x, d] of [[1, 1], [22, -1]]) for (let i = 1; i <= 3; i++) R.strokeLine(b, x + i * d, 9 - i, x + i * d, 9 + i, R.stamps.dot, k);
  },
  // stretch vertical
  (b, k) => {
    R.rect(b, 6, 4, 17, 15, 1, k, null);
    R.strokeLine(b, 11, 0, 11, 19, R.stamps.dot, k);
    for (const [y, d] of [[0, 1], [19, -1]]) for (let i = 1; i <= 3; i++) R.strokeLine(b, 11 - i, y + i * d, 11 + i, y + i * d, R.stamps.dot, k);
  },
  // skew horizontal: leaning like italics
  (b, k) => {
    R.strokeLine(b, 9, 3, 21, 3, R.stamps.dot, k);
    R.strokeLine(b, 2, 16, 14, 16, R.stamps.dot, k);
    R.strokeLine(b, 2, 16, 9, 3, R.stamps.dot, k);
    R.strokeLine(b, 14, 16, 21, 3, R.stamps.dot, k);
  },
  // skew vertical: the right side higher
  (b, k) => {
    R.strokeLine(b, 3, 7, 3, 18, R.stamps.dot, k);
    R.strokeLine(b, 20, 1, 20, 12, R.stamps.dot, k);
    R.strokeLine(b, 3, 7, 20, 1, R.stamps.dot, k);
    R.strokeLine(b, 3, 18, 20, 12, R.stamps.dot, k);
  },
];

type Values = { sh: number; sv: number; kh: number; kv: number };

export function install(core: Core) {
  /** `last`: the values to show again after a skew that would not fit */
  async function stretch(last: Values = { sh: 100, sv: 100, kh: 0, kv: 0 }) {
    const row = (i: number, id: string, label: string, name: string, min: number, max: number, value: number, unit: string) =>
      `<span data-icon="${i}"></span><label for="${id}">${label}</label>` +
      `<input id="${id}" name="${name}" type="number" inputmode="numeric" required min="${min}" max="${max}" step="1" value="${value}" style="width:56px" />` +
      `<span>${unit}</span>`;
    const grid = 'class="pt-form" style="grid-template-columns:auto auto auto 1fr;gap:6px 8px"';
    const body = core.el(
      `<fieldset><legend>Stretch</legend><div ${grid}>` +
        row(0, 'pt-sh', 'Horizontal:', 'sh', 1, 500, last.sh, '%') +
        row(1, 'pt-sv', 'Vertical:', 'sv', 1, 500, last.sv, '%') +
        `</div></fieldset><fieldset style="margin-top:14px"><legend>Skew</legend><div ${grid}>` +
        row(2, 'pt-kh', 'Horizontal:', 'kh', -89, 89, last.kh, 'Degrees') +
        row(3, 'pt-kv', 'Vertical:', 'kv', -89, 89, last.kv, 'Degrees') +
        `</div></fieldset>`,
    );
    body.querySelectorAll<HTMLElement>('[data-icon]').forEach((slot) => {
      const b = R.createBitmap(24, 20, R.rgb(192, 192, 192));
      ICONS[Number(slot.dataset.icon)](b, R.rgb(0, 0, 0));
      const c = document.createElement('canvas');
      c.style.cssText = 'display:block;width:24px;height:20px;image-rendering:pixelated';
      c.setAttribute('aria-hidden', 'true');
      paintCanvas(c, b);
      slot.replaceWith(c);
    });
    const shown = core.dialog('Stretch and Skew', body, [
      { label: 'OK', value: 'ok', primary: true },
      { label: 'Cancel', value: 'cancel' },
    ]);
    body.querySelector<HTMLInputElement>('input')?.select();
    const { value, form } = await shown;
    if (value !== 'ok') return;
    const data = new FormData(form);
    const num = (name: string, lo: number, hi: number, fallback: number) => {
      const n = Math.round(Number(data.get(name)));
      return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
    };
    const sh = num('sh', 1, 500, 100);
    const sv = num('sv', 1, 500, 100);
    const kh = num('kh', -89, 89, 0);
    const kv = num('kv', -89, 89, 0);
    if (sh === 100 && sv === 100 && kh === 0 && kv === 0) return;
    // the selection if there is one, else the picture; a skew that would pass MAX_SIDE is refused, not cut off
    const box = core.selection?.active() ? core.selection.box() : null;
    const size = stretchSkewSize(box ? box.x1 - box.x0 + 1 : core.bm().w, box ? box.y1 - box.y0 + 1 : core.bm().h, sh, sv, kh, kv);
    if (!size.fits) {
      await core.dialog(
        'Paint',
        core.el(`<p class="pt-ask">The picture would be too large. A picture can be at most ${MAX_SIDE} by ${MAX_SIDE} pixels; try a smaller angle or stretch.</p>`),
        [{ label: 'OK', value: 'ok', primary: true }],
      );
      return stretch({ sh, sv, kh, kv });
    }
    const bg = core.st.bg;
    const fn = (b: R.Bitmap) => stretchSkew(b, sh, sv, kh, kv, bg);
    if (core.selection?.transform(fn)) return fitted(size.fitted);
    core.flush();
    const bm = core.bm();
    const next = fn(R.cloneBitmap(bm));
    if (next.w === bm.w && next.h === bm.h) core.wholeOp(() => core.bm().data.set(next.data));
    else core.replaceOp(next);
    fitted(size.fitted);
  }
  const fitted = (yes: boolean) => yes && core.status.help(`Stretched as far as Paint allows (${MAX_SIDE} pixels), keeping the shape.`);
  core.onMenu('stretch', () => void stretch());
}
