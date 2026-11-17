/** The Desktop page's script: windows, menus, the desktop, then the apps. */
import { WM } from './wm';
import { initMenus } from './menus';
import { initDesktop } from './desktop';
import { initApps } from './apps';

const wm = new WM();
initMenus();
initDesktop(wm);
initApps(wm);
wm.openFromHash();
