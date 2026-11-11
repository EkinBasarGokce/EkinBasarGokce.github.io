// @ts-check
import { defineConfig } from 'astro/config';
import rehypeTodo from './src/lib/rehype-todo.mjs';

// User site: served from the root of https://ekinbasargokce.github.io/, so no `base`.
export default defineConfig({
  site: 'https://ekinbasargokce.github.io',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  image: {
    // YouTube posters are downloaded once at build time and served from this
    // site, so visitors never contact YouTube until they press play.
    domains: ['i.ytimg.com'],
  },
  markdown: {
    rehypePlugins: [rehypeTodo],
  },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
});
