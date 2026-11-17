/**
 * Paint's core contract. paint.ts implements Core; every tool and feature
 * module (tools/*.ts, extras/*.ts) exports `install(core: Core)` and talks to
 * the picture only through this interface.
 *
 * Coordinates: a Pt is a picture pixel (integers, may lie outside the
 * picture). Colours are raster.ts Colors (0xAABBGGRR, alpha always 255).
 * All drawing goes into core.bm() with raster.ts, inside beginOp()/endOp() so
 * it can be undone; render() shows what changed.
 */
import * as R from './raster';

export type ToolId =
  | 'freeselect'
  | 'select'
  | 'eraser'
  | 'fill'
  | 'pick'
  | 'magnifier'
  | 'pencil'
  | 'brush'
  | 'airbrush'
  | 'text'
  | 'line'
  | 'curve'
  | 'rect'
  | 'polygon'
  | 'ellipse'
  | 'roundrect';

export interface Pt {
  x: number;
  y: number;
}

/** what a tool gets on pointer down / move / up over the picture */
export interface PointerInfo {
  p: Pt;
  /** 0 = left (or touch/pen), 2 = right */
  button: 0 | 2;
  shift: boolean;
  ctrl: boolean;
  /** the colour this button draws with, and the other one */
  ink: R.Color;
  paper: R.Color;
  e: PointerEvent;
}

export interface Tool {
  id: ToolId;
  /** status-bar text while the tool is chosen */
  help: string;
  /** CSS cursor over the picture (default crosshair) */
  cursor?: string;
  /** fill the options box under the tool box (see core.optionButtons) */
  options?(box: HTMLElement): void;
  /** pointer pressed on the picture; the core captures the pointer */
  down?(i: PointerInfo): void;
  /** pointer moved while pressed (called for every coalesced point) */
  move?(i: PointerInfo): void;
  /** pointer released: the end of a drag */
  up?(i: PointerInfo): void;
  /** pointer moved over the picture while NOT pressed (rubber bands) */
  hover?(p: Pt, e: PointerEvent): void;
  /** double-click on the picture (e.g. finish a polygon) */
  dblclick?(p: Pt, e: MouseEvent): void;
  /** Esc, pointercancel or lost capture in the middle of a drag: undo the preview */
  cancel?(): void;
  /** keydown in the Paint window while this tool is chosen; return true if handled */
  key?(e: KeyboardEvent): boolean;
  /** chosen / un-chosen */
  activate?(): void;
  deactivate?(): void;
  /**
   * Commit anything still floating (a selection being moved, text being
   * typed) into the picture. The core calls this before undo/redo, saving,
   * New/Open, picture-wide image commands, switching tools and closing.
   */
  flush?(): void;
  /** true while the tool holds something not yet in the picture */
  busy?(): boolean;
}

/** provided by tools/select.ts; null until installed or when nothing is selected */
export interface Selection {
  /** something is selected (floating or not) */
  active(): boolean;
  /** the selected box in picture pixels */
  box(): R.Box | null;
  /**
   * Replace the selection's pixels with fn(current) (flip, rotate, invert,
   * stretch/skew act on the selection when there is one). Returns false when
   * there is no selection, so the caller applies fn to the whole picture.
   */
  transform(fn: (b: R.Bitmap) => R.Bitmap): boolean;
}

export interface DialogButton {
  label: string;
  value: string;
  primary?: boolean;
}

export interface Core {
  readonly win: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** the grey, scrolling workspace around the picture */
  readonly view: HTMLElement;
  /**
   * A layer exactly over the picture (same size, follows the zoom), for
   * marquees, floating selections and text boxes. It has pointer-events: none;
   * give a child pointer-events: auto if it must take input. Place children
   * in picture pixels with core.place().
   */
  readonly overlay: HTMLElement;
  /** the Desktop page's window manager (for the desktop element, titles, etc.) */
  readonly wm: { desk: HTMLElement };

  // ── the picture ──
  bm(): R.Bitmap;
  /** show the changed part of the picture (and, inside an op, remember it for undo) */
  render(): void;
  beginOp(): void;
  endOp(): void;
  cancelOp(): void;
  /** the picture as it was when beginOp() was called (for previews), or null */
  opBefore(): R.Bitmap | null;
  /** an undoable change to the whole picture that keeps its size */
  wholeOp(fn: () => void): void;
  /** an undoable change that replaces the bitmap (size may change) */
  replaceOp(next: R.Bitmap): void;
  /** commit whatever the current tool holds (see Tool.flush) */
  flush(): void;

