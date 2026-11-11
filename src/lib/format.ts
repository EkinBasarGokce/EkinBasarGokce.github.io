const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2024-09" -> "Sep 2024", "2024" -> "2024", "present" -> "Present" */
export function when(v?: string): string {
  if (!v) return '';
  if (v === 'present') return 'Present';
  const [y, m] = v.split('-');
  return m ? `${MONTHS[Number(m) - 1]} ${y}` : y;
}

export function span(start?: string, end?: string): string {
  const a = when(start);
  const b = when(end);
  if (a && b) return a === b ? a : `${a} – ${b}`;
  return a || b;
}

/** Sort key for "YYYY[-MM]" / "present" (bigger = newer). */
export function key(v?: string): number {
  if (!v) return 0;
  if (v === 'present') return 999999;
  const [y, m] = v.split('-');
  return Number(y) * 100 + Number(m ?? 0);
}

/** Minimal inline markup for copy in site.ts and titles: [label](href) and _emphasis_. */
export function inline(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => `<a href="${href}">${label}</a>`)
    .replace(/(^|\s)_([^_]+)_(?=\s|$|[.,;:!?])/g, '$1<em>$2</em>');
}

export const dateFmt = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
