/**
 * Regenerate public/examples/*.json (the demos as editable JSON specs for LLM
 * agents) from src/lib/demos. Run: npm run examples. A test fails if they're stale.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { exampleSpec, listExamples } from '../src/lib/api/examples';

const dir = new URL('../public/examples/', import.meta.url);
mkdirSync(dir, { recursive: true });
const index = listExamples();
for (const ex of index) {
  const spec = exampleSpec(ex.id);
  if (spec) writeFileSync(new URL(`${ex.id}.json`, dir), JSON.stringify(spec, null, 2) + '\n');
}
writeFileSync(new URL('index.json', dir), JSON.stringify(index, null, 2) + '\n');
console.log(`wrote ${index.filter((e) => e.spec).length} specs + index.json to public/examples/`);
