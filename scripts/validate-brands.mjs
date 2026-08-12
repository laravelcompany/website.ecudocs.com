import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseBrand, slugify } from '../src/lib/brand-schema.js';

const DATA_DIR = path.join(process.cwd(), 'src', 'data');

const failures = [];
let parsed = 0;
let checked = 0;

const entries = readdirSync(DATA_DIR, { withFileTypes: true });

for (const entry of entries) {
  if (!entry.isDirectory()) continue;

  const brandFile = path.join(DATA_DIR, entry.name, 'brand.json');
  if (!existsSync(brandFile)) continue;

  checked++;

  let data;
  try {
    data = JSON.parse(readFileSync(brandFile, 'utf-8'));
  } catch (err) {
    failures.push({ file: brandFile, error: `Invalid JSON: ${err.message}` });
    continue;
  }

  const result = parseBrand(data);
  if (result.success) {
    parsed++;
    const expectedSlug = slugify(data.name);
    if (data.slug && data.slug !== expectedSlug) {
      failures.push({
        file: brandFile,
        error: `slug "${data.slug}" does not match name-derived slug "${expectedSlug}"`,
      });
    }
    continue;
  }

  const issues = result.error.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  failures.push({ file: brandFile, error: issues });
}

console.log(`Brand files checked: ${checked}`);
console.log(`Brand files valid:   ${parsed}`);
console.log(`Brand files failed:  ${failures.length}`);

for (const f of failures) {
  console.error(`\nFAIL ${f.file}`);
  console.error(`     ${f.error}`);
}

if (failures.length > 0) {
  process.exit(1);
}

console.log('\nAll brand records are valid.');
