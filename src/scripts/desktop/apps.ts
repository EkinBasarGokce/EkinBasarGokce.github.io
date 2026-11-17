/** What happens inside each app window. Each app listens for its own menu actions. */
import type { WM } from './wm';
import { initWinamp } from './winamp';

export function initApps(wm: WM) {
  notepad();
  mail();
  media(wm);
  paint(wm);
  initWinamp(wm);
  datetime(wm);
  shutdown();
}

/* ── Paint: its code loads the first time the window opens ────── */
function paint(wm: WM) {
  if (!wm.has('paint')) return;
  wm.hook('paint', {
    onOpen: () => {
      import('./paint/paint').then((m) => m.openPaint(wm));
    },
  });
}

const onMenu = (el: HTMLElement, fn: (action: string) => void) =>
  el.addEventListener('menu', (e) => fn((e as CustomEvent<string>).detail));

/* ── Notepad (About) ──────────────────────────────────────────── */
function notepad() {
  const win = document.getElementById('about');
  const ta = win?.querySelector('textarea');
  if (!win || !ta) return;
  const insert = (text: string) => {
    ta.focus();
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
  };
  // "3:41 PM 11/17/2026", in the visitor's own format, as Notepad's F5 does
  const stamp = () => {
    const d = new Date();
    return `${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} ${d.toLocaleDateString()}`;
  };
  onMenu(win, async (action) => {
    const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    try {
      if (action === 'undo') {
        ta.focus();
        document.execCommand('undo');
      } else if (action === 'cut' && selected) {
        await navigator.clipboard.writeText(selected);
        insert('');
      } else if (action === 'copy' && selected) await navigator.clipboard.writeText(selected);
      else if (action === 'paste') insert(await navigator.clipboard.readText());
      else if (action === 'delete') insert('');
      else if (action === 'selectall') {
        ta.focus();
        ta.select();
      } else if (action === 'timedate') insert(stamp());
      else if (action === 'wrap') {
        const wrap = ta.getAttribute('wrap') === 'off';
        ta.setAttribute('wrap', wrap ? 'soft' : 'off');
        win.querySelector('[data-action="wrap"]')?.setAttribute('aria-checked', String(wrap));
      }
    } catch {
      // the browser refused the clipboard; nothing else to do
    }
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'F5') {
      e.preventDefault();
      insert(stamp());
    }
  });
}

/* ── Mail ─────────────────────────────────────────────────────── */
function mail() {
  const win = document.getElementById('mail');
  const form = win?.querySelector<HTMLFormElement>('[data-mail]');
  if (!win || !form) return;
  const to = form.elements.namedItem('to') as HTMLSelectElement;
  const subject = form.elements.namedItem('subject') as HTMLInputElement;
  const body = form.elements.namedItem('body') as HTMLTextAreaElement;
  const status = win.querySelector('[data-mail-status]')!;
  // put the addresses together here, so they are never whole in the HTML
  for (const o of to.options) {
    const { u, d, label } = o.dataset;
    if (u && d) o.textContent = `${label} <${u}@${d}>`;
  }
  const send = () => {
    const o = to.selectedOptions[0];
    if (!o?.dataset.u) return;
    const q = [
      subject.value && `subject=${encodeURIComponent(subject.value)}`,
      body.value && `body=${encodeURIComponent(body.value.replace(/\r?\n/g, '\r\n'))}`,
    ].filter(Boolean);
    location.href = `mailto:${o.dataset.u}@${o.dataset.d}${q.length ? `?${q.join('&')}` : ''}`;
    status.textContent = 'Opening your mail program...';
    setTimeout(() => (status.textContent = 'Ready'), 4000);
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  onMenu(win, (action) => action === 'send' && send());
  win.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      send();
    }
  });
}

