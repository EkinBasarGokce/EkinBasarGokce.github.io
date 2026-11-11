/**
 * Photos = every image under src/assets/photos/.
 *   src/assets/photos/*.jpg          -> Photography (and the /photography/ page)
 *   src/assets/photos/<strand>/*.jpg -> that strand, e.g. photos/stage/ for Stage
 * Order, descriptions and captions come from photos.yaml (file = path inside
 * photos/, e.g. "stage/spamalot-1.jpg"). Images without an entry still appear,
 * after the listed ones; an entry naming a missing file fails the build.
 */
import type { ImageMetadata } from 'astro';
import { getCollection } from 'astro:content';
import { site } from '../site';

const files = import.meta.glob<{ default: ImageMetadata }>(
  '/src/assets/photos/**/*.{jpg,jpeg,png,webp,avif,JPG,JPEG,PNG,WEBP}',
  { eager: true },
);

export interface Photo {
  id: string;
  file: string;
  strand: string;
  alt: string;
  caption?: string;
  year?: string;
  credit?: string;
  order?: number;
  home: boolean;
  src: ImageMetadata;
}

/** The line shown under a photo and in the lightbox: caption, year, credit. */
export function photoLine(p: Photo): string {
  const credit = p.credit === undefined ? '' : `With the courtesy of ${p.credit.trim() || '…'}`;
  return [p.caption, p.year, credit].filter(Boolean).join(' · ');
}

const strandOf = (file: string) => (file.includes('/') ? file.split('/')[0] : 'photography');

export async function getPhotos(): Promise<Photo[]> {
  const byName = new Map(
    Object.entries(files).map(([p, m]) => [p.replace('/src/assets/photos/', ''), m.default]),
  );
  const entries = await getCollection('photos');
  const listed: Photo[] = entries.map((e) => {
    const src = byName.get(e.data.file);
    if (!src) {
      throw new Error(`photos.yaml entry "${e.id}" names "${e.data.file}", which is not in src/assets/photos/`);
    }
    return { id: e.id, ...e.data, strand: strandOf(e.data.file), src };
  });
  listed.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
  const named = new Set(entries.map((e) => e.data.file));
  const extra: Photo[] = [...byName]
    .filter(([name]) => !named.has(name))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, src]) => ({
      id: name,
      file: name,
      strand: strandOf(name),
      alt: `Photograph by ${site.name}`,
      home: false,
      src,
    }));
  return [...listed, ...extra];
}

/** Up to six photos for a strand's home-page strip: the ones marked home, else the first six. */
export async function getStrandPhotos(strand: string): Promise<Photo[]> {
  const mine = (await getPhotos()).filter((p) => p.strand === strand);
  return (mine.some((p) => p.home) ? mine.filter((p) => p.home) : mine).slice(0, 6);
}
