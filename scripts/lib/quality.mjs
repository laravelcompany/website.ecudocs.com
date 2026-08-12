import { slugify } from '../../src/lib/brand-schema.js';

const CURRENT_YEAR = new Date().getFullYear();

const PLACEHOLDER_PATTERN =
  /\b(lorem\s*ipsum|placeholder|to\s*be\s*(?:determined|provided|announced)|tbd|changeme|insert\s*(?:your|the|sample)?\s*(?:text|content|here|below)?|fill\s*in|not\s*specified|add\s*(?:content|text|description)|provide\s*(?:content|text|description|details|info)|coming\s*soon|n\/a|null|undefined)\b/i;

const SUSPICIOUS_CLAIM_PATTERN =
  /\b(world'?s?\s*first|first-of-its-kind|actually\s+the\s+first|only\s+company|unmatched|unrivaled|unrivalled|pioneered|game-?changer|cutting-?edge|state-?of-?the-?art|best-?in-?class|class-?leading|unparalleled|groundbreaking|revolutionary|legendary|number\s+one)\b/i;

const ECU_SPECIFIC_PATTERN =
  /\b(kwp\d*|uds|obd-?ii|obd-?2|can\s*bus|baud\s*rate|baudrates?|hex\s*address|part\s*number|ecm\s*part|dme)\b/i;

const GENERIC_MODEL_TERMS = new Set([
  'sedan', 'saloon', 'coupe', 'crossover', 'suv', 'suvs', 'hatchback', 'hatch',
  'van', 'truck', 'pickup', 'wagon', 'roadster', 'cabriolet', 'convertible',
  'limousine', 'mpv', 'pick-up', 'hatchbacks', 'sedans',
]);

const ALLOWED_STATUS = new Set([
  'active', 'defunct', 'inactive', 'discontinued', 'bankrupt', 'sold', 'merged', 'revived',
]);

function textMatches(text) {
  return String(text ?? '').trim().length > 0;
}

function jaccardSimilarity(a, b) {
  const wa = new Set(String(a).toLowerCase().split(/\W+/).filter(Boolean));
  const wb = new Set(String(b).toLowerCase().split(/\W+/).filter(Boolean));
  if (wa.size === 0 && wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / Math.max(wa.size + wb.size - inter, 1);
}

export function checkQuality(brand, { scope = 'merged' } = {}) {
  const errors = [];
  const warnings = [];
  const errorLevel = scope === 'draft';

  const name = brand?.name;
  const description = brand?.description;

  if (!textMatches(name)) errors.push('name is missing or empty');
  if (!textMatches(description)) errors.push('description is missing or empty');
  else if (String(description).trim().length < 40) warnings.push('description is very short (<40 characters)');

  if (brand.slug != null) {
    const expected = slugify(name);
    if (brand.slug !== expected) {
      errors.push(`slug "${brand.slug}" does not match name-derived slug "${expected}"`);
    }
  }

  if (brand.founded != null) {
    if (!Number.isInteger(brand.founded)) {
      errors.push('founded must be an integer year');
    } else if (brand.founded < 1800 || brand.founded > CURRENT_YEAR) {
      errors.push(`founded year ${brand.founded} is outside the plausible range (1800-${CURRENT_YEAR})`);
    }
  }

  if (brand.current_status != null && !ALLOWED_STATUS.has(String(brand.current_status).toLowerCase())) {
    warnings.push(`current_status "${brand.current_status}" is not in the known set: ${[...ALLOWED_STATUS].join(', ')}`);
  }

  const arrayFields = ['vehicle_types', 'popular_models', 'common_ecu_manufacturers', 'related_brands'];
  for (const key of arrayFields) {
    const arr = brand[key];
    if (arr == null) continue;
    if (!Array.isArray(arr)) {
      errors.push(`${key} must be an array`);
      continue;
    }
    const seen = new Set();
    for (const item of arr) {
      if (typeof item !== 'string' || item.trim().length === 0) {
        errors.push(`${key} contains an empty entry`);
        continue;
      }
      const trimmed = item.trim();
      if (seen.has(trimmed.toLowerCase())) {
        errors.push(`${key} contains duplicate entry "${trimmed}"`);
      }
      seen.add(trimmed.toLowerCase());

      if (key === 'popular_models') {
        if (/^\d+$/.test(trimmed)) {
          errors.push(`malformed model name "${trimmed}" (all digits)`);
        } else if (trimmed.length < 2) {
          errors.push(`malformed model name "${trimmed}" (too short)`);
        } else if (GENERIC_MODEL_TERMS.has(trimmed.toLowerCase())) {
          errors.push(`malformed model name "${trimmed}" (generic term, not a model)`);
        }
      } else if (key === 'related_brands') {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
          errors.push(`related_brands entry "${trimmed}" is not a valid slug`);
        }
      }
    }
  }

  if (brand.faq != null) {
    if (!Array.isArray(brand.faq)) {
      errors.push('faq must be an array');
    } else {
      const questions = new Set();
      for (const faq of brand.faq) {
        if (!faq || typeof faq !== 'object') {
          errors.push('faq contains a non-object entry');
          continue;
        }
        const q = String(faq.question ?? '').trim();
        const a = String(faq.answer ?? '').trim();
        if (!q) errors.push('faq entry has an empty question');
        if (!a) errors.push('faq entry has an empty answer');
        if (q && a && q === a) errors.push(`faq question and answer are identical ("${q}")`);
        if (q && questions.has(q.toLowerCase())) errors.push(`duplicate faq question "${q}"`);
        if (q) questions.add(q.toLowerCase());
      }
    }
  }

  const proseFields = ['description', 'history', 'ecu_information'];
  for (const key of proseFields) {
    if (brand[key] == null) continue;
    const text = String(brand[key]);
    if (text.trim().length === 0) errors.push(`${key} is an empty string`);

    if (PLACEHOLDER_PATTERN.test(text)) {
      const msg = `${key} contains placeholder text`;
      if (errorLevel) errors.push(msg);
      else warnings.push(msg);
    }

    if (key !== 'description' && SUSPICIOUS_CLAIM_PATTERN.test(text) && scope !== 'draft') {
      warnings.push(`${key} contains potentially unsupported superlative claims`);
    }
  }

  if (brand.seo_title != null && String(brand.seo_title).trim().length === 0) {
    errors.push('seo_title is an empty string');
  } else if (brand.seo_title != null && String(brand.seo_title).length > 70) {
    warnings.push(`seo_title is ${String(brand.seo_title).length} characters (recommend under 70)`);
  }

  if (brand.seo_description != null && String(brand.seo_description).trim().length === 0) {
    errors.push('seo_description is an empty string');
  } else if (brand.seo_description != null && String(brand.seo_description).length > 160) {
    warnings.push(`seo_description is ${String(brand.seo_description).length} characters (recommend under 160)`);
  }

  if (brand.ecu_information != null) {
    const text = String(brand.ecu_information);
    if (ECU_SPECIFIC_PATTERN.test(text)) {
      warnings.push('ecu_information includes specific technical claims (protocols/parts) — verify manually before promotion');
    }
  }

  if (brand.common_ecu_manufacturers != null && Array.isArray(brand.common_ecu_manufacturers)) {
    warnings.push('common_ecu_manufacturers present — verify suppliers manually before promotion');
  }

  if (brand.popular_models != null && Array.isArray(brand.popular_models) && !textMatches(name)) {
    warnings.push('popular_models present but name is empty');
  }

  if (textMatches(description) && textMatches(brand.history)) {
    const sim = jaccardSimilarity(description, brand.history);
    if (sim > 0.75) warnings.push(`history is nearly identical to description (similarity ${sim.toFixed(2)})`);
  }

  if (textMatches(description) && textMatches(brand.seo_description)) {
    const sim = jaccardSimilarity(description, brand.seo_description);
    if (sim > 0.7) warnings.push(`seo_description is very similar to description (similarity ${sim.toFixed(2)})`);
  }

  for (const faq of brand.faq ?? []) {
    if (faq && typeof faq === 'object' && textMatches(faq.answer)) {
      const sim = jaccardSimilarity(description, faq.answer);
      if (sim > 0.7) warnings.push('faq answer duplicates the brand description');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}