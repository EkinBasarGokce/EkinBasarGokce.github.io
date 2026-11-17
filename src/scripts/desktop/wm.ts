/**
 * The window manager: open, focus, drag, resize, minimise, maximise and close
 * the [data-window] elements on the Desktop page, and keep the taskbar in step.
 *
 * On phones (or any small screen) every window opens maximised, one on top of
 * the other, and the browser's Back button closes the top one.
 */

type Hooks = {
  onOpen?: () => void;
  onClose?: () => void;
  /** return false to keep the window open (e.g. "Save changes?") */
  beforeClose?: () => boolean | Promise<boolean>;
};

export const px = (n: number) => `${Math.round(n)}px`;
/** a pendingBack marker: step back over an entry, close nothing */
const SILENT = '\u0000silent';
export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * The page zoom set in win98.css (1, 1.25 or 1.5). Pointer events report
 * screen pixels; positions are set in page pixels, so pointer movement is
 * divided by this.
 */
export const zoom = () => parseFloat(getComputedStyle(document.body).zoom) || 1;

export class WM {
  readonly desk: HTMLElement;
  /** small screens: windows open maximised and Back closes them */
  readonly compact = matchMedia('(max-width: 40rem), (max-height: 28rem)');
  readonly coarse = matchMedia('(pointer: coarse)');

  private wins = new Map<string, HTMLElement>();
  private hooks = new Map<string, Hooks>();
  private returnTo = new Map<string, HTMLElement>();
  /** open windows, bottom to top */
  private order: string[] = [];
  private activeId: string | null = null;
  private z = 10;
  private cascade = 0;
  private pendingBack: string | null = null;
  private tasks: HTMLElement;
  /** programs that draw their own windows (Winamp) */
  private externals = new Map<string, { open: () => void; back?: () => boolean }>();
  private externalClicks = new Map<string, () => void>();
  private activeExternal: string | null = null;

