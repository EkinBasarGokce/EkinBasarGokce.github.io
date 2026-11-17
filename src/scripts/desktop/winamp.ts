/**
 * Winamp, by way of Webamp (https://github.com/captbaritone/webamp, MIT): the
 * classic player with its main window, equalizer and playlist. The tracks come
 * from src/content/music.yaml (rendered into #winamp-tracks); Webamp's code
 * loads the first time it opens.
 *
 * Webamp draws its own windows. To make it behave like any other program here:
 * its #webamp layer is moved into the desktop, so it stacks with the other
 * windows (pressing it brings it to the front) and stays out of the taskbar;
 * the page zoom is undone for it (win98.css) because it does its own pointer
 * maths, and where the page is at 150% it uses its own double size; it gets a
 * taskbar button; on phones the Back button hides it.
 */
import type { WM } from './wm';

type TrackData = { url: string; title?: string; artist?: string; duration?: number };
type WebampInstance = {
  renderWhenReady(node: HTMLElement): Promise<void>;
  onClose(cb: () => void): () => void;
  onMinimize(cb: () => void): () => void;
  reopen(): void;
  close(): void;
  dispose(): void;
};

/** where the rest of the page is shown at 150% (keep in step with win98.css) */
const BIG = '(pointer: fine) and (min-width: 1000px) and (min-height: 640px)';

export function initWinamp(wm: WM) {
  const data = document.getElementById('winamp-tracks');
  if (!data) return;
  let tracks: TrackData[] = [];
  try {
    tracks = JSON.parse(data.textContent || '[]');
  } catch {}
  const icon = data.dataset.taskIcon ?? '';
  const big = matchMedia(BIG);

  let webamp: WebampInstance | null = null;
  let anchor: HTMLElement | null = null;
  let loading = false;
  let state: 'closed' | 'open' | 'hidden' = 'closed';
  let pushed = false; // a phone-style history entry for Back
  const root = () => document.getElementById('webamp');
  const alive = () => !!root()?.querySelector('#main-window, #playlist-window, #equalizer-window');

  const activate = () => {
    const el = root();
    if (el) el.style.zIndex = String(wm.bump());
    wm.activateExternal('winamp');
  };
  const show = () => {
    const el = root();
    if (el) el.style.display = '';
    state = 'open';
    activate();
    if (wm.compact.matches && !pushed) {
      history.pushState({ win: 'winamp' }, '', '#winamp');
      pushed = true;
    }
  };
  const hide = (fromBack = false) => {
    const el = root();
    if (el) el.style.display = 'none';
    state = 'hidden';
    wm.setTaskPressed('winamp', false);
    if (pushed) {
      pushed = false;
      if (!fromBack) wm.backSilently();
    }
  };
  const clearHash = () => {
    if (location.hash === '#winamp') history.replaceState(history.state, '', location.pathname + location.search);
  };
  const addTask = () =>
    wm.addExternalTask('winamp', 'Winamp', icon, () => {
      if (state === 'open' && wm.isExternalActive('winamp')) hide();
      else if (webamp && alive()) show();
      else void launch();
    });

  async function create() {
    const { default: Webamp } = await import('webamp');
    if (!Webamp.browserIsSupported()) return null;
    const doubled = big.matches;
    // equalizer starts closed, docked under the playlist so it never covers the main window
    const layout = doubled
      ? {
          main: { position: { top: 0, left: 0 } },
          playlist: { position: { top: 232, left: 0 }, size: { extraWidth: 11, extraHeight: 4 } },
          equalizer: { position: { top: 464, left: 0 }, closed: true },
        }
      : {
          main: { position: { top: 0, left: 0 } },
          playlist: { position: { top: 116, left: 0 }, size: { extraWidth: 0, extraHeight: 2 } },
          equalizer: { position: { top: 290, left: 0 }, closed: true },
        };
    const instance = new Webamp({
      initialTracks: tracks.map((t) => ({
        url: t.url,
        duration: t.duration,
        metaData: { title: t.title ?? '', artist: t.artist ?? '' },
      })),
      windowLayout: layout,
      enableDoubleSizeMode: doubled,
      enableHotkeys: false,
      zIndex: 1,
    }) as unknown as WebampInstance;
    instance.onClose(() => {
      state = 'closed';
      wm.removeTask('winamp');
      if (pushed) {
        pushed = false;
        wm.backSilently();
      }
      clearHash();
    });
    instance.onMinimize(() => hide());
    // Webamp mounts its React app INTO the node it is given (replacing what is
    // there) and centres its windows over it: give it an empty layer over the desk.
    anchor = document.createElement('div');
    anchor.className = 'winamp-anchor';
    anchor.setAttribute('aria-hidden', 'true');
    wm.desk.append(anchor);
    await instance.renderWhenReady(anchor);
    // move its windows' layer into the desktop, so it stacks with the windows
    const el = root();
    if (el) {
      wm.desk.append(el);
      el.addEventListener('pointerdown', activate, true);
      el.addEventListener('focusin', () => !wm.isExternalActive('winamp') && activate());
    }
    return instance;
  }

  function teardown() {
    // Webamp removes #webamp from the parent it created it in: put it back there first
    const el = root();
    if (el && el.parentElement !== document.body) document.body.append(el);
    try {
      webamp?.dispose();
    } catch {}
    webamp = null;
    root()?.remove();
    anchor?.remove();
    anchor = null;
    state = 'closed';
    wm.removeTask('winamp');
  }
  async function launch() {
    if (loading) return;
    loading = true;
    try {
      if (webamp && !alive()) teardown(); // every window was closed from inside: start over
      if (!webamp) webamp = await create();
      if (!webamp) return;
      addTask();
      show();
    } finally {
      loading = false;
    }
  }

  wm.external('winamp', {
    open: () => {
      if (webamp && state === 'closed' && alive()) {
        webamp.reopen();
        addTask();
        show();
      } else if (webamp && alive()) show();
      else void launch();
    },
    // Back on a phone hides Winamp when it was shown with a history entry
    back: () => {
      if (state !== 'open' || !pushed) return false;
      hide(true);
      return true;
    },
  });

  // the double size follows the page zoom: rebuild if the window crosses the line
  big.addEventListener('change', () => {
    if (!webamp) return;
    const wasOpen = state === 'open';
    teardown();
    if (wasOpen) void launch();
  });
}
