/**
 * Wraps any Markdown text that starts with "TODO" in <span class="todo">, so
 * placeholders stand out in the preview. `npm run todo` lists them all.
 */
// the hint runs to the end of its sentence
const TODO = /TODO:?\s*([^.\n]*)/;

function walk(node) {
  if (!node.children) return;
  const out = [];
  for (const child of node.children) {
    if (child.type === 'text' && TODO.test(child.value)) {
      const i = child.value.search(TODO);
      const m = child.value.slice(i).match(TODO);
      if (i > 0) out.push({ type: 'text', value: child.value.slice(0, i) });
      out.push({
        type: 'element',
        tagName: 'span',
        properties: { className: ['todo'], title: 'Placeholder: fill this in' },
        children: [{ type: 'text', value: m[1] || 'to fill in' }],
      });
      const rest = child.value.slice(i + m[0].length);
      if (rest) out.push({ type: 'text', value: rest });
    } else {
      walk(child);
      out.push(child);
    }
  }
  node.children = out;
}

export default function rehypeTodo() {
  return (tree) => walk(tree);
}
