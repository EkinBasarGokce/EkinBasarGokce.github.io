/**
 * Menus, as in 98: a menu bar opens on press and follows the pointer along the
 * bar while open; arrow keys walk the items; Esc backs out; submenus open to
 * the side. Choosing an item sends a `menu` event (detail = its action) that
 * bubbles up to the window, or to the Start menu.
 */

/** the items directly in one menu list */
const itemsOf = (list: Element) =>
  [...list.children].map((li) => li.querySelector<HTMLElement>(':scope > .mi')).filter((x): x is HTMLElement => !!x);

const topButtons = (bar: Element) => [...bar.querySelectorAll<HTMLElement>(':scope > .mb > .mb-btn')];

export function initMenus() {
  let open: HTMLElement | null = null; // the .mb whose drop-down is showing
  let returnTo: HTMLElement | null = null; // what had the keyboard when it opened

  const close = (focusButton = false) => {
    if (!open) return;
    const btn = open.querySelector<HTMLElement>(':scope > .mb-btn')!;
    open.removeAttribute('data-open');
    open.querySelectorAll('[data-sub-open]').forEach((x) => x.removeAttribute('data-sub-open'));
    btn.setAttribute('aria-expanded', 'false');
    const back = returnTo;
    open = null;
    returnTo = null;
    if (!focusButton) return;
    // back to the text or picture the menu was opened from, else the menu title
    if (back && back !== btn && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
    else btn.focus();
  };
  const show = (mb: HTMLElement, focusFirst = false) => {
    if (open && open !== mb) close();
    if (!open) returnTo = document.activeElement as HTMLElement | null;
    open = mb;
    mb.setAttribute('data-open', '');
    mb.querySelector(':scope > .mb-btn')!.setAttribute('aria-expanded', 'true');
    if (focusFirst) itemsOf(mb.querySelector(':scope > .menu')!)[0]?.focus();
  };

  document.addEventListener(
    'pointerdown',
    (e) => {
      const t = e.target as HTMLElement;
      const btn = t.closest<HTMLElement>('.mb-btn');
      if (btn) {
        e.preventDefault(); // keep the caret where it was (Notepad)
        const mb = btn.parentElement!;
        if (open === mb) close();
        else show(mb);
        return;
      }
      // a mouse press on a menu item doesn't move the keyboard either
      if (e.pointerType === 'mouse' && t.closest('.mi')) e.preventDefault();
      if (open && !open.contains(t)) {
        // as in 98, a press outside an open menu only closes it
        close();
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );

  // while one menu is open, pointing at another title on the same bar opens that one
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return; // a finger "hovers" as it taps; let the tap decide
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.mb-btn');
    if (btn && open && open !== btn.parentElement && open.parentElement === btn.parentElement!.parentElement) {
      show(btn.parentElement!);
    }
  });

  document.addEventListener('click', (e) => {
    const mi = (e.target as HTMLElement).closest<HTMLElement>('.mi');
    if (!mi) return;
    if (mi.getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      return;
    }
    if (mi.hasAttribute('aria-haspopup')) {
      // a submenu: tapping opens it (pointing at it already does)
      e.preventDefault();
      const li = mi.parentElement!;
      li.parentElement!.querySelectorAll(':scope > [data-sub-open]').forEach((x) => x !== li && x.removeAttribute('data-sub-open'));
      li.toggleAttribute('data-sub-open');
      return;
    }
    const popover = mi.closest<HTMLElement>('[popover]');
    // the menu is about to hide: keep keyboard focus in its window, not on a hidden item
    const owner = mi.closest<HTMLElement>('[data-window]');
    if (owner && mi.contains(document.activeElement)) owner.focus({ preventScroll: true });
    close();
    try {
      popover?.hidePopover();
    } catch {}
    const action = mi.dataset.action;
    if (action) mi.dispatchEvent(new CustomEvent('menu', { detail: action, bubbles: true }));
  });

  // A menu opened with the mouse leaves focus where it was (a text box, the
  // picture): Esc still closes it and the arrows step into it, before anything
  // else sees those keys.
  document.addEventListener(
    'keydown',
    (e) => {
      if (!open || open.contains(e.target as Node)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        returnTo = null; // the keyboard never left; leave it there
        close();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const items = itemsOf(open.querySelector(':scope > .menu')!);
        (e.key === 'ArrowDown' ? items[0] : items.at(-1))?.focus();
      }
    },
    true,
  );

  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;

    // on a menu bar title
    if (t.matches('.mb-btn')) {
      const bar = t.closest('[data-menubar]')!;
      const tops = topButtons(bar);
      const i = tops.indexOf(t);
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        show(t.parentElement!, true);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        tops[(i + (e.key === 'ArrowRight' ? 1 : -1) + tops.length) % tops.length].focus();
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        close(true);
      }
      return;
    }

    // inside a menu
    if (!t.matches('.mi')) return;
    const list = t.closest('[role="menu"]')!;
    const items = itemsOf(list);
    const i = items.indexOf(t);
    const parentItem = list.parentElement?.matches('.mi-li') ? list.parentElement.querySelector<HTMLElement>(':scope > .mi') : null;
    const bar = t.closest('[data-menubar]');
    const popover = t.closest<HTMLElement>('[popover]');
    const stepTop = (dir: 1 | -1) => {
      if (!bar || !open) return;
      const tops = topButtons(bar);
      const next = tops[(tops.indexOf(open.querySelector<HTMLElement>(':scope > .mb-btn')!) + dir + tops.length) % tops.length];
      show(next.parentElement!, true);
    };

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        items[(i + step + items.length) % items.length]?.focus();
        break;
      }
      case 'Home':
      case 'End':
        e.preventDefault();
        (e.key === 'Home' ? items[0] : items.at(-1))?.focus();
        break;
      case 'ArrowRight': {
        e.preventDefault();
        const sub = t.parentElement!.querySelector(':scope > [role="menu"]');
        if (sub) itemsOf(sub)[0]?.focus();
        else stepTop(1);
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const sub = t.parentElement!.querySelector(':scope > [role="menu"]');
        if (sub) itemsOf(sub)[0]?.focus();
        else t.click();
        break;
      }
      case 'ArrowLeft':
        e.preventDefault();
        if (parentItem) parentItem.focus();
        else stepTop(-1);
        break;
      case 'Escape':
        e.preventDefault();
        if (parentItem) parentItem.focus();
        else if (bar) close(true);
        else if (popover) {
          popover.hidePopover();
          document.querySelector<HTMLElement>(`[popovertarget="${popover.id}"]`)?.focus();
        }
        break;
    }
  });
}