  // ── colours and options ──
  readonly st: {
    fg: R.Color;
    bg: R.Color;
    /** index into LINE_WIDTHS (Line, Curve and shape borders) */
    line: number;
    /** 0 outline, 1 outline + fill (paper), 2 fill only (ink) */
    fillStyle: number;
    /** selections and text: true = opaque, false = the background colour is see-through */
    opaque: boolean;
  };
  setFg(c: R.Color): void;
  setBg(c: R.Color): void;
  /** the current line width in pixels */
  lineWidth(): number;
  /** [outline, fill] for the current fill style */
  shapeColors(ink: R.Color, paper: R.Color): [R.Color | null, R.Color | null];
  /** the 28 colour-box colours ('#rrggbb'), and a way to change one (Edit Colors) */
  palette: { get(): string[]; set(index: number, hex: string): void };

  // ── tools ──
  addTool(tool: Tool): void;
  setTool(id: ToolId): void;
  currentTool(): ToolId;
  /** the tool used before Pick Color / Magnifier (they hand back to it) */
  previousTool(): ToolId;
  /** redraw the options box (after a tool changes its own options) */
  redrawOptions(): void;
  /** a grid of option buttons drawn with the pixel engine, as in the 98 options box */
  optionButtons(
    count: number,
    cols: number,
    w: number,
    h: number,
    current: number,
    label: (i: number) => string,
    draw: (i: number, b: R.Bitmap, ink: R.Color) => void,
    pick: (i: number) => void,
  ): HTMLElement;
  selection: Selection | null;

  // ── view ──
  /** screen magnification of the picture: 1 (normal), 2, 4, 6, 8 */
  zoom(): number;
  /** set the magnification; keep `center` (a picture point) in view if given */
  setZoom(z: number, center?: Pt): void;
  /** called after the zoom changes and after the picture is replaced or resized */
  onLayout(fn: () => void): void;
  /** a pointer position (clientX/Y) to a picture pixel */
  toPixel(e: { clientX: number; clientY: number }): Pt;
  /** position an overlay child over a picture box (inclusive pixel bounds) */
  place(el: HTMLElement, box: R.Box): void;

  // ── menus, status, dialogs, files ──
  /** handle a menu action (from Paint.astro's menus) or a shortcut */
  onMenu(action: string, fn: () => void): void;
  /** set a menu item's tick (menuitemcheckbox) */
  setChecked(action: string, on: boolean): void;
  status: { help(text: string): void; size(text: string): void };
  dialog(heading: string, body: HTMLElement, buttons: DialogButton[]): Promise<{ value: string; form: HTMLFormElement }>;
  /** a div holding this HTML (escape any text with escapeHtml) */
  el(html: string): HTMLElement;
  escapeHtml(s: string): string;
  /** ask for an image file; resolves to its bitmap (scaled to fit 2048), or null */
  pickImage(): Promise<R.Bitmap | null>;
  /** any canvas image source to a bitmap (white behind transparency, scaled to fit 2048) */
  bitmapFromSource(src: CanvasImageSource & { width: number; height: number }): Promise<R.Bitmap>;
  /** a bitmap to a PNG blob */
  toPng(b: R.Bitmap): Promise<Blob>;
  /** download a blob under a file name */
  download(file: string, blob: Blob): void;
}

// ── shared constants and helpers ──────────────────────────────────────

export const WHITE = R.rgb(255, 255, 255);
export const BLACK = R.rgb(0, 0, 0);
export const MAX_SIDE = 2048;
export const LINE_WIDTHS = [1, 2, 3, 4, 5];

export const hex = (c: R.Color) =>
  '#' +
  R.toRGB(c)
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
export const parseHex = (h: string) =>
  R.rgb(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
export const union = (a: R.Box | null, b: R.Box | null): R.Box | null =>
  !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
export const wholeBox = (bm: R.Bitmap): R.Box => ({ x0: 0, y0: 0, x1: bm.w - 1, y1: bm.h - 1 });
/** a box clipped to the picture, or null if nothing is left */
export const clipBox = (bm: R.Bitmap, b: R.Box): R.Box | null => {
  const c = { x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(bm.w - 1, b.x1), y1: Math.min(bm.h - 1, b.y1) };
  return c.x0 > c.x1 || c.y0 > c.y1 ? null : c;
};
/** an ImageData sharing the bitmap's memory */
export const imageOf = (b: R.Bitmap) =>
  new ImageData(new Uint8ClampedArray(b.data.buffer as ArrayBuffer, b.data.byteOffset, b.data.byteLength), b.w, b.h);
/** draw a bitmap into a canvas element (resizing it) */
export function paintCanvas(c: HTMLCanvasElement, b: R.Bitmap) {
  if (c.width !== b.w) c.width = b.w;
  if (c.height !== b.h) c.height = b.h;
  c.getContext('2d')!.putImageData(imageOf(b), 0, 0);
}
