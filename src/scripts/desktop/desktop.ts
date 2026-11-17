/**
 * The desktop itself: icons (select on press, open on double-click, or on a
 * single tap with a finger or Enter on the keyboard), the Start menu and the
 * clock in the corner of the taskbar.
 */
import type { WM } from './wm';

export function initDesktop(wm: WM) {
  icons(wm);
  startMenu(wm);
  clock(wm);
}

function icons(wm: WM) {
  const all = [...document.querySelectorAll<HTMLAnchorElement>('[data-icon]')];
  let pointer = 'mouse';
  const select = (a: HTMLElement | null) => all.forEach((i) => i.toggleAttribute('data-selected', i === a));
  const activate = (a: HTMLAnchorElement) => {
    if (a.dataset.open) wm.open(a.dataset.open, a);
    else if (a.target === '_blank') window.open(a.href, '_blank', 'noopener');
    else location.href = a.href;
  };

  for (const a of all) {
    a.addEventListener('pointerdown', (e) => {
      pointer = e.pointerType;
      select(a);
    });
    a.addEventListener('focus', () => select(a));
    a.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // let the browser open it in a new tab
      e.preventDefault();
      // a mouse needs a double-click; a finger, a pen or the Enter key need one
      if (e.detail === 0 || pointer !== 'mouse') activate(a);
    });
    a.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (pointer === 'mouse') activate(a);
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
  wm.desk.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (t === wm.desk || t.matches('.icons, .icons > li')) {
      select(null);
      wm.deactivate();
    }
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
