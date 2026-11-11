// Lists every placeholder ("TODO") left in the site's content and config.
// Run: npm run todo
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const roots = ['src/content', 'src/site.ts', 'src/pages'];
const hits = [];

function scan(p) {
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p)) scan(join(p, f));
    return;
  }
  if (!/\.(md|ya?ml|ts|astro)$/.test(p)) return;
  readFileSync(p, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.includes('TODO') && !line.includes('isTodo') && !line.includes('starts with "TODO"')) {
        hits.push(relative('.', p).split(sep).join('/') + ':' + (i + 1) + '  ' + line.trim());
      }
    });
}

roots.forEach(scan);
console.log(hits.length ? hits.join('\n') : 'No placeholders left.');
console.log('\n' + hits.length + ' placeholder(s).');
