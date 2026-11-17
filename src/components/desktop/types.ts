import type { IconName } from '../../lib/pixel';

/**
 * One entry in a menu (a window's menu bar or the Start menu).
 * Put `&` before the letter to underline, as in "&File" or "Sh&ut Down...".
 */
export interface MenuItem {
  label: string;
  /** sent to the window as a `menu` event with this detail */
  action?: string;
  /** opens that Desktop window */
  open?: string;
  /** or a link */
  href?: string;
  newTab?: boolean;
  /** shortcut shown on the right, e.g. "Ctrl+Z" */
  key?: string;
  /** a tick-able item; true or false sets its starting state */
  checked?: boolean;
  disabled?: boolean;
  icon?: IconName;
  /** a submenu */
  items?: MenuEntry[];
}
export type MenuEntry = MenuItem | 'sep';
export interface Menu {
  label: string;
  items: MenuEntry[];
}

/** "&File" -> ["", "F", "ile"] */
export function accel(label: string): [string, string, string] {
  const i = label.indexOf('&');
  return i < 0 ? [label, '', ''] : [label.slice(0, i), label[i + 1] ?? '', label.slice(i + 2)];
}
