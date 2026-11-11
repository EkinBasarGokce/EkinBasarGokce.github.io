/**
 * Mounts every <canvas data-doodle> on the page.
 * One face per visit: the seed lives in sessionStorage, so the hero and the
 * footer show the same face while you browse, and the next visit draws a new one.
 * Clicking the hero face draws another.
 */
// @ts-ignore: plain JS module lifted from the first version of the site
import { drawFace, setPalette, randomSeed } from './sketch-engine.js';

const KEY = 'doodle-seed';
const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

let seed = readSeed();
let take = 1;

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

/**
 * Engine palette tuned to the page: peach washes, field-coloured hats.
 * (Canvas cannot resolve light-dark() tokens, so the two inks live here.)
 */
export const INKS = { light: { ink: '#2a2430', pale: '#fff8ee' }, dark: { ink: '#eee6da', pale: '#17141a' } };

function applyPalette() {
  const { ink, pale } = isDark() ? INKS.dark : INKS.light;
  if (isDark()) {
    setPalette({
      ink,
      pale,
      dark: ink,
      pink: '#b57a86',
      skin: ['#6e5048', '#644a4c', '#5d4855', '#735649', '#594550'],
      hair: ['#eee6da', '#cfc4d8', '#b8a7c9', '#d9b8a0', '#e8ddd0'],
      hat: ['#f3a6ab', '#f6c08f', '#e7b3cf', '#c6c2ee'],
    });
  } else {
    setPalette({
      ink,
      pale,
      dark: '#2a2430',
      pink: '#f2b4b8',
      skin: ['#f6d2be', '#f2bfa8', '#e9a98e', '#f8e0cc', '#e7b9a2'],
      hair: ['#2a2430', '#2a2430', '#2a2430', '#3b2f2a', '#5a4636', '#8f82a3', '#7e8fb5', '#b9ad99'],
      hat: ['#d9707a', '#e6b067', '#9c86b0', '#7e93c2', '#5d6f6e'],
    });
  }
}

function draw(canvas: HTMLCanvasElement) {
  const box = canvas.getBoundingClientRect();
  const w = box.width || canvas.width;
  const h = box.height || canvas.height;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const small = canvas.dataset.doodle === 'small';
  const size = Math.min(w, h) * (small ? 0.5 : 0.66);
  drawFace(ctx, { seed, size, cx: w / 2, cy: h * (small ? 0.52 : 0.5) });
}

function wipe(canvas: HTMLCanvasElement) {
  if (reduce.matches || !canvas.animate) return;
  canvas.animate(
    [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }],
    { duration: 700, easing: 'cubic-bezier(.22,.61,.36,1)' },
  );
}

function all(): HTMLCanvasElement[] {
  return Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas[data-doodle]'));
}

function redrawAll() {
  applyPalette();
  all().forEach(draw);
}

export function mountDoodles() {
  const fresh = all().filter((c) => !c.dataset.mounted);
  if (!fresh.length) return;
  applyPalette();
  for (const c of fresh) {
    c.dataset.mounted = '1';
    draw(c);
    if (c.dataset.doodle === 'hero') {
      wipe(c);
      const trigger = c.closest('[data-doodle-trigger]') as HTMLElement | null;
      (trigger ?? c).addEventListener('click', () => {
        seed = randomSeed();
        writeSeed(seed);
        take += 1;
        document.querySelectorAll('[data-doodle-take]').forEach((el) => {
          el.textContent = `take ${take}`;
        });
        redrawAll();
        all().forEach(wipe);
      });
    }
  }
}

// Recolour when the theme changes.
new MutationObserver(redrawAll).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
darkQuery.addEventListener('change', redrawAll);

// Redraw at the new size when the layout width changes.
let lastW = window.innerWidth;
let t: number | undefined;
window.addEventListener('resize', () => {
  clearTimeout(t);
  t = window.setTimeout(() => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    redrawAll();
  }, 150);
});
