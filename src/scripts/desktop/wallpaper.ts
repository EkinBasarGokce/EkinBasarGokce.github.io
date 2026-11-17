/**
 * A picture of the visitor's own as the desktop wallpaper (Paint's File > Set
 * As Wallpaper), as in 98: tiled from the top-left corner, or once in the
 * middle on the classic teal. One picture pixel covers one page pixel and
 * stays hard-edged at any zoom.
 *
 * The picture is a layer just above the photo wallpaper (`.wallpaper`, hidden
 * while a picture is shown) and below the icons and windows. It takes no
 * pointer input, so a press on it is a press on the empty desktop. While it
 * is shown the desktop ([data-desktop]) has the class `custom-wallpaper`, so
 * the icon labels can get a solid background (they are tuned for the photo).
 *
 * The choice is kept in this browser (localStorage 'desktop-wallpaper-v1': a
 * PNG data URL and the mode). A picture too large to keep, or storage that is
 * full or blocked, leaves the wallpaper for this visit only.
 */

export type WallpaperMode = 'tile' | 'center';

const STORE = 'desktop-wallpaper-v1';
/** the longest data URL kept (characters); leaves room for Paint's own autosave */
const MAX_STORED = 1_500_000;
const TEAL = '#008080';
const PNG_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

/** bumped by every change, so a picture still loading cannot undo a later one */
let generation = 0;
/** the object URL on screen (revoked when it is replaced) */
let objectUrl: string | null = null;

const desktop = () => document.querySelector<HTMLElement>('[data-desktop]');
const photo = (desk: HTMLElement) => desk.querySelector<HTMLElement>('.wallpaper');
const layerOf = (desk: HTMLElement) => desk.querySelector<HTMLElement>(':scope > [data-custom-wallpaper]');
/** set on the desktop while the visitor's picture is shown (win98.css gives the icon labels a solid background then) */
const SHOWN_CLASS = 'custom-wallpaper';

function makeLayer(desk: HTMLElement) {
  desk.classList.add(SHOWN_CLASS);
  let el = layerOf(desk);
  if (el) return el;
  el = document.createElement('div');
  el.setAttribute('data-custom-wallpaper', '');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `position:absolute;inset:0;pointer-events:none;image-rendering:pixelated;background-color:${TEAL}`;
  // above the photo, below the icons and the windows
  const p = photo(desk);
  if (p) p.after(el);
  else desk.prepend(el);
  return el;
}

function dropObjectUrl() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
}

/** loads an image URL and gives its size in pixels */
function measure(url: string) {
  return new Promise<{ w: number; h: number }>((resolve, reject) => {
    const im = new Image();
    im.onload = () => (im.naturalWidth > 0 && im.naturalHeight > 0 ? resolve({ w: im.naturalWidth, h: im.naturalHeight }) : reject(new Error('empty image')));
    im.onerror = () => reject(new Error('unreadable image'));
    im.src = url;
  });
}

function paint(layer: HTMLElement, url: string, size: { w: number; h: number }, mode: WallpaperMode) {
  const s = layer.style;
  s.backgroundImage = `url("${url}")`;
  s.backgroundSize = `${size.w}px ${size.h}px`;
  s.backgroundRepeat = mode === 'tile' ? 'repeat' : 'no-repeat';
  s.backgroundPosition = mode === 'tile' ? '0 0' : 'center';
  layer.dataset.mode = mode;
}

function store(dataUrl: string | null, mode: WallpaperMode) {
  try {
    if (dataUrl && dataUrl.length <= MAX_STORED && PNG_URL.test(dataUrl)) {
      localStorage.setItem(STORE, JSON.stringify({ png: dataUrl, mode }));
      return true;
    }
  } catch {
    // full or blocked: fall through, so an older wallpaper does not come back instead
  }
  try {
    localStorage.removeItem(STORE);
  } catch {}
  return false;
}

function blobToDataUrl(b: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

/**
 * Shows a PNG (a Blob, or a data URL) as the desktop wallpaper, tiled or
 * centred, and keeps it for the next visit when it is small enough. Resolves
 * true when it was kept, false when it lasts for this visit only. Rejects if
 * the picture cannot be read (the wallpaper does not change then).
 */
export async function setWallpaper(png: Blob | string, mode: WallpaperMode): Promise<boolean> {
  const desk = desktop();
  if (!desk) return false;
  if (mode !== 'tile' && mode !== 'center') throw new TypeError('setWallpaper: mode must be "tile" or "center"');
  if (typeof png === 'string' && !PNG_URL.test(png)) throw new TypeError('setWallpaper: not a PNG data URL');
  const gen = ++generation;
  const blob = typeof png === 'string' ? null : new Blob([png], { type: 'image/png' });
  const url = blob ? URL.createObjectURL(blob) : (png as string);
  let size: { w: number; h: number };
  try {
    size = await measure(url);
  } catch (err) {
    if (blob) URL.revokeObjectURL(url);
    throw err;
  }
  if (gen !== generation) {
    // a later call (or a reset) won
    if (blob) URL.revokeObjectURL(url);
    return false;
  }
  dropObjectUrl();
  if (blob) objectUrl = url;
  paint(makeLayer(desk), url, size, mode);
  photo(desk)?.setAttribute('hidden', '');

  let dataUrl: string | null = typeof png === 'string' ? png : null;
  // a base64 data URL is 4/3 of the bytes, plus its header
  if (blob && (blob.size * 4) / 3 + 32 <= MAX_STORED) dataUrl = await blobToDataUrl(blob).catch(() => null);
  if (gen !== generation) return false;
  return store(dataUrl, mode);
}

/** back to the photo wallpaper, and forget the visitor's picture */
export function resetWallpaper(): void {
  generation++;
  const desk = desktop();
  if (desk) {
    layerOf(desk)?.remove();
    desk.classList.remove(SHOWN_CLASS);
    photo(desk)?.removeAttribute('hidden');
  }
  dropObjectUrl();
  try {
    localStorage.removeItem(STORE);
  } catch {}
}

/**
 * Brings back the visitor's wallpaper, if they set one on an earlier visit.
 * Call once when the page loads. Resolves true when one was shown. Anything
 * unreadable in storage is dropped and the photo stays.
 */
export async function applySavedWallpaper(): Promise<boolean> {
  const desk = desktop();
  if (!desk) return false;
  let saved: { png?: unknown; mode?: unknown } | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
  } catch {
    saved = null;
  }
  if (!saved || typeof saved !== 'object') return false;
  const { png, mode } = saved;
  if (typeof png !== 'string' || png.length > MAX_STORED || !PNG_URL.test(png) || (mode !== 'tile' && mode !== 'center')) {
    try {
      localStorage.removeItem(STORE);
    } catch {}
    return false;
  }
  const gen = ++generation;
  // teal at once, so the photo does not flash up first
  makeLayer(desk);
  photo(desk)?.setAttribute('hidden', '');
  try {
    const size = await measure(png);
    if (gen !== generation) return false;
    dropObjectUrl();
    paint(makeLayer(desk), png, size, mode);
    return true;
  } catch {
    if (gen === generation) resetWallpaper();
    return false;
  }
}

/** true while the visitor's own picture is the wallpaper */
export function hasCustomWallpaper(): boolean {
  const desk = desktop();
  return !!desk && !!layerOf(desk);
}
