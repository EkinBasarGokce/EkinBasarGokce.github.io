/**
 * The desktop itself: icons (select on press, open on double-click, or on a
 * single tap with a finger or Enter on the keyboard; drag them anywhere), the
 * right-click menu, the Start menu and the clock in the corner of the taskbar.
 */
import { type WM, zoom, px, clamp } from './wm';
import { applySavedWallpaper, resetWallpaper, hasCustomWallpaper } from './wallpaper';

export function initDesktop(wm: WM) {
  void applySavedWallpaper(); // a picture the visitor set from Paint (File > Set As Wallpaper)
  icons(wm);
  startMenu(wm);
  clock(wm);
}

/** a place on the desktop's invisible grid: [column, row] */
type Cell = [number, number];
const cellKey = (c: Cell) => `${c[0]},${c[1]}`;

function icons(wm: WM) {
  const list = document.querySelector<HTMLElement>('.icons')!;
  const all = [...list.querySelectorAll<HTMLAnchorElement>('[data-icon]')];
  const item = (a: HTMLElement) => a.parentElement as HTMLElement;
  let pointer = 'mouse';
  let justDragged = false; // swallows the click that ends a drag
  let dragged = false; // and the double-click that may follow it

  const select = (a: HTMLElement | null) => all.forEach((i) => i.toggleAttribute('data-selected', i === a));
  const activate = (a: HTMLAnchorElement) => {
    if (a.dataset.open) wm.open(a.dataset.open, a);
    else if (a.target === '_blank') window.open(a.href, '_blank', 'noopener');
    else location.href = a.href;
  };

  // ── Where the icons sit ──────────────────────────────────────────
  // Icons snap to an invisible grid: down the left in columns on a computer,
  // in rows on a phone (the same layout the CSS grid shows before this runs).
  // A visitor's arrangement is kept in their browser, one per layout.
  const narrow = () => wm.compact.matches;
  const storeKey = () => `desktop-icons:${narrow() ? 'narrow' : 'wide'}`;
  const load = (): Record<string, Cell> => {
    try {
      const v = JSON.parse(localStorage.getItem(storeKey()) ?? '{}');
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  };
  const save = (v: Record<string, Cell> | null) => {
    try {
      if (v) localStorage.setItem(storeKey(), JSON.stringify(v));
      else localStorage.removeItem(storeKey());
    } catch {
      // storage blocked: the arrangement lasts until the page closes
    }
  };
  const grid = () => {
    const cell = parseFloat(getComputedStyle(list).getPropertyValue('--cell')) || 75;
    const [x0, y0] = narrow() ? [4, 6] : [2, 2];
    // the exact size, as the CSS grid sees it (clientWidth/Height are rounded)
    const s = getComputedStyle(wm.desk);
    const W = parseFloat(s.width) || wm.desk.clientWidth;
    const H = parseFloat(s.height) || wm.desk.clientHeight;
    return {
      cell,
      x0,
      y0,
      cols: Math.max(1, Math.floor((W - 2 * x0) / cell + 1e-6)),
      rows: Math.max(1, Math.floor((H - 2 * y0) / cell + 1e-6)),
    };
  };
  type Grid = ReturnType<typeof grid>;
  const inside = (c: Cell, g: Grid) =>
    Number.isInteger(c[0]) && Number.isInteger(c[1]) && c[0] >= 0 && c[1] >= 0 && c[0] < g.cols && c[1] < g.rows;
  /** the n-th cell in reading order: down then across (computer), across then down (phone) */
  const flowCell = (n: number, g: Grid): Cell =>
    narrow() ? [n % g.cols, Math.floor(n / g.cols)] : [Math.floor(n / g.rows), n % g.rows];
  const nearestFree = (want: Cell, g: Grid, taken: Set<string>): Cell => {
    let best: Cell | null = null;
    let bestD = Infinity;
    for (let c = 0; c < g.cols; c++)
      for (let r = 0; r < g.rows; r++) {
        if (taken.has(cellKey([c, r]))) continue;
        const d = (c - want[0]) ** 2 + (r - want[1]) ** 2;
        if (d < bestD) [best, bestD] = [[c, r], d];
      }
    return best ?? want;
  };

  /** the visitor's arrangement (saved), and where each icon is right now */
  let prefs = load();
  let now: Record<string, Cell> = {};

  const place = (a: HTMLElement, c: Cell, g: Grid) => {
    const li = item(a);
    li.style.left = px(g.x0 + c[0] * g.cell);
    li.style.top = px(g.y0 + c[1] * g.cell);
  };
  const layout = () => {
    const g = grid();
    const taken = new Set<string>();
    const next: Record<string, Cell> = {};
    // icons the visitor placed keep their spot while it is on screen and free...
    for (const a of all) {
      const id = a.dataset.icon!;
      const c = prefs[id];
      if (Array.isArray(c) && inside(c, g) && !taken.has(cellKey(c))) {
        next[id] = c;
        taken.add(cellKey(c));
      }
    }
    // ...the rest take the next free places in order
    let n = 0;
    for (const a of all) {
      const id = a.dataset.icon!;
      if (next[id]) continue;
      let c = flowCell(n, g);
      while (inside(c, g) && taken.has(cellKey(c))) c = flowCell(++n, g);
      if (!inside(c, g)) c = nearestFree(c, g, taken);
      next[id] = c;
      taken.add(cellKey(c));
      n++;
    }
    now = next;
    for (const a of all) place(a, now[a.dataset.icon!], g);
    list.classList.add('free');
  };
  const drop = (a: HTMLElement) => {
    const g = grid();
    const li = item(a);
    const id = a.dataset.icon!;
    const want: Cell = [
      clamp(Math.round((li.offsetLeft - g.x0) / g.cell), 0, g.cols - 1),
      clamp(Math.round((li.offsetTop - g.y0) / g.cell), 0, g.rows - 1),
    ];
    const taken = new Set(
      Object.entries(now)
        .filter(([k]) => k !== id)
        .map(([, c]) => cellKey(c)),
    );
    const c = taken.has(cellKey(want)) ? nearestFree(want, g, taken) : want;
    now = { ...now, [id]: c };
    place(a, c, g);
    // save where everything is now, except icons pushed aside only because
    // their saved place is off this (smaller) screen: they keep that place
    prefs = Object.fromEntries(
      all.map((b) => {
        const k = b.dataset.icon!;
        const p = prefs[k];
        return [k, k !== id && Array.isArray(p) && !inside(p, g) ? p : now[k]];
      }),
    );
    save(prefs);
  };

  layout();
  let raf = 0;
  addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(layout);
  });
  wm.compact.addEventListener('change', () => {
    prefs = load();
    layout();
  });

  // ── Pressing, dragging and opening ───────────────────────────────
  for (const a of all) {
    a.addEventListener('pointerdown', (e) => {
      pointer = e.pointerType;
      justDragged = false;
      dragged = false;
      select(a);
      if (e.button !== 0) return;
      const li = item(a);
      const z = zoom();
      const sx = e.clientX;
      const sy = e.clientY;
      const ox = li.offsetLeft;
      const oy = li.offsetTop;
      let moving = false;
      a.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent) => {
        const dx = m.clientX - sx;
        const dy = m.clientY - sy;
        if (!moving) {
          // a small wobble is still a click; a finger needs a little more room
          if (Math.hypot(dx, dy) < (m.pointerType === 'mouse' ? 4 : 10)) return;
          moving = true;
          li.classList.add('dragging');
          li.style.zIndex = '2147483000'; // above every window while it moves
        }
        li.style.left = px(clamp(ox + dx / z, 0, wm.desk.clientWidth - li.offsetWidth));
        li.style.top = px(clamp(oy + dy / z, 0, wm.desk.clientHeight - li.offsetHeight));
      };
      const end = (u: PointerEvent) => {
        a.removeEventListener('pointermove', move);
        a.removeEventListener('pointerup', end);
        a.removeEventListener('pointercancel', end);
        if (!moving) return;
        li.classList.remove('dragging');
        li.style.zIndex = '';
        justDragged = true;
        dragged = true;
        if (u.type === 'pointercancel') layout(); // put it back
        else drop(a);
      };
      a.addEventListener('pointermove', move);
      a.addEventListener('pointerup', end);
      a.addEventListener('pointercancel', end);
    });
    a.addEventListener('focus', () => select(a));
    a.addEventListener('click', (e) => {
      if (justDragged) {
        // the end of a drag is not a click
        justDragged = false;
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // let the browser open it in a new tab
      e.preventDefault();
      // a mouse needs a double-click; a finger, a pen or the Enter key need one
      if (e.detail === 0 || pointer !== 'mouse') activate(a);
    });
    a.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (pointer === 'mouse' && !dragged) activate(a);
    });
    a.addEventListener('keydown', (e) => {
      const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
      if (!dir) return;
      e.preventDefault();
      // the nearest icon in that direction, preferring the same row or column
      const r = a.getBoundingClientRect();
      let best: HTMLAnchorElement | null = null;
      let bestScore = Infinity;
      for (const b of all) {
        if (b === a) continue;
        const q = b.getBoundingClientRect();
        const dx = q.left - r.left;
        const dy = q.top - r.top;
        const along = dx * dir[0] + dy * dir[1];
        if (along <= 0) continue;
        const score = along + 2 * Math.abs(dx * dir[1] + dy * dir[0]);
        if (score < bestScore) [best, bestScore] = [b, score];
      }
      best?.focus();
    });
  }

  // pressing on the empty desktop clears the selection and deactivates windows
  const isBackground = (t: HTMLElement) => t === wm.desk || t.matches('.icons, .icons > li, .wallpaper, .wallpaper *');
  wm.desk.addEventListener('pointerdown', (e) => {
    if (isBackground(e.target as HTMLElement)) {
      select(null);
      wm.deactivate();
    }
  });

  // ── Right-click on the empty desktop ─────────────────────────────
  const menu = document.getElementById('desk-menu');
  if (!menu) return;
  const openMenuAt = (clientX: number, clientY: number, focus: boolean) => {
    const z = zoom();
    menu.querySelector('[data-action="wallpaper"]')?.setAttribute('aria-disabled', String(!hasCustomWallpaper()));
    if (!menu.matches(':popover-open')) menu.showPopover();
    menu.style.left = px(Math.max(0, Math.min(clientX / z, innerWidth / z - menu.offsetWidth - 2)));
    menu.style.top = px(Math.max(0, Math.min(clientY / z, innerHeight / z - menu.offsetHeight - 2)));
    if (focus) menu.querySelector<HTMLElement>('.mi')?.focus({ preventScroll: true }); // arrows, Enter and Esc work at once
  };
  wm.desk.addEventListener('contextmenu', (e) => {
    if (!isBackground(e.target as HTMLElement)) return; // icons and windows keep the browser's own menu
    e.preventDefault();
    openMenuAt(e.clientX, e.clientY, true);
  });
  // Touch screens that send no contextmenu on a long press (iPhone): hold a
  // finger still, and the menu opens when it lifts (opening it under the
  // finger would let the lift close it, or tap an item).
  let hold = 0;
  let held = false;
  let holdAt: [number, number] = [0, 0];
  const cancelHold = () => {
    clearTimeout(hold);
    hold = 0;
    held = false;
  };
  wm.desk.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !isBackground(e.target as HTMLElement)) return;
    holdAt = [e.clientX, e.clientY];
    cancelHold();
    hold = window.setTimeout(() => {
      hold = 0;
      held = true;
    }, 600);
  });
  wm.desk.addEventListener('pointermove', (e) => {
    if ((hold || held) && Math.hypot(e.clientX - holdAt[0], e.clientY - holdAt[1]) > 10) cancelHold();
  });
  wm.desk.addEventListener('pointerup', () => {
    const open = held;
    cancelHold();
    if (open) window.setTimeout(() => openMenuAt(holdAt[0], holdAt[1], false), 80);
  });
  wm.desk.addEventListener('pointercancel', cancelHold);
  // a long press that the browser turns into a contextmenu already opened it
  menu.addEventListener('toggle', (e) => (e as ToggleEvent).newState === 'open' && cancelHold());
  menu.addEventListener('menu', (e) => {
    const action = (e as CustomEvent<string>).detail;
    if (action === 'arrange') {
      prefs = {};
      save(null);
      layout();
    } else if (action === 'refresh') location.reload();
    else if (action === 'wallpaper') resetWallpaper();
  });
}

