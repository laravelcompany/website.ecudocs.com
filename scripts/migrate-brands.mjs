import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseBrand, slugify } from '../src/lib/brand-schema.js';

const DATA_DIR = path.join(process.cwd(), 'src', 'data');
const dryRun = process.argv.includes('--dry-run');

const entries = readdirSync(DATA_DIR, { withFileTypes: true });
let checked = 0;
let changed = 0;

for (const entry of entries) {
  if (!entry.isDirectory()) continue;

  const brandFile = path.join(DATA_DIR, entry.name, 'brand.json');
  if (!existsSync(brandFile)) continue;

  checked++;

  const data = JSON.parse(readFileSync(brandFile, 'utf-8'));
  const slug = slugify(data.name);

  if (slug !== entry.name) {
    console.error(`SKIP ${entry.name}: directory slug "${entry.name}" != slugify(name) "${slug}"`);
    continue;
  }

  const original = readFileSync(brandFile, 'utf-8');
  if (!data.slug) {
    data.slug = slug;
    changed++;
  }

  const result = parseBrand(data);
  if (!result.success) {
    console.error(`SKIP ${entry.name}: does not validate: ${result.error.issues.map((i) => i.message).join('; ')}`);
    continue;
  }

  const output = `${JSON.stringify(data, null, 2)}\n`;
  if (output !== original && !dryRun) {
    writeFileSync(brandFile, output, 'utf-8');
    console.log(`UPDATED ${entry.name}`);
  } else if (output !== original) {
    console.log(`WOULD UPDATE ${entry.name}`);
  }
}

console.log(`\nBrand files checked: ${checked}`);
console.log(`Brand files updated: ${changed}`);
if (dryRun) console.log('Dry run — no files were written.');
