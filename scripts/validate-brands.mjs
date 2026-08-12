import * as fs from 'node:fs';
import * as path from 'node:path';
import brandsData from '../src/data/brands.json' with { type: 'json' };
import {
  normalizedTextFingerprint,
  slugifyBrand,
  textSimilarity,
  validateBrandContent,
} from '../src/lib/brand-content.js';

const DATA_DIR = path.join(process.cwd(), 'src', 'data');
const knownSlugs = new Set();
const knownNames = new Set();
const enrichedDescriptions = [];
let errorCount = 0;
let warningCount = 0;
let checkedBrands = 0;
let checkedModels = 0;

function error(scope, message) {
  console.error(`✗ ${scope}: ${message}`);
  errorCount++;
}

function warn(scope, message) {
  console.warn(`! ${scope}: ${message}`);
  warningCount++;
}

function validateLegacyIndex() {
  for (const [index, row] of brandsData.entries()) {
    if (!Array.isArray(row) || row.length < 4) {
      error(`brands.json[${index}]`, 'expected an array with at least id, uuid, URL and name');
      continue;
    }

    const name = row[3];
    if (typeof name !== 'string' || !name.trim()) {
      error(`brands.json[${index}]`, 'manufacturer name is missing');
      continue;
    }

    const slug = slugifyBrand(name);
    if (!slug) {
      error(`brands.json[${index}]`, `could not derive slug from "${name}"`);
      continue;
    }

    const nameKey = name.trim().toLowerCase();
    if (knownNames.has(nameKey)) error('brands.json', `duplicate manufacturer name "${name}"`);
    if (knownSlugs.has(slug)) error('brands.json', `duplicate derived slug "${slug}"`);

    knownNames.add(nameKey);
    knownSlugs.add(slug);
  }
}

function validateModels(slug) {
  const file = path.join(DATA_DIR, slug, 'models.json');
  if (!fs.existsSync(file)) return;

  let models;
  try {
    models = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    error(`${slug}/models.json`, `invalid JSON (${e.message})`);
    return;
  }

  if (!Array.isArray(models)) {
    error(`${slug}/models.json`, 'root value must be an array');
    return;
  }

  const names = new Set();
  const routeKeys = new Set();
  for (const [index, model] of models.entries()) {
    checkedModels++;
    if (!model || typeof model !== 'object' || Array.isArray(model)) {
      error(`${slug}/models.json[${index}]`, 'model must be an object');
      continue;
    }

    if (typeof model.name !== 'string' || !model.name.trim()) {
      error(`${slug}/models.json[${index}]`, 'model name is required');
      continue;
    }

    const name = model.name.trim();
    if (/^\d+$/.test(name) || name.length < 2) error(`${slug}/models.json[${index}]`, `malformed model name "${name}"`);

    const nameKey = name.toLowerCase();
    if (names.has(nameKey)) warn(`${slug}/models.json`, `duplicate model name "${name}"`);
    names.add(nameKey);

    const routeKey = model.slug || model.id;
    if (routeKey && routeKey !== 'placeholder-model') {
      const normalized = String(routeKey).trim();
      if (routeKeys.has(normalized)) error(`${slug}/models.json`, `duplicate model route key "${normalized}"`);
      routeKeys.add(normalized);
    }
  }
}

function validateBrandFile(slug) {
  const file = path.join(DATA_DIR, slug, 'brand.json');
  if (!fs.existsSync(file)) return;

  checkedBrands++;
  let brand;
  try {
    brand = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    error(`${slug}/brand.json`, `invalid JSON (${e.message})`);
    return;
  }

  const result = validateBrandContent(brand, { expectedSlug: slug, knownSlugs });
  if (result.ok) console.log(`✓ ${slug}/brand.json`);
  for (const message of result.errors) error(`${slug}/brand.json`, message);
  for (const message of result.warnings) warn(`${slug}/brand.json`, message);

  const description = result.value?.description;
  if (typeof description === 'string' && description.trim().length >= 80) {
    enrichedDescriptions.push({ slug, text: description, fingerprint: normalizedTextFingerprint(description) });
  }
}

function validateDescriptionUniqueness() {
  const exact = new Map();
  for (const entry of enrichedDescriptions) {
    if (!entry.fingerprint) continue;
    if (exact.has(entry.fingerprint)) {
      error('brand descriptions', `exact duplicate content in "${exact.get(entry.fingerprint)}" and "${entry.slug}"`);
    } else {
      exact.set(entry.fingerprint, entry.slug);
    }
  }

  for (let i = 0; i < enrichedDescriptions.length; i++) {
    for (let j = i + 1; j < enrichedDescriptions.length; j++) {
      const a = enrichedDescriptions[i];
      const b = enrichedDescriptions[j];
      const similarity = textSimilarity(a.text, b.text);
      if (similarity >= 0.92 && a.fingerprint !== b.fingerprint) {
        warn('brand descriptions', `near-duplicate content (${similarity.toFixed(2)}) in "${a.slug}" and "${b.slug}"`);
      }
    }
  }
}

validateLegacyIndex();

for (const slug of [...knownSlugs].sort()) {
  validateBrandFile(slug);
  validateModels(slug);
}

validateDescriptionUniqueness();

console.log('\n--- Brand validation summary ---');
console.log(`Manufacturers in legacy index: ${knownSlugs.size}`);
console.log(`Brand files checked:           ${checkedBrands}`);
console.log(`Model records checked:         ${checkedModels}`);
console.log(`Errors:                        ${errorCount}`);
console.log(`Warnings:                      ${warningCount}`);

if (errorCount > 0) process.exit(1);
console.log('Validation passed with no hard errors.');
