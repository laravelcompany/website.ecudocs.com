import * as fs from 'node:fs';
import * as path from 'node:path';

export const BRAND_OPTIONAL_FIELDS = [
  'description',
  'history',
  'country',
  'founded',
  'parent_company',
  'current_status',
  'vehicle_types',
  'popular_models',
  'ecu_information',
  'common_ecu_manufacturers',
  'related_brands',
  'seo_title',
  'seo_description',
  'faq',
  'sources',
];

export function slugifyBrand(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '');
}

export function readBrandContent(slug, rootDir = process.cwd()) {
  const file = path.join(rootDir, 'src', 'data', slug, 'brand.json');
  if (!fs.existsSync(file)) return null;

  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

export function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateBrandContent(brand, { expectedSlug = null, knownSlugs = new Set() } = {}) {
  const errors = [];
  const warnings = [];

  if (!brand || typeof brand !== 'object' || Array.isArray(brand)) {
    return { ok: false, errors: ['brand content must be a JSON object'], warnings };
  }

  if (!hasText(brand.name)) errors.push('name is required');
  if (!hasText(brand.slug)) errors.push('slug is required');

  if (brand.name && brand.slug) {
    const derived = slugifyBrand(brand.name);
    if (brand.slug !== derived) errors.push(`slug "${brand.slug}" must match name-derived slug "${derived}"`);
  }

  if (expectedSlug && brand.slug !== expectedSlug) {
    errors.push(`slug "${brand.slug}" does not match directory "${expectedSlug}"`);
  }

  if (brand.founded != null) {
    const year = Number(brand.founded);
    if (!Number.isInteger(year) || year < 1800 || year > new Date().getFullYear()) {
      errors.push('founded must be a plausible year');
    }
  }

  for (const key of ['vehicle_types', 'popular_models', 'common_ecu_manufacturers', 'related_brands', 'sources']) {
    if (brand[key] != null && !Array.isArray(brand[key])) errors.push(`${key} must be an array`);
  }

  if (Array.isArray(brand.related_brands)) {
    for (const slug of brand.related_brands) {
      if (typeof slug !== 'string' || !slug.trim()) errors.push('related_brands contains an invalid slug');
      else if (knownSlugs.size > 0 && !knownSlugs.has(slug)) warnings.push(`related brand "${slug}" does not exist in brands.json`);
    }
  }

  if (brand.faq != null) {
    if (!Array.isArray(brand.faq)) errors.push('faq must be an array');
    else {
      for (const [index, item] of brand.faq.entries()) {
        if (!item || typeof item !== 'object' || !hasText(item.question) || !hasText(item.answer)) {
          errors.push(`faq[${index}] must contain non-empty question and answer`);
        }
      }
    }
  }

  for (const key of ['description', 'history', 'ecu_information', 'seo_title', 'seo_description']) {
    if (brand[key] != null && !hasText(brand[key])) errors.push(`${key} cannot be empty when present`);
  }

  if (hasText(brand.seo_title) && brand.seo_title.length > 70) warnings.push('seo_title is longer than 70 characters');
  if (hasText(brand.seo_description) && brand.seo_description.length > 160) warnings.push('seo_description is longer than 160 characters');

  if (Array.isArray(brand.sources) && brand.sources.length === 0) warnings.push('sources is present but empty');
  if ((brand.ecu_information || brand.common_ecu_manufacturers) && !Array.isArray(brand.sources)) {
    warnings.push('technical ECU content has no sources array');
  }

  return { ok: errors.length === 0, errors, warnings };
}