function startMenu(wm: WM) {
  const button = document.querySelector<HTMLButtonElement>('[data-start]')!;
  const menu = document.getElementById('start-menu')!;
  let byKeyboard = false;
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') byKeyboard = true;
  });
  button.addEventListener('pointerdown', () => (byKeyboard = false));
  menu.addEventListener('toggle', (e) => {
    const isOpen = (e as ToggleEvent).newState === 'open';
    button.setAttribute('aria-expanded', String(isOpen));
    if (isOpen && byKeyboard) menu.querySelector<HTMLElement>('.mi')?.focus();
    if (!isOpen) menu.querySelectorAll('[data-sub-open]').forEach((x) => x.removeAttribute('data-sub-open'));
  });
  menu.addEventListener('menu', (e) => {
    const action = (e as CustomEvent<string>).detail;
    if (action.startsWith('open:')) wm.open(action.slice(5), button);
  });
}

function clock(wm: WM) {
  const button = document.querySelector<HTMLButtonElement>('[data-clock]')!;
  const time = button.querySelector('time')!;
  const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const fmtDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });
  let timer = 0;
  const tick = () => {
    const now = new Date();
    time.textContent = fmtTime.format(now);
    time.dateTime = now.toISOString();
    button.title = fmtDate.format(now);
    button.setAttribute('aria-label', `${fmtTime.format(now)}, ${fmtDate.format(now)}. Opens Date/Time Properties.`);
    clearTimeout(timer);
    timer = window.setTimeout(tick, 60_000 - (now.getTime() % 60_000) + 20); // on the minute
  };
  tick();
  document.addEventListener('visibilitychange', () => !document.hidden && tick());
  // a double-click opens Date/Time Properties, as in 98; so do Enter and a tap
  let pointer = 'mouse';
  button.addEventListener('pointerdown', (e) => (pointer = e.pointerType));
  button.addEventListener('dblclick', () => pointer === 'mouse' && wm.open('datetime', button));
  button.addEventListener('click', (e) => {
    if (e.detail === 0 || pointer !== 'mouse') wm.open('datetime', button);
  });
}