/* ── Media Player (Eksi's videos) ─────────────────────────────── */
function media(wm: WM) {
  const win = document.getElementById('media');
  const screen = win?.querySelector<HTMLElement>('[data-screen]');
  if (!win || !screen) return;
  const poster = screen.querySelector<HTMLImageElement>('[data-poster]')!;
  const big = screen.querySelector<HTMLElement>('.bigplay')!;
  const now = win.querySelector<HTMLElement>('[data-now]')!;
  const opts = [...win.querySelectorAll<HTMLElement>('[role="option"]')];
  let i = 0;
  let frame: HTMLIFrameElement | null = null;

  const stop = () => {
    frame?.remove();
    frame = null;
    poster.hidden = false;
    big.hidden = false;
    now.textContent = opts[i].dataset.title ?? '';
  };
  const choose = (n: number, focus = false) => {
    stop();
    i = (n + opts.length) % opts.length;
    opts.forEach((o, k) => {
      o.setAttribute('aria-selected', String(k === i));
      o.tabIndex = k === i ? 0 : -1;
    });
    poster.src = opts[i].dataset.poster!;
    now.textContent = opts[i].dataset.title ?? '';
    if (focus) opts[i].focus();
  };
  const play = () => {
    if (frame) return;
    const o = opts[i];
    frame = document.createElement('iframe');
    frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(o.dataset.id!)}?autoplay=1&playsinline=1&rel=0`;
    frame.title = o.dataset.title ?? 'Video';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    poster.hidden = true;
    big.hidden = true;
    screen.append(frame);
    now.textContent = `Playing: ${o.dataset.title}`;
  };
  const act = (a: string) => {
    if (a === 'play') play();
    else if (a === 'stop') stop();
    else if (a === 'prev') choose(i - 1);
    else if (a === 'next') choose(i + 1);
  };

  win.querySelectorAll<HTMLElement>('[data-media]').forEach((b) => b.addEventListener('click', () => act(b.dataset.media!)));
  onMenu(win, act);
  opts.forEach((o, k) => {
    o.addEventListener('click', () => k !== i && choose(k));
    o.addEventListener('dblclick', () => {
      choose(k);
      play();
    });
    o.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        choose(i + (e.key === 'ArrowDown' ? 1 : -1), true);
      } else if (e.key === 'Enter') play();
    });
  });
  wm.hook('media', { onClose: stop });
}

/* ── Date/Time Properties ─────────────────────────────────────── */
function datetime(wm: WM) {
  const win = document.getElementById('datetime');
  if (!win) return;
  const month = win.querySelector<HTMLSelectElement>('[data-month]')!;
  const year = win.querySelector<HTMLInputElement>('[data-year]')!;
  const tbody = win.querySelector<HTMLElement>('[data-cal] tbody')!;
  const hands = {
    h: win.querySelector('[data-hand="h"]')!,
    m: win.querySelector('[data-hand="m"]')!,
    s: win.querySelector('[data-hand="s"]')!,
  };
  const time = win.querySelector<HTMLElement>('[data-time]')!;
  const apply = win.querySelector<HTMLButtonElement>('[data-dt="apply"]')!;
  let day = 1;
  let timer = 0;

  const render = () => {
    const y = Number(year.value);
    const m = Number(month.value);
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    day = Math.min(day, days);
    const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, k) => k + 1)];
    while (cells.length % 7) cells.push(null);
    tbody.replaceChildren(
      ...Array.from({ length: cells.length / 7 }, (_, r) => {
        const tr = document.createElement('tr');
        for (const d of cells.slice(r * 7, r * 7 + 7)) {
          const td = document.createElement('td');
          if (d) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = String(d);
            b.dataset.day = String(d);
            b.setAttribute('aria-pressed', String(d === day));
            td.append(b);
          }
          tr.append(td);
        }
        return tr;
      }),
    );
  };
  const changed = () => (apply.disabled = false);
  const tick = () => {
    const now = new Date();
    const s = now.getSeconds();
    const m = now.getMinutes() + s / 60;
    const h = (now.getHours() % 12) + m / 60;
    hands.h.setAttribute('transform', `rotate(${h * 30} 50 50)`);
    hands.m.setAttribute('transform', `rotate(${m * 6} 50 50)`);
    hands.s.setAttribute('transform', `rotate(${s * 6} 50 50)`);
    time.textContent = now.toLocaleTimeString();
    win.querySelector('[data-ist]')!.textContent = now.toLocaleTimeString(undefined, {
      timeZone: 'Europe/Istanbul',
      hour: 'numeric',
      minute: '2-digit',
    });
  };
  const offset = () => {
    const o = -new Date().getTimezoneOffset();
    const a = Math.abs(o);
    return `GMT${o >= 0 ? '+' : '-'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
  };
  const showTab = (k: number) => {
    win.querySelectorAll<HTMLElement>('[data-tab]').forEach((t, j) => {
      t.setAttribute('aria-selected', String(j === k));
      t.tabIndex = j === k ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')!)!.hidden = j !== k;
    });
  };

  tbody.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-day]');
    if (!b) return;
    day = Number(b.dataset.day);
    render();
    tbody.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus();
    changed();
  });
  month.addEventListener('change', () => (render(), changed()));
  year.addEventListener('change', () => {
    year.value = String(Math.min(2099, Math.max(1980, Number(year.value) || new Date().getFullYear())));
    render();
    changed();
  });
  win.querySelectorAll<HTMLElement>('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      year.value = String(Math.min(2099, Math.max(1980, Number(year.value) + Number(b.dataset.step))));
      render();
      changed();
    }),
  );
  win.querySelectorAll<HTMLElement>('[data-tab]').forEach((t, k) => {
    t.addEventListener('click', () => showTab(k));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = k === 0 ? 1 : 0;
      showTab(next);
      win.querySelectorAll<HTMLElement>('[data-tab]')[next].focus();
    });
  });
  win.querySelector('[data-dt="ok"]')!.addEventListener('click', () => void wm.requestClose('datetime'));
  win.querySelector('[data-dt="cancel"]')!.addEventListener('click', () => void wm.requestClose('datetime'));
  apply.addEventListener('click', () => (apply.disabled = true));

  wm.hook('datetime', {
    onOpen: () => {
      const now = new Date();
      month.value = String(now.getMonth());
      year.value = String(now.getFullYear());
      day = now.getDate();
      apply.disabled = true;
      showTab(0);
      render();
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      win.querySelector('[data-tzline]')!.textContent = `Current time zone: ${zone.replace(/_/g, ' ')}`;
      win.querySelector('[data-tz]')!.textContent = `(${offset()}) ${zone.replace(/_/g, ' ')}`;
      tick();
      timer = window.setInterval(tick, 1000);
    },
    onClose: () => clearInterval(timer),
  });
}

/* ── Shut Down ────────────────────────────────────────────────── */
function shutdown() {
  const dlg = document.getElementById('shutdown') as HTMLDialogElement | null;
  const off = document.querySelector<HTMLElement>('[data-off]');
  if (!dlg || !off) return;
  const form = dlg.querySelector<HTMLFormElement>('[data-shutdown-form]')!;
  document.addEventListener('menu', (e) => {
    if ((e as CustomEvent<string>).detail === 'shutdown') dlg.showModal();
  });
  dlg.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const what = (form.elements.namedItem('what') as RadioNodeList).value;
    dlg.close();
    off.hidden = false;
    off.focus();
    if (what === 'restart') {
      off.querySelector('[data-off-text]')!.textContent = '';
      setTimeout(() => location.replace(location.pathname), 1200);
      return;
    }
    // the classic black screen, then back to the website
    const home = () => location.assign('/');
    setTimeout(home, 4000);
    off.addEventListener('click', home);
    off.addEventListener('keydown', home);
  });
}
