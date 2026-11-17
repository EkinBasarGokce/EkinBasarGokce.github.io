# ekinbasargokce.github.io

Personal site of Ekin Başar Gökçe, built with [Astro](https://astro.build) and published to GitHub Pages by GitHub Actions on every push to `main`. No computer needs to stay on: GitHub builds it.

## Run it locally

Needs Node 22.23 or newer.

```sh
npm install
npm run dev      # live preview at http://localhost:4321
npm run build    # type-checks the content, then builds to dist/
npm run todo     # lists every placeholder still to fill in
```

## Where things live

| To change | Edit |
| --- | --- |
| Name, hero text, emails, social links, footer pages | `src/site.ts` |
| A job or research position | one file per entry in `src/content/experience/` |
| A degree | `src/content/education/` |
| A project | `src/content/projects/` |
| Tool chips | `src/content/tools.yaml` |
| Research text and interest chips | `src/content/sections/research.md` |
| A creative strand (Photography, Stage, Music, Video, Communities) | `src/content/strands/` |
| Photos | drop files in `src/assets/photos/`; captions and order in `src/content/photos.yaml` |
| YouTube videos | `src/content/videos.yaml` (the id is the part after `watch?v=`) |
| Instagram and other link cards | `src/content/cards.yaml` |
| Publications (hidden while empty) | `src/content/publications.yaml` |
| The Now page | `src/pages/now.md` |
| A note | one Markdown file in `src/content/notes/` |
| CV | put the PDF at `public/cv.pdf`; the links appear by themselves |
| Colours, fonts, spacing | `src/styles/tokens.css` |
| Icons on the Desktop page | `src/content/desktop.yaml` |
| The header link to the Desktop page | `headerLinks` in `src/site.ts` |

Anything that starts with `TODO` shows as a dashed orange placeholder in the preview. Run `npm run todo` before going live.

## Add a home section

Create `src/content/sections/<id>.md`:

```md
---
title: Teaching
eyebrow: Courses
nav: Teaching        # optional: also adds it to the top menu
order: 45            # position among the sections (gaps of 10 leave room)
kind: prose          # prose = free Markdown; or experience, projects, tools...
hue: periwinkle      # coral, amber, mauve, periwinkle or ink
---
Write the section here in Markdown.
```

## Add a page

Create `src/pages/<name>.md`:

```md
---
layout: ../layouts/Page.astro
title: Talks
eyebrow: Speaking
---
Content in Markdown.
```

It is served at `/<name>/`. To list it in the footer and the phone menu, add one line to `pages` in `src/site.ts`.

## Add a creative strand

Create `src/content/strands/<id>.md` with `title`, `kicker`, `hue`, `order`, and optional `entries`, `links` and `media` (`photos`, `videos`, `cards`). It appears in Off the clock with its own chip.

## The Desktop page

`/desktop/` is a small Windows 98-style computer, reached only from the header link. It has no home section and uses its own full-screen layout (`src/layouts/Bare.astro`), with no site header or footer.

- **Add a link icon:** add one entry to `src/content/desktop.yaml` with `href`. Links get the little shortcut arrow.
- **Add an app:** make a component in `src/components/desktop/apps/` that renders a `<Window id="...">`. Render it in `Desktop.astro` and add its id to `APPS`. Then point an icon at it with `app: <id>`. Its behaviour goes in `src/scripts/desktop/apps.ts`.
- **Add an icon drawing:** add a 16×16 text grid to `src/lib/pixel.ts`, one character per pixel.

Visitors can drag icons anywhere. Their arrangement is kept in their own browser, and right-click > Arrange Icons resets it. On computers the page is shown at 150% (125% on smaller screens), like zooming the browser.

The wallpaper (`src/assets/desktop/wallpaper.jpg`) is a photo by Se. Tsuchiya on Unsplash (https://unsplash.com/photos/SVVKbAy5CDc), used under the Unsplash License. To change it, replace that file.

**Paint** (`src/components/desktop/apps/Paint.astro`, `src/scripts/desktop/paint/`) has all 16 Windows 98 tools and its menus. It draws its own hard-edged pixels in `raster.ts`, the pixel engine, rather than using the browser's smoothed drawing.
- **How it is built:** `paint.ts` is the core: the picture, undo, files, autosave, dialogs, zoom and menus. Every tool or feature is a module that codes against the contract in `core.ts`. Any file in `paint/tools/` or `paint/extras/` that exports `install(core)` is loaded automatically.
  - `tools/basic.ts`: pencil, brush, eraser, fill, pick, airbrush, line and the shapes.
  - `select.ts`: Select, Free-Form Select and the clipboard.
  - `magnifier.ts`: the magnifier, zoom, grid and View Bitmap.
  - `text.ts`, and `curve.ts` (Curve and Polygon).
  - `extras/`: Edit Colors, Stretch/Skew and Set As Wallpaper.
- **To add a tool:** write a module that calls `core.addTool`. Then add its button to the `TOOLS` list in `Paint.astro` and draw its icon in `src/lib/paint-icons.ts`.
- **Tests:** `npm test` runs the unit tests (engine, selection helpers, polygon fill), and CI runs them before every build.
- **Privacy:** drawings stay in the visitor's browser. Save downloads a PNG or BMP, an open picture is kept in local storage until Paint is closed, and a picture set as wallpaper is kept in local storage too. "Restore Default Wallpaper" in the desktop's right-click menu removes it.
- **Loading:** Paint's code loads only the first time the window opens.

**Winamp** is [Webamp](https://github.com/captbaritone/webamp) (MIT licence), a browser rebuild of Winamp 2. The Winamp name and look belong to their owners. Its code loads the first time it opens; `src/scripts/desktop/winamp.ts` connects it to the taskbar.
- **To add songs:** put the audio files in `public/music/` and list them in `src/content/music.yaml`, where the file has an example. Only add music you have the rights to put online.
- **Playlist:** it is empty until then. Visitors can still drop their own files onto Winamp; those play only in their browser.

**Spotify icon:** it is already in `src/content/desktop.yaml` (id `spotify`) and stays hidden until you set its `href` to your Spotify link and delete its `draft: true` line.

The window manager (`src/scripts/desktop/wm.ts`) handles opening, dragging, resizing, minimising, the taskbar, and Back on phones. `/desktop/#mail` opens with Mail already open.

## Deploying

Pushing to `main` runs `.github/workflows/deploy.yml`. One-time setting: repository Settings, Pages, Source = **GitHub Actions**. Other branches and pull requests are only built, as a check.

## Notes

- The hero face is drawn by the sketch engine from the first version of this site (`src/scripts/sketch-engine.js`). A new face is drawn on every visit; click it to draw another.
- The favicon is one fixed face from the same engine (seed 4717), drawn with a thicker pen so it reads at 16 px: `public/favicon.ico`, `icon-32.png`, `icon-192.png` and `apple-touch-icon.png`.
- Nothing loads from third parties until a visitor asks: fonts are self-hosted, YouTube loads only when play is pressed, and Instagram is a plain link.
- Vocabulary is in `CONTEXT.md`; decisions are in `docs/adr/`.
