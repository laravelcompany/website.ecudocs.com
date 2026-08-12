import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import brandsData from '../src/data/brands.json' with { type: 'json' };
import { slugifyBrand, validateBrandContent } from '../src/lib/brand-content.js';

const args = process.argv.slice(2);
const slugArg = args.find((arg) => arg.startsWith('--brand='));
const dryRun = args.includes('--dry-run');
const brandSlug = slugArg?.split('=')[1];

if (!brandSlug) {
  console.error('Usage: npm run generate:brand -- --brand=bmw [--dry-run]');
  process.exit(1);
}

const row = brandsData.find((brand) => slugifyBrand(brand[3]) === brandSlug);
if (!row) {
  console.error(`Unknown brand slug: ${brandSlug}`);
  process.exit(1);
}

const [, , referenceUrl, brandName] = row;
const modelsPath = path.join(process.cwd(), 'src', 'data', brandSlug, 'models.json');
const knownModels = fs.existsSync(modelsPath)
  ? JSON.parse(fs.readFileSync(modelsPath, 'utf-8')).map((model) => model.name).filter(Boolean).slice(0, 40)
  : [];

const baseUrl = process.env.AI_API_BASE_URL;
const apiKey = process.env.AI_API_KEY;
const model = process.env.AI_MODEL;

if (!baseUrl || !apiKey || !model) {
  console.error('Set AI_API_BASE_URL, AI_API_KEY and AI_MODEL before generating content.');
  process.exit(1);
}

const system = `You prepare structured automotive manufacturer reference content for ECU Docs.
Return only valid JSON. Never invent ECU part numbers, pinouts, protocols, compatibility claims or unsupported technical facts.
When a fact cannot be established confidently, omit the field. Keep copy useful, manufacturer-specific and concise.
Do not use marketing superlatives. FAQ answers must only describe information that can be supported by the supplied context.`;

const user = {
  task: 'Enrich one manufacturer record',
  manufacturer: brandName,
  slug: brandSlug,
  reference_url: referenceUrl,
  known_models_from_project: knownModels,
  allowed_fields: [
    'name', 'slug', 'description', 'history', 'country', 'founded', 'parent_company',
    'current_status', 'vehicle_types', 'popular_models', 'ecu_information',
    'common_ecu_manufacturers', 'related_brands', 'seo_title', 'seo_description', 'faq', 'sources'
  ],
  requirements: {
    name: brandName,
    slug: brandSlug,
    sources: 'array of URLs used as evidence; include only sources actually relied upon',
    faq: 'array of {question, answer}; omit unsupported questions',
    technical_safety: 'omit uncertain ECU supplier/specification claims rather than guessing'
  }
};

if (dryRun) {
  console.log(JSON.stringify({ system, user }, null, 2));
  process.exit(0);
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
const raw = payload?.choices?.[0]?.message?.content;
if (!raw) {
  console.error('AI response did not contain message content.');
  process.exit(1);
}

let generated;
try {
  generated = JSON.parse(raw);
} catch (error) {
  console.error(`AI response was not valid JSON: ${error.message}`);
  process.exit(1);
}

const knownSlugs = new Set(brandsData.map((brand) => slugifyBrand(brand[3])));
const validation = validateBrandContent(generated, { expectedSlug: brandSlug, knownSlugs });
if (!validation.ok) {
  console.error('Generated candidate failed validation:');
  for (const message of validation.errors) console.error(`  - ${message}`);
  process.exit(1);
}

const outDir = path.join(process.cwd(), 'tmp', 'brand-candidates');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${brandSlug}.json`);
fs.writeFileSync(outFile, `${JSON.stringify(generated, null, 2)}\n`, 'utf-8');

console.log(`Candidate written to ${path.relative(process.cwd(), outFile)}`);
if (validation.warnings.length > 0) {
  console.warn('Review warnings before promotion:');
  for (const message of validation.warnings) console.warn(`  - ${message}`);
}
console.log('No production brand.json file was modified. Review the candidate manually before promotion.');
