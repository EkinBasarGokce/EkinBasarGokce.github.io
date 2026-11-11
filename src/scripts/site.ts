/**
 * Site behaviours. No libraries. Everything degrades to a plain, readable page.
 *   reveal on scroll, nav scrollspy, Off-the-clock lean, theme toggle,
 *   mobile menu, email assembly + copy, YouTube facades, photo lightbox.
 */
const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Reveal on scroll ──────────────────────────────────────────── */
function reveal() {
  document.querySelectorAll<HTMLElement>('[data-stagger]').forEach((list) => {
    Array.from(list.children).forEach((el, i) => (el as HTMLElement).style.setProperty('--i', String(i)));
  });
  const items = document.querySelectorAll<HTMLElement>('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0 },
  );
  items.forEach((el) => io.observe(el));
  // back/forward cache: show everything rather than replaying
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) items.forEach((el) => el.classList.add('in'));
  });
}

/* ── Header: hairline after scrolling, active section ──────────── */
function header() {
  const bar = document.querySelector<HTMLElement>('[data-header]');
  if (!bar) return;
  const onScroll = () => bar.toggleAttribute('data-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const links = new Map<string, HTMLAnchorElement>();
  document.querySelectorAll<HTMLAnchorElement>('[data-nav-link]').forEach((a) => links.set(a.dataset.navLink!, a));
  const sections = document.querySelectorAll<HTMLElement>('section[data-nav]');
  if (!links.size || !sections.length) return;

  const setActive = (id: string | null) => {
    links.forEach((a, key) => a.setAttribute('aria-current', String(key === id)));
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) setActive((e.target as HTMLElement).dataset.nav!);
    },
    { rootMargin: '-40% 0px -55% 0px' },
  );
  sections.forEach((s) => io.observe(s));
  // at the very bottom, the last section wins even if it is short
  window.addEventListener(
    'scroll',
    () => {
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
        setActive(sections[sections.length - 1].dataset.nav!);
      } else if (window.scrollY < 200) {
        setActive(null);
      }
    },
    { passive: true },
  );
}

/* ── Off the clock: chips follow the strand, the field leans ───── */
function strands() {
  const block = document.querySelector<HTMLElement>('[data-strands]');
  if (!block) return;
  const chips = new Map<string, HTMLAnchorElement>();
  block.querySelectorAll<HTMLAnchorElement>('[data-chip]').forEach((a) => chips.set(a.dataset.chip!, a));
  const arts = block.querySelectorAll<HTMLElement>('[data-strand]');

  const lean = (id: string | null, hue: string | null) => {
    chips.forEach((a, key) => a.setAttribute('aria-current', String(key === id)));
    if (hue) {
      root.dataset.lean = hue;
      root.style.setProperty('--lean-hue', `var(--${hue === 'ink' ? 'periwinkle' : hue})`);
    } else {
      delete root.dataset.lean;
      root.style.removeProperty('--lean-hue');
    }
    const chip = id ? chips.get(id) : null;
    if (chip && window.matchMedia('(max-width: 40rem)').matches) {
      chip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }
  };

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const el = e.target as HTMLElement;
          lean(el.dataset.strand!, el.dataset.hue ?? null);
        }
      }
    },
    { rootMargin: '-35% 0px -55% 0px' },
  );
  arts.forEach((a) => io.observe(a));

  // leaving the whole section turns the lean off
  new IntersectionObserver(
    ([e]) => {
      if (!e.isIntersecting) lean(null, null);
    },
    { threshold: 0 },
  ).observe(block);
}

/* ── Theme toggle ──────────────────────────────────────────────── */
function theme() {
  const dark = matchMedia('(prefers-color-scheme: dark)');
  document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const current = root.dataset.theme ?? (dark.matches ? 'dark' : 'light');
      const next = current === 'dark' ? 'light' : 'dark';
      // when the choice matches the system, forget it so the system leads again
      const system = dark.matches ? 'dark' : 'light';
      if (next === system) {
        delete root.dataset.theme;
        try { localStorage.removeItem('theme'); } catch {}
      } else {
        root.dataset.theme = next;
        try { localStorage.setItem('theme', next); } catch {}
      }
    });
  });
}

/* ── Mobile menu: close after choosing ─────────────────────────── */
function menu() {
  const m = document.getElementById('menu');
  if (!m) return;
  m.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => {
      try { (m as HTMLElement & { hidePopover(): void }).hidePopover(); } catch {}
    }),
  );
}

/* ── Email: assembled here so the address is not in the HTML ───── */
function emails() {
  document.querySelectorAll<HTMLElement>('[data-email]').forEach((row) => {
    const u = row.dataset.u;
    const d = row.dataset.d;
    if (!u || !d) return;
    const address = `${u}@${d}`;
    const link = row.querySelector<HTMLAnchorElement>('[data-email-link]');
    if (link) {
      link.href = `mailto:${address}`;
      link.textContent = address;
    }
    const copy = row.querySelector<HTMLButtonElement>('[data-copy]');
    copy?.removeAttribute('hidden');
    copy?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(address);
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy'), 1600);
      } catch {
        copy.textContent = 'Press Ctrl+C';
      }
    });
  });
}

/* ── YouTube: nothing loads from YouTube until play is pressed ─── */
function videos() {
  document.querySelectorAll<HTMLButtonElement>('[data-yt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.yt!;
      const start = btn.dataset.start ? `&start=${btn.dataset.start}` : '';
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&playsinline=1&rel=0${start}`;
      iframe.title = btn.dataset.title ?? 'YouTube video';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;
      iframe.className = 'yt-frame';
      btn.replaceWith(iframe);
      iframe.focus();
    });
  });
}

/* ── Lightbox: a native <dialog> ───────────────────────────────── */
function lightbox() {
  const dlg = document.querySelector<HTMLDialogElement>('[data-lightbox-dialog]');
  if (!dlg) return;
  const img = dlg.querySelector('img')!;
  const cap = dlg.querySelector('figcaption')!;
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-lightbox]'));
  let at = 0;

  const show = (i: number) => {
    at = (i + links.length) % links.length;
    const a = links[at];
    img.src = a.href;
    img.alt = a.dataset.alt ?? '';
    cap.textContent = a.dataset.caption ?? '';
  };
  links.forEach((a, i) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      show(i);
      dlg.showModal();
    }),
  );
  dlg.querySelector('[data-prev]')?.addEventListener('click', () => show(at - 1));
  dlg.querySelector('[data-next]')?.addEventListener('click', () => show(at + 1));
  dlg.querySelector('[data-close]')?.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(at - 1);
    if (e.key === 'ArrowRight') show(at + 1);
  });
  let x0: number | null = null;
  dlg.addEventListener('pointerdown', (e) => (x0 = e.clientX));
  dlg.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    if (Math.abs(dx) > 40) show(at + (dx < 0 ? 1 : -1));
    x0 = null;
  });
}

reveal();
header();
strands();
theme();
menu();
emails();
videos();
lightbox();
