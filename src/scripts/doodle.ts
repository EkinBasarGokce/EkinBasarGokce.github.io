/**
 * Mounts every <canvas data-doodle> on the page.
 * One face per visit: the seed lives in sessionStorage, so the hero and the
 * footer show the same face while you browse, and the next visit draws a new one.
 *
 * The hero face draws itself: the engine's canvas calls are recorded once,
 * then replayed a few strokes per frame, so you watch the pen move.
 * Clicking it draws another face; it leans a little toward the pointer.
 */
// @ts-ignore: plain JS module lifted from the first version of the site
import { drawFace, setPalette, randomSeed } from './sketch-engine.js';

const KEY = 'doodle-seed';
const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

let seed = readSeed();

function readSeed(): number {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v) return Number(v) >>> 0;
  } catch {}
  const s = randomSeed();
  writeSeed(s);
  return s;
}
function writeSeed(s: number) {
  try {
    sessionStorage.setItem(KEY, String(s));
  } catch {}
}

function isDark(): boolean {
  const t = root.dataset.theme;
  return t ? t === 'dark' : darkQuery.matches;
}

/** Canvas cannot resolve light-dark() tokens, so the two inks live here. */
export const INKS = { light: { ink: '#2a2430', pale: '#fff8ee' }, dark: { ink: '#eee6da', pale: '#17141a' } };

function applyPalette() {
  const { ink, pale } = isDark() ? INKS.dark : INKS.light;
  if (isDark()) {
    setPalette({
      ink, pale, dark: ink, pink: '#b57a86',
      skin: ['#6e5048', '#644a4c', '#5d4855', '#735649', '#594550'],
      hair: ['#eee6da', '#cfc4d8', '#b8a7c9', '#d9b8a0', '#e8ddd0'],
      hat: ['#f3a6ab', '#f6c08f', '#e7b3cf', '#c6c2ee'],
    });
  } else {
    setPalette({
      ink, pale, dark: '#2a2430', pink: '#f2b4b8',
      skin: ['#f6d2be', '#f2bfa8', '#e9a98e', '#f8e0cc', '#e7b9a2'],
      hair: ['#2a2430', '#2a2430', '#2a2430', '#3b2f2a', '#5a4636', '#8f82a3', '#7e8fb5', '#b9ad99'],
      hat: ['#d9707a', '#e6b067', '#9c86b0', '#7e93c2', '#5d6f6e'],
    });
  }
}

type Op = [string, unknown[]] | ['=', string, unknown];

/** A stand-in 2D context that writes down every call instead of drawing. */
function recorder(ops: Op[]): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, prop: string) => (...args: unknown[]) => { ops.push([prop, args]); },
    set: (_t, prop: string, value: unknown) => { ops.push(['=', prop, value]); return true; },
  });
}

function play(ctx: CanvasRenderingContext2D, op: Op) {
  if (op[0] === '=') (ctx as unknown as Record<string, unknown>)[op[1] as string] = op[2];
  else (ctx as unknown as Record<string, (...a: unknown[]) => void>)[op[0]](...(op[1] as unknown[]));
}

const running = new WeakMap<HTMLCanvasElement, number>();

function geometry(canvas: HTMLCanvasElement) {
  const box = canvas.getBoundingClientRect();
  const w = box.width || canvas.width;
  const h = box.height || canvas.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const small = canvas.dataset.doodle === 'small';
  return { w, h, dpr, size: Math.min(w, h) * (small ? 0.5 : 0.66), cx: w / 2, cy: h * (small ? 0.52 : 0.5) };
}

function draw(canvas: HTMLCanvasElement, animate = false) {
  const g = geometry(canvas);
  if (!g.w || !g.h) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  cancelAnimationFrame(running.get(canvas) ?? 0);
  ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  ctx.clearRect(0, 0, g.w, g.h);

  if (!animate || reduce.matches) {
    drawFace(ctx, { seed, size: g.size, cx: g.cx, cy: g.cy });
    return;
  }

  // record the face, then replay it stroke by stroke
  const ops: Op[] = [];
  drawFace(recorder(ops), { seed, size: g.size, cx: g.cx, cy: g.cy });
  const strokes = ops.filter((o) => o[0] === 'stroke' || o[0] === 'fill').length || 1;
  const perFrame = Math.max(1, Math.ceil(strokes / 70)); // about 1.2 s at 60 fps
  let i = 0;
  const step = () => {
    let done = 0;
    while (i < ops.length && done < perFrame) {
      const op = ops[i++];
      play(ctx, op);
      if (op[0] === 'stroke' || op[0] === 'fill') done++;
    }
    if (i < ops.length) running.set(canvas, requestAnimationFrame(step));
  };
  running.set(canvas, requestAnimationFrame(step));
}

function all(): HTMLCanvasElement[] {
  return Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas[data-doodle]'));
}

function redrawAll(animate = false) {
  applyPalette();
  all().forEach((c) => draw(c, animate && c.dataset.doodle === 'hero'));
}

/** The hero face leans a little toward the pointer. */
function lean() {
  const el = document.querySelector<HTMLElement>('[data-lean]');
  if (!el || reduce.matches || !matchMedia('(hover: hover)').matches) return;
  let raf = 0;
  window.addEventListener('pointermove', (e) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / window.innerWidth;
      const dy = (e.clientY - (r.top + r.height / 2)) / window.innerHeight;
      el.style.setProperty('--tilt', `${(dx * 9).toFixed(2)}deg`);
      el.style.setProperty('--nx', `${(dx * 14).toFixed(1)}px`);
      el.style.setProperty('--ny', `${(dy * 10).toFixed(1)}px`);
    });
  }, { passive: true });
}

let mounted = false;
export function mountDoodles() {
  const fresh = all().filter((c) => !c.dataset.mounted);
  if (!fresh.length) return;
  applyPalette();
  for (const c of fresh) {
    c.dataset.mounted = '1';
    const hero = c.dataset.doodle === 'hero';
    draw(c, hero);
    if (hero) {
      const trigger = c.closest('[data-doodle-trigger]') as HTMLElement | null;
      (trigger ?? c).addEventListener('click', () => {
        seed = randomSeed();
        writeSeed(seed);
        redrawAll(true);
      });
    }
  }
  if (!mounted) {
    mounted = true;
    lean();
  }
}

// Recolour when the theme changes.
new MutationObserver(() => redrawAll(false)).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
darkQuery.addEventListener('change', () => redrawAll(false));

// Redraw at the new size when the layout width changes.
let lastW = window.innerWidth;
let t: number | undefined;
window.addEventListener('resize', () => {
  clearTimeout(t);
  t = window.setTimeout(() => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    redrawAll(false);
  }, 150);
});
