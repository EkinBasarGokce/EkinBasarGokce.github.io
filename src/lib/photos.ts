/**
 * Photos = every image in src/assets/photos/, in the order of photos.yaml.
 * Images without a photos.yaml entry still appear (after the listed ones) with
 * a generic description; an entry that names a missing file fails the build.
 */
import type { ImageMetadata } from 'astro';
import { getCollection } from 'astro:content';
import { site } from '../site';

const files = import.meta.glob<{ default: ImageMetadata }>(
  '/src/assets/photos/*.{jpg,jpeg,png,webp,avif,JPG,JPEG,PNG,WEBP}',
  { eager: true },
);

export interface Photo {
  id: string;
  file: string;
  alt: string;
  caption?: string;
  year?: string;
  home: boolean;
  src: ImageMetadata;
}

export async function getPhotos(): Promise<Photo[]> {
  const byName = new Map(Object.entries(files).map(([p, m]) => [p.split('/').pop()!, m.default]));
  const entries = await getCollection('photos');
  const listed: Photo[] = entries.map((e) => {
    const src = byName.get(e.data.file);
    if (!src) {
      throw new Error(`photos.yaml entry "${e.id}" names "${e.data.file}", which is not in src/assets/photos/`);
    }
    return { id: e.id, ...e.data, src };
  });
  const named = new Set(entries.map((e) => e.data.file));
  const extra: Photo[] = [...byName]
    .filter(([name]) => !named.has(name))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, src]) => ({ id: name, file: name, alt: `Photograph by ${site.name}`, home: false, src }));
  return [...listed, ...extra];
}
