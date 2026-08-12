import * as fs from 'node:fs';
import * as path from 'node:path';
import brandsData from '../src/data/brands.json' with { type: 'json' };
import { slugifyBrand, validateBrandContent } from '../src/lib/brand-content.js';

const DATA_DIR = path.join(process.cwd(), 'src', 'data');
const knownSlugs = new Set(brandsData.map((row) => slugifyBrand(row[3])));
let errorCount = 0;
let warningCount = 0;
let checked = 0;

for (const slug of [...knownSlugs].sort()) {
  const file = path.join(DATA_DIR, slug, 'brand.json');
  if (!fs.existsSync(file)) continue;

  checked++;
  let brand;
  try {
    brand = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (error) {
    console.error(`✗ ${slug}: invalid JSON (${error.message})`);
    errorCount++;
    continue;
  }

  const result = validateBrandContent(brand, { expectedSlug: slug, knownSlugs });
  if (result.ok) console.log(`✓ ${slug}`);
  else console.error(`✗ ${slug}`);

  for (const message of result.errors) {
    console.error(`  error: ${message}`);
    errorCount++;
  }
  for (const message of result.warnings) {
    console.warn(`  warning: ${message}`);
    warningCount++;
  }
}

console.log(`\nChecked ${checked} enriched brand file(s). ${errorCount} error(s), ${warningCount} warning(s).`);
if (errorCount > 0) process.exit(1);
