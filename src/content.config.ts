/**
 * Content collections. Every list on the site is rendered from one of these.
 * A malformed entry fails the build with a message naming the file and field,
 * so a typo can never ship a broken page.
 *
 *   Add a job, degree, project or strand  -> add one .md file in its folder
 *   Add a video, link card or tool group   -> add one entry in its .yaml file
 *   Add a photo                            -> drop it in src/assets/photos/
 *                                             (+ optional caption in photos.yaml)
 *   Add a home section                     -> add one .md file in sections/
 */
import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';

/** "2024", "2024-09" or "present" */
const when = z
  .string()
  .regex(/^(\d{4}(-(0[1-9]|1[0-2]))?|present)$/, 'Use YYYY, YYYY-MM or "present"');

const link = z.object({
  label: z.string(),
  href: z.string(),
});

/** palette hue; 'ink' is the neutral option */
const hue = z.enum(['coral', 'amber', 'mauve', 'periwinkle', 'ink']);

const experience = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/experience' }),
  schema: z.object({
    org: z.string(),
    orgUrl: z.string().optional(),
    unit: z.string().optional(), // lab, chair or programme inside the org
    location: z.string().optional(),
    kind: z.enum(['industry', 'research', 'teaching', 'internship']),
    /** newest role first; two roles = a promotion inside one org */
    roles: z
      .array(z.object({ title: z.string(), start: when.optional(), end: when.optional() }))
      .min(1),
    tags: z.array(z.string()).default([]),
    /** lower comes first; leave gaps (10, 20, 30) so inserting is easy */
    order: z.number(),
    draft: z.boolean().default(false),
  }),
});

const education = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/education' }),
  schema: z.object({
    degree: z.string(), // "PhD", "MSc", "BSc"
    field: z.string(),
    institution: z.string(),
    institutionUrl: z.string().optional(),
    start: when.optional(),
    end: when.optional(),
    focus: z.string().optional(),
    thesis: z.string().optional(),
    order: z.number(),
    draft: z.boolean().default(false),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    summary: z.string().max(180),
    year: z.string().optional(),
    tags: z.array(z.string()).default([]),
    links: z.array(link).default([]),
    hue: hue.default('coral'),
    order: z.number(),
    draft: z.boolean().default(false),
  }),
});

const tools = defineCollection({
  loader: file('src/content/tools.yaml'),
  schema: z.object({
    label: z.string(),
    items: z.array(z.string()).min(1),
    order: z.number(),
  }),
});

const publications = defineCollection({
  loader: file('src/content/publications.yaml'),
  schema: z.object({
    title: z.string(),
    authors: z.string(),
    venue: z.string(),
    year: z.string(),
    status: z.enum(['published', 'accepted', 'under review', 'preprint', 'poster', 'talk']),
    links: z.array(link).default([]),
  }),
});

/** One creative practice inside "Off the clock". */
const strands = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/strands' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    kicker: z.string(), // one line under the title
    hue,
    order: z.number(),
    /** dated rows: productions, conferences, lessons... */
    entries: z
      .array(
        z.object({
          title: z.string(),
          role: z.string().optional(),
          when: z.string().optional(),
          detail: z.string().optional(),
          href: z.string().optional(),
        }),
      )
      .default([]),
    links: z.array(link).default([]),
    /** which media this strand shows; filtered by this strand's id */
    media: z.array(z.enum(['photos', 'videos', 'cards'])).default([]),
    /** a Page that holds the long form, e.g. "/photography/" */
    more: link.optional(),
    /** shown while this strand's photos are still missing, e.g. "Photos coming soon." */
    placeholder: z.string().optional(),
    /** a logo (path relative to the .md file), used as the avatar of an Instagram badge */
    logo: image().optional(),
    logoAlt: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const photos = defineCollection({
  loader: file('src/content/photos.yaml'),
  schema: z.object({
    /** file name inside src/assets/photos/ */
    file: z.string(),
    alt: z.string(),
    caption: z.string().optional(),
    year: z.string().optional(),
    /** also show on the home page teaser */
    home: z.boolean().default(false),
  }),
});

const videos = defineCollection({
  /** id = the YouTube video id (the part after watch?v=) */
  loader: file('src/content/videos.yaml'),
  schema: z.object({
    title: z.string(),
    strand: z.string(), // "music" or "video"
    role: z.string().optional(), // "Shot, edited, graded"
    year: z.string().optional(),
    start: z.number().int().nonnegative().optional(),
  }),
});

const cards = defineCollection({
  /** link-out cards (Instagram, Spotify...) shown inside a strand */
  loader: file('src/content/cards.yaml'),
  schema: z.object({
    label: z.string(),
    sub: z.string().optional(),
    href: z.string(),
    platform: z.enum(['instagram', 'youtube', 'spotify', 'web']),
    strand: z.string(),
    /** badge = a small Instagram-profile preview (avatar = the strand's logo) */
    style: z.enum(['card', 'badge']).default('card'),
    /** YouTube ids whose stills fill the badge's preview grid, after the logo */
    tiles: z.array(z.string()).default([]),
  }),
});

/** Home-page sections, in order. kind picks the component. */
const sections = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/sections' }),
  schema: z.object({
    title: z.string(),
    eyebrow: z.string().optional(),
    nav: z.string().optional(), // label in the top nav; omit to keep it out
    order: z.number(),
    hue: hue.default('coral'),
    /** one way out of the section, e.g. { label: 'All photographs', href: '/photography/' } */
    exit: link.optional(),
    kind: z.enum([
      'experience',
      'projects',
      'research',
      'education',
      'tools',
      'off-the-clock',
      'contact',
      'prose',
    ]),
    draft: z.boolean().default(false),
  }),
});

const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = {
  experience,
  education,
  projects,
  tools,
  publications,
  strands,
  photos,
  videos,
  cards,
  sections,
  notes,
};
