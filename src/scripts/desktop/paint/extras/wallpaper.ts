/**
 * File > Set As Wallpaper (Tiled) / (Centered): the picture becomes the
 * desktop's wallpaper (scripts/desktop/wallpaper.ts does the desktop side).
 */
import type { Core } from '../core';
import { setWallpaper, type WallpaperMode } from '../../wallpaper';

export function install(core: Core) {
  let busy = false;
  async function set(mode: WallpaperMode) {
    if (busy) return;
    busy = true;
    core.flush(); // a floating selection or text belongs in the picture first
    try {
      const kept = await setWallpaper(await core.toPng(core.bm()), mode);
      core.status.help(
        kept ? 'The picture is now the desktop wallpaper.' : 'The picture is the desktop wallpaper for this visit (it is too large for this browser to keep).',
      );
    } catch {
      await core.dialog('Paint', core.el('<p class="pt-ask">Paint could not make this picture the wallpaper.</p>'), [{ label: 'OK', value: 'ok', primary: true }]);
    } finally {
      busy = false;
    }
  }
  core.onMenu('wallpaper-tile', () => void set('tile'));
  core.onMenu('wallpaper-center', () => void set('center'));
}