  constructor() {
    this.desk = document.querySelector<HTMLElement>('[data-desktop]')!;
    this.tasks = document.querySelector<HTMLElement>('[data-tasks]')!;
    document.querySelectorAll<HTMLElement>('[data-window]').forEach((el) => {
      this.wins.set(el.id, el);
      this.wire(el);
    });

    this.tasks.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-task]');
      if (!b) return;
      const id = b.dataset.task!;
      if (b.hasAttribute('data-external')) return void this.externalClicks.get(id)?.();
      const el = this.wins.get(id)!;
      if (this.activeId === id && !el.hasAttribute('data-min')) this.minimize(id);
      else {
        const wasMin = el.hasAttribute('data-min');
        el.removeAttribute('data-min');
        this.keepInside();
        if (wasMin && this.compact.matches && history.state?.win !== id) history.pushState({ win: id }, '', `#${id}`);
        this.focus(id, true);
      }
    });
    addEventListener('popstate', () => void this.onPop());
    addEventListener('resize', () => this.keepInside());
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !this.activeId) return;
      if (this.wins.get(this.activeId)!.hasAttribute('data-dialog')) void this.requestClose(this.activeId);
    });
  }

  has(id: string) {
    return this.wins.has(id);
  }
  isOpen(id: string) {
    return !!this.wins.get(id)?.hasAttribute('data-open');
  }
  hook(id: string, h: Hooks) {
    this.hooks.set(id, { ...this.hooks.get(id), ...h });
  }

  /**
   * A program that draws its own windows: open(id) calls `open`; `back`, if
   * given, may handle the phone Back button (return true when it did).
   */
  external(id: string, handlers: { open: () => void; back?: () => boolean }) {
    this.externals.set(id, handlers);
  }
  /** the next stacking level, shared by our windows and external programs */
  bump() {
    return ++this.z;
  }
  /** an external program came to the front: no window of ours is active */
  activateExternal(id: string) {
    this.deactivate();
    this.activeExternal = id;
    this.setTaskPressed(id, true);
  }
  isExternalActive(id: string) {
    return this.activeExternal === id;
  }
  /** step back over a history entry without closing anything */
  backSilently() {
    this.pendingBack = SILENT;
    history.back();
  }

  /** A taskbar button for an external program; clicking it calls onClick. */
  addExternalTask(id: string, title: string, iconSrc: string, onClick: () => void) {
    this.removeTask(id);
    this.externalClicks.set(id, onClick);
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'task';
    b.dataset.task = id;
    b.setAttribute('data-external', '');
    b.title = title;
    b.setAttribute('aria-pressed', 'true');
    const icon = document.createElement('img');
    icon.src = iconSrc;
    icon.width = 16;
    icon.height = 16;
    icon.alt = '';
    const label = document.createElement('span');
    label.textContent = title;
    b.append(icon, label);
    li.append(b);
    this.tasks.append(li);
  }
  removeTask(id: string) {
    this.tasks.querySelector(`[data-task="${id}"]`)?.parentElement?.remove();
    this.externalClicks.delete(id);
  }
  setTaskPressed(id: string, pressed: boolean) {
    this.tasks.querySelector(`[data-task="${id}"]`)?.setAttribute('aria-pressed', String(pressed));
  }

  /** Open a window, or bring it back if it is already open. */
  open(id: string, from?: HTMLElement | null, opts: { initial?: boolean } = {}) {
    const el = this.wins.get(id);
    if (!el) {
      this.externals.get(id)?.open();
      return;
    }
    if (from) this.returnTo.set(id, from);
    if (el.hasAttribute('data-open')) {
      const wasMin = el.hasAttribute('data-min');
      el.removeAttribute('data-min');
      this.keepInside();
      if (wasMin && this.compact.matches && history.state?.win !== id) history.pushState({ win: id }, '', `#${id}`);
      this.focus(id, true);
      return;
    }
    el.setAttribute('data-open', '');
    this.place(el);
    this.order.push(id);
    this.addTask(el);
    if (this.compact.matches) {
      // Back closes it; a window opened from the address has no entry of its own
      if (opts.initial) history.replaceState(null, '', `#${id}`);
      else history.pushState({ win: id }, '', `#${id}`);
    }
    this.focus(id, true);
    this.hooks.get(id)?.onOpen?.();
  }

  /** Bring a window to the front and make it the active one. */
  focus(id: string, moveFocus = false) {
    const el = this.wins.get(id)!;
    if (this.activeExternal) {
      this.setTaskPressed(this.activeExternal, false);
      this.activeExternal = null;
    }
    el.style.zIndex = String(++this.z);
    this.order = this.order.filter((x) => x !== id).concat(id);
    this.activeId = id;
    for (const [wid, w] of this.wins) w.toggleAttribute('data-active', wid === id);
    this.syncTasks();
    this.syncHash();
    if (moveFocus && !el.contains(document.activeElement)) {
      const first = this.coarse.matches ? null : el.querySelector<HTMLElement>('[data-autofocus]');
      (first ?? el).focus({ preventScroll: true });
    }
  }

  /** Click on the empty desktop: no window is active. */
  deactivate() {
    if (this.activeExternal) {
      this.setTaskPressed(this.activeExternal, false);
      this.activeExternal = null;
    }
    this.activeId = null;
    for (const w of this.wins.values()) w.removeAttribute('data-active');
    this.syncTasks();
  }

  minimize(id: string) {
    const el = this.wins.get(id)!;
    const hadFocus = el.contains(document.activeElement);
    // on a phone its Back entry goes with it, so Back never does nothing
    if (history.state?.win === id) this.backSilently();
    el.setAttribute('data-min', '');
    el.removeAttribute('data-active');
    const next = this.top();
    if (next) this.focus(next, hadFocus);
    else {
      this.activeId = null;
      this.syncTasks();
      this.syncHash();
      if (hadFocus) this.tasks.querySelector<HTMLElement>(`[data-task="${id}"]`)?.focus();
    }
  }

  toggleMax(id: string) {
    const el = this.wins.get(id)!;
    if (this.compact.matches || !el.hasAttribute('data-resizable')) return;
    const max = !el.hasAttribute('data-max');
    el.toggleAttribute('data-max', max);
    if (!max && !el.style.width) this.place(el);
    el.querySelector('[data-act="max"]')?.setAttribute('aria-label', max ? 'Restore' : 'Maximize');
  }

  /** Close, after asking the app (it may say no, e.g. unsaved changes). */
  async requestClose(id: string) {
    const el = this.wins.get(id);
    if (!el?.hasAttribute('data-open')) return;
    const before = this.hooks.get(id)?.beforeClose;
    if (before && !(await before())) return;
    if (history.state?.win === id) {
      // opened with a history entry: step back over it, then close
      this.pendingBack = id;
      history.back();
      return;
    }
    this.finishClose(id);
  }

  /** Open the window named in the address, e.g. /desktop/#mail. */
  openFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && (this.wins.has(id) || this.externals.has(id))) this.open(id, null, { initial: true });
  }

  setTitle(id: string, text: string) {
    const el = this.wins.get(id);
    if (!el) return;
    el.querySelector('.title h2')!.textContent = text;
    const task = this.tasks.querySelector<HTMLElement>(`[data-task="${id}"]`);
    if (task) {
      task.title = text;
      task.querySelector('span')!.textContent = text;
    }
  }

  // ── internals ────────────────────────────────────────────────

  private top(): string | null {
    for (let i = this.order.length - 1; i >= 0; i--) {
      if (!this.wins.get(this.order[i])!.hasAttribute('data-min')) return this.order[i];
    }
    return null;
  }

  private async onPop() {
    if (this.pendingBack) {
      const id = this.pendingBack;
      this.pendingBack = null;
      if (id !== SILENT) this.finishClose(id);
      return;
    }
    // the visitor pressed Back: an external program may take it (Winamp hides)...
    for (const ext of this.externals.values()) if (ext.back?.()) return;
    // ...otherwise close the window on top
    const top = this.top();
    if (!top) return;
    const before = this.hooks.get(top)?.beforeClose;
    if (before && !(await before())) {
      history.pushState({ win: top }, '', `#${top}`);
      return;
    }
    this.finishClose(top);
  }

  private finishClose(id: string) {
    const el = this.wins.get(id)!;
    const hadFocus = el.contains(document.activeElement);
    el.removeAttribute('data-open');
    el.removeAttribute('data-min');
    el.removeAttribute('data-max');
    el.removeAttribute('data-active');
    el.style.zIndex = '';
    this.order = this.order.filter((x) => x !== id);
    this.tasks.querySelector(`[data-task="${id}"]`)?.parentElement?.remove();
    this.hooks.get(id)?.onClose?.();
    const next = this.top();
    if (next) this.focus(next);
    else {
      this.activeId = null;
      this.syncTasks();
      this.syncHash();
    }
    if (hadFocus || document.activeElement === document.body) {
      const back = this.returnTo.get(id);
      (back?.isConnected ? back : next ? this.wins.get(next) : null)?.focus({ preventScroll: true });
    }
  }

  /** Size and position a window that is opening. */
  private place(el: HTMLElement) {
    // small screens: windows fill the screen; dialogs stay their own size, centred
    if (this.compact.matches && !el.hasAttribute('data-dialog')) {
      el.setAttribute('data-max', '');
      return;
    }
    const W = this.desk.clientWidth;
    const H = this.desk.clientHeight;
    const w = Math.min(Number(el.dataset.w), W - 8);
    el.style.width = px(w);
    if (el.dataset.h) el.style.height = px(Math.min(Number(el.dataset.h), H - 8));
    const h = el.offsetHeight;
    let x: number;
    let y: number;
    if (el.hasAttribute('data-dialog')) {
      x = (W - w) / 2;
      y = (H - h) / 2;
    } else {
      // cascade, like the real thing
      const k = this.cascade++ % 8;
      x = Math.min(110 + k * 26, W - w - 4);
      y = Math.min(24 + k * 26, H - h - 4);
    }
    el.style.left = px(Math.max(4, x));
    el.style.top = px(Math.max(4, y));
  }

  /** After the browser window changes size, keep every title bar reachable. */
  private keepInside() {
    const W = this.desk.clientWidth;
    const H = this.desk.clientHeight;
    for (const el of this.wins.values()) {
      if (!el.hasAttribute('data-open') || el.hasAttribute('data-min')) continue; // hidden: measured as 0x0
      if (this.compact.matches && !el.hasAttribute('data-dialog')) {
        el.setAttribute('data-max', '');
        continue;
      }
      if (el.hasAttribute('data-max')) continue;
      if (el.offsetWidth > W) el.style.width = px(W - 8);
      if (el.offsetHeight > H) el.style.height = px(H - 8);
      el.style.left = px(clamp(el.offsetLeft, 40 - el.offsetWidth, W - 40));
      el.style.top = px(clamp(el.offsetTop, 0, H - 24));
    }
  }

  private addTask(el: HTMLElement) {
    if (el.hasAttribute('data-notask')) return;
    const text = el.querySelector('.title h2')!.textContent ?? '';
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'task';
    b.dataset.task = el.id;
    b.title = text;
    const icon = el.querySelector('.title-icon')!.cloneNode() as HTMLImageElement;
    icon.removeAttribute('class');
    const label = document.createElement('span');
    label.textContent = text;
    b.append(icon, label);
    li.append(b);
    this.tasks.append(li);
  }

  private syncTasks() {
    this.tasks.querySelectorAll<HTMLElement>('[data-task]:not([data-external])').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.task === this.activeId));
    });
  }

  /** The address names the window on top, so it can be shared. */
  private syncHash() {
    if (history.state?.win) return; // a phone-style entry; Back owns the address
    const top = this.top();
    const want = top ? `#${top}` : '';
    if (location.hash !== want) history.replaceState(history.state, '', location.pathname + location.search + want);
  }

  private wire(el: HTMLElement) {
    const id = el.id;
    // any press inside a window brings it to the front, and keys follow it there
    el.addEventListener(
      'pointerdown',
      () => {
        if (this.activeId !== id) this.focus(id);
        if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
      },
      true,
    );
    el.addEventListener('focusin', () => this.activeId !== id && this.focus(id));

    el.querySelectorAll<HTMLElement>('.title [data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'close') void this.requestClose(id);
        else if (act === 'min') this.minimize(id);
        else if (act === 'max') this.toggleMax(id);
      }),
    );
    el.addEventListener('menu', (e) => {
      if ((e as CustomEvent<string>).detail === 'close') void this.requestClose(id);
    });

    // drag by the title bar; double-click it to maximise
    const title = el.querySelector<HTMLElement>('[data-drag]')!;
    title.addEventListener('dblclick', (e) => {
      if (!(e.target as HTMLElement).closest('.tb')) this.toggleMax(id);
    });
    title.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('.tb')) return;
      if (el.hasAttribute('data-max') || this.compact.matches) return;
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      const ox = el.offsetLeft;
      const oy = el.offsetTop;
      const W = this.desk.clientWidth;
      const H = this.desk.clientHeight;
      const w = el.offsetWidth;
      const z = zoom();
      title.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent) => {
        el.style.left = px(clamp(ox + (m.clientX - sx) / z, 40 - w, W - 40));
        el.style.top = px(clamp(oy + (m.clientY - sy) / z, 0, H - 24));
      };
      const end = () => {
        title.removeEventListener('pointermove', move);
        title.removeEventListener('pointerup', end);
        title.removeEventListener('pointercancel', end);
      };
      title.addEventListener('pointermove', move);
      title.addEventListener('pointerup', end);
      title.addEventListener('pointercancel', end);
    });

    el.querySelectorAll<HTMLElement>('[data-resize]').forEach((h) =>
      h.addEventListener('pointerdown', (e) => this.resize(el, h, e)),
    );
  }

  private resize(el: HTMLElement, handle: HTMLElement, e: PointerEvent) {
    if (e.button !== 0 || el.hasAttribute('data-max')) return;
    e.preventDefault();
    const dir = handle.dataset.resize!;
    const sx = e.clientX;
    const sy = e.clientY;
    const r = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    const minW = Number(el.dataset.minw ?? 220);
    const minH = Number(el.dataset.minh ?? 140);
    const W = this.desk.clientWidth;
    const H = this.desk.clientHeight;
    const z = zoom();
    handle.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - sx) / z;
      const dy = (m.clientY - sy) / z;
      let { x, y, w, h } = r;
      if (dir.includes('e')) w = clamp(r.w + dx, minW, W - r.x);
      if (dir.includes('s')) h = clamp(r.h + dy, minH, H - r.y);
      if (dir.includes('w')) {
        w = clamp(r.w - dx, minW, r.x + r.w);
        x = r.x + r.w - w;
      }
      if (dir.includes('n')) {
        h = clamp(r.h - dy, minH, r.y + r.h);
        y = r.y + r.h - h;
      }
      el.style.left = px(x);
      el.style.top = px(y);
      el.style.width = px(w);
      el.style.height = px(h);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
}
