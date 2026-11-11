/**
 * Identity, hero copy and contact details. Everything here appears on every page.
 * A value that starts with "TODO" renders as a dashed placeholder in the preview
 * and is listed by `npm run todo`, so nothing unfinished goes live unnoticed.
 */
export const site = {
  name: 'Ekin Başar Gökçe',
  shortName: 'Ekin B. Gökçe',
  url: 'https://ekinbasargokce.github.io',
  title: 'Ekin Başar Gökçe · Engineer and PhD researcher',
  description:
    'Engineer and PhD student in Computer Science and Engineering at Sabancı University, working on generative drug design. Former Lead Developer at Beespenser. Also photography, musical theatre, a band and its videos.',
  location: 'İstanbul, Türkiye',

  hero: {
    /** small line above the name; leave empty for none */
    eyebrow: '',
    /** Plain text with [label](href) links. */
    lede: 'I build software and machine learning systems. Until October 2026 I led development at [Beespenser](#experience), building the desktop app that drives its circuit-board dispensing machine. Now I am a PhD student in Computer Science and Engineering at [Sabancı University](#research), working on generative models for drug design.',
    bridge:
      'Off the clock I [take photographs](#photography), [act in and direct musicals](#stage), [sing with my band and teach singing](#music), and [film and grade its videos](#video).',
  },

  /** Shown as labelled rows in Contact. Assembled in the browser to keep scrapers out. */
  emails: [
    { label: 'Academic inquiries', address: 'basar.gokce@sabanciuniv.edu' },
    { label: 'Everything else', address: 'basargokce@gmail.com' },
  ],

  /** Shown in the hero link row and in Contact, in this order. */
  socials: [
    { label: 'GitHub', href: 'https://github.com/EkinBasarGokce' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/ekin-basar-gokce/' },
    { label: 'Instagram', href: 'https://www.instagram.com/metallician/' },
    // { label: 'Google Scholar', href: 'https://scholar.google.com/citations?user=...' },
    // { label: 'ORCID', href: 'https://orcid.org/0000-...' },
  ],

  /** Put your CV at public/cv.pdf; the link appears only when the file exists. */
  cv: '/cv.pdf',

  /** Pages listed in the footer. Add a page file in src/pages/, then one line here. */
  pages: [
    { label: 'Now', href: '/now/' },
    { label: 'Notes', href: '/notes/' },
    { label: 'Photography', href: '/photography/' },
  ],
} as const;

export const isTodo = (v: unknown): boolean => typeof v === 'string' && /^\s*TODO/i.test(v);
