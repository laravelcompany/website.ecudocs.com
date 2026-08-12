import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import brandsData from '../src/data/brands.json' with { type: 'json' };
import {
  BRAND_ENRICHMENT_FIELDS,
  isEnrichedBrandContent,
  readBrandRecord,
  slugifyBrand,
  validateBrandContent,
} from '../src/lib/brand-content.js';

const args = process.argv.slice(2);
const slugArg = args.find((arg) => arg.startsWith('--brand='));
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const brandSlug = slugArg?.split('=')[1];

if (!brandSlug) {
  console.error('Usage: npm run generate:brand -- --brand=bmw [--dry-run] [--force]');
  process.exit(1);
}

const row = brandsData.find((brand) => slugifyBrand(brand[3]) === brandSlug);
if (!row) {
  console.error(`Unknown brand slug: ${brandSlug}`);
  process.exit(1);
}

const [, , referenceUrl, brandName] = row;
const existing = readBrandRecord(brandSlug) || { name: brandName, slug: brandSlug };
const hasReviewedEnrichment = isEnrichedBrandContent(existing);
const modelsPath = path.join(process.cwd(), 'src', 'data', brandSlug, 'models.json');
let knownModels = [];
if (fs.existsSync(modelsPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
    if (Array.isArray(parsed)) knownModels = parsed.map((model) => model?.name).filter(Boolean).slice(0, 60);
  } catch (error) {
    console.error(`Could not read ${brandSlug}/models.json: ${error.message}`);
    process.exit(1);
  }
}

const requestedFields = force || !hasReviewedEnrichment
  ? BRAND_ENRICHMENT_FIELDS
  : BRAND_ENRICHMENT_FIELDS.filter((field) => {
      const value = existing[field];
      if (Array.isArray(value)) return value.length === 0;
      return value == null || (typeof value === 'string' && !value.trim());
    });

const system = `You prepare structured automotive manufacturer reference content for ECU Docs.
Return only valid JSON. Never invent ECU part numbers, pinouts, protocols, compatibility claims or unsupported technical facts.
When a fact cannot be established confidently, omit the field. Keep copy useful, manufacturer-specific and concise.
Do not use marketing superlatives. FAQ answers must only describe information that can be supported by the supplied context.
Only return fields requested by the user. Source URLs must be real URLs actually relied upon.`;

const user = {
  task: 'Enrich one manufacturer record',
  manufacturer: brandName,
  slug: brandSlug,
  reference_url_from_legacy_index: referenceUrl,
  existing_record: existing,
  existing_record_status: hasReviewedEnrichment ? 'reviewed-enrichment' : 'legacy-only',
  known_models_from_project: knownModels,
  requested_fields: requestedFields,
  schema_notes: {
    sources: 'array of http(s) URLs actually used as evidence',
    faq: 'array of {question, answer}; omit unsupported questions',
    related_brands: 'array of existing manufacturer slugs only',
    technical_safety: 'omit uncertain ECU supplier/specification claims rather than guessing',
  },
};

if (requestedFields.length === 0 && !force) {
  console.log(`${brandSlug}: no missing enrichment fields. Use --force to regenerate intentionally.`);
  process.exit(0);
}

if (dryRun) {
  console.log(JSON.stringify({ provider: 'OpenAI-compatible chat/completions', system, user }, null, 2));
  console.log('\nDry run only: no API request and no files written.');
  process.exit(0);
}

const baseUrl = process.env.AI_API_BASE_URL;
const apiKey = process.env.AI_API_KEY;
const model = process.env.AI_MODEL;
if (!baseUrl || !apiKey || !model) {
  console.error('Set AI_API_BASE_URL, AI_API_KEY and AI_MODEL before generating content.');
  process.exit(1);
}

const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(user) },
    ],
  }),
});

if (!response.ok) {
  const body = await response.text();
  console.error(`AI request failed (${response.status}): ${body.slice(0, 500)}`);
  process.exit(1);
}

const payload = await response.json();
let raw = payload?.choices?.[0]?.message?.content;
if (!raw) {
  console.error('AI response did not contain message content.');
  process.exit(1);
}

raw = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
let generated;
try {
  generated = JSON.parse(raw);
} catch (error) {
  console.error(`AI response was not valid JSON: ${error.message}`);
  process.exit(1);
}

if (!generated || typeof generated !== 'object' || Array.isArray(generated)) {
  console.error('AI response must be a JSON object.');
  process.exit(1);
}

const unexpectedFields = Object.keys(generated).filter((field) => !requestedFields.includes(field));
if (unexpectedFields.length > 0) {
  console.warn(`Discarding unrequested AI fields: ${unexpectedFields.join(', ')}`);
  for (const field of unexpectedFields) delete generated[field];
}

const candidate = {
  ...existing,
  ...generated,
  name: brandName,
  slug: brandSlug,
};

const knownSlugs = new Set(brandsData.map((brand) => slugifyBrand(brand[3])));
const validation = validateBrandContent(candidate, {
  expectedSlug: brandSlug,
  knownSlugs,
  requireExplicitSlug: true,
});
if (!validation.ok) {
  console.error('Generated candidate failed validation:');
  for (const message of validation.errors) console.error(`  - ${message}`);
  process.exit(1);
}

const outDir = path.join(process.cwd(), 'tmp', 'brand-candidates');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${brandSlug}.json`);
fs.writeFileSync(outFile, `${JSON.stringify(validation.value, null, 2)}\n`, 'utf-8');

console.log(`Candidate written to ${path.relative(process.cwd(), outFile)}`);
console.log(`Generated fields: ${Object.keys(generated).join(', ') || '(none)'}`);
if (validation.warnings.length > 0) {
  console.warn('Review warnings before promotion:');
  for (const message of validation.warnings) console.warn(`  - ${message}`);
}
console.log('No production brand.json file was modified. Review the candidate manually, then use the promotion command.');
