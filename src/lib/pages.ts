/** Pages for the footer and menu. Notes stays hidden until the first note exists. */
import { getCollection } from 'astro:content';
import { site } from '../site';

export async function getPages() {
  const notes = await getCollection('notes', (n) => !n.data.draft);
  return site.pages.filter((p) => p.href !== '/notes/' || notes.length > 0);
}
