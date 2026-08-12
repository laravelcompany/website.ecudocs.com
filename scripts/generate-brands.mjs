import 'dotenv/config';
import { readFileSync, readdirSync, existsSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseBrand } from '../src/lib/brand-schema.js';
import { buildProvider, ENRICHABLE_FIELDS, NEVER_AI_FIELDS, loadKnownModels } from './lib/ai.mjs';
import { checkQuality } from './lib/quality.mjs';

const DATA_DIR = path.join(process.cwd(), 'src', 'data');
const DEFAULT_OUT = path.join(process.cwd(), 'brands.generated.json');
const DEFAULT_LOG = path.join(process.cwd(), 'brands.generation.log.jsonl');

function parseArgs(argv) {
  const args = { limit: Infinity, brands: [], provider: null, retries: 2, out: null, log: null, force: false, dryRun: false, debug: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--limit') args.limit = Number(next()) || Infinity;
    else if (a === '--brand') {
      const raw = next();
      for (const b of raw.split(',')) {
        const s = b.trim();
        if (s) args.brands.push(s);
      }
    } else if (a === '--provider') args.provider = next();
    else if (a === '--retries') args.retries = Number(next()) || 0;
    else if (a === '--out') args.out = next();
    else if (a === '--log') args.log = next();
    else if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--debug') args.debug = true;
    else if (a === '--help') args.help = true;
  }
  return args;
}

function resolveProvider(preferred) {
  if (preferred) return preferred;
  if (process.env.DEEPSEEK_API_KEY) return 'deepseek';
  return 'mock';
}

function listBrandSlugs() {
  const slugs = [];
  for (const entry of readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (existsSync(path.join(DATA_DIR, entry.name, 'brand.json'))) slugs.push(entry.name);
  }
  return slugs.sort();
}

function missingFields(brand) {
  return ENRICHABLE_FIELDS.filter((f) => brand[f] == null || String(brand[f]).trim() === '');
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let seq = 0;

function log(jsonlPath, entry) {
  try {
    appendFileSync(jsonlPath, `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch (err) {
    console.error(`[log] failed to write log line: ${err.message}`);
  }
}

async function processBrand({ slug, providerImpl, existingBrand, knownModels, allResults, args, logPath }) {
  seq += 1;
  const wanted = args.force ? ENRICHABLE_FIELDS.slice() : missingFields(existingBrand);

  if (wanted.length === 0) {
    console.log(`  - ${slug}: nothing to enrich (all enrichable fields present). Skipped.`);
    log(logPath, {
      log: 'brand',
      slug, status: 'skipped', provider: providerImpl.name, timestamp: new Date().toISOString(),
      reason: 'nothing to enrich',
    });
    return;
  }

  if (args.dryRun) {
    console.log(`  - ${slug} (${args.dryRun ? 'dry-run' : ''}): would generate fields → ${wanted.join(', ')}`);
    return;
  }

  let attempts = 0;
  let seeded = null;
  while (attempts <= args.retries) {
    attempts++;
    try {
      seeded = await providerImpl.generate({ brand: existingBrand, wanted, knownModels });
      break;
    } catch (err) {
      console.error(`  - ${slug}: attempt ${attempts} failed (${err.message}); retrying...`);
      if (attempts > args.retries) {
        const entry = {
          log: 'brand',
          slug, status: 'failed', provider: providerImpl.name, attempts, retries: args.retries,
          error: err.message, timestamp: new Date().toISOString(),
        };
        log(logPath, entry);
        allResults.push({
          slug, status: 'failed', errors: [err.message], warnings: [], draft: null, brand: null,
          meta: { provider: providerImpl.name, attempts, generatedAt: new Date().toISOString(), source: args.mockSource },
        });
        return;
      }
      await wait(1000 * 2 ** (attempts - 1));
    }
  }

  const draft = Object.fromEntries(Object.entries(seeded || {}).filter(([k]) => wanted.includes(k)));
  const seededErrors = [];
  for (const key of NEVER_AI_FIELDS) {
    if (draft[key] != null) {
      seededErrors.push(`model returned disallowed field "${key}" — discarded`);
      delete draft[key];
    }
  }

  const draftBrand = { name: existingBrand.name, description: existingBrand.description, ...draft };
  const schemaDraft = parseBrand(draftBrand);
  if (!schemaDraft.success) {
    const issues = schemaDraft.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    const errors = [...seededErrors, `schema: ${issues.join('; ')}`];
    log(logPath, { log: 'brand', slug, status: 'failed', provider: providerImpl.name, attempts, retries: args.retries, error: errors.join(' | '), timestamp: new Date().toISOString() });
    allResults.push({ slug, status: 'failed', errors, warnings: [], draft, brand: null, meta: { provider: providerImpl.name, attempts, generatedAt: new Date().toISOString(), source: args.mockSource } });
    return;
  }

  const draftQuality = checkQuality(draftBrand, { scope: 'draft' });
  if (!draftQuality.ok) {
    const errors = [...seededErrors, `quality: ${draftQuality.errors.join('; ')}`];
    log(logPath, { log: 'brand', slug, status: 'failed', provider: providerImpl.name, attempts, retries: args.retries, error: errors.join(' | '), warnings: draftQuality.warnings, timestamp: new Date().toISOString() });
    allResults.push({ slug, status: 'failed', errors, warnings: draftQuality.warnings, draft, brand: null, meta: { provider: providerImpl.name, attempts, generatedAt: new Date().toISOString(), source: args.mockSource } });
    return;
  }

  const merged = { ...existingBrand, ...draft };
  const mergedSchema = parseBrand(merged);
  const mergedQuality = checkQuality(merged, { scope: 'merged' });

  if (!mergedSchema.success) {
    const issues = mergedSchema.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    const errors = [...seededErrors, `merged schema: ${issues.join('; ')}`];
    log(logPath, { log: 'brand', slug, status: 'failed', provider: providerImpl.name, attempts, retries: args.retries, error: errors.join(' | '), timestamp: new Date().toISOString() });
    allResults.push({ slug, status: 'failed', errors, warnings: mergedQuality.warnings, draft, brand: null, meta: { provider: providerImpl.name, attempts, generatedAt: new Date().toISOString(), source: args.mockSource } });
    return;
  }

  const warnings = [...draftQuality.warnings, ...mergedQuality.warnings];
  const entry = {
    log: 'brand',
    slug, status: 'ok', provider: providerImpl.name, attempts, retries: args.retries,
    fields: Object.keys(draft), warningsCount: warnings.length, error: null, timestamp: new Date().toISOString(),
  };
  log(logPath, entry);

  console.log(`  + ${slug}: OK (fields: ${Object.keys(draft).join(', ') || 'none'})${warnings.length ? ` — ${warnings.length} warning(s), review needed` : ''}`);

  allResults.push({
    slug,
    status: 'ok',
    errors: [],
    warnings,
    draft,
    brand: merged,
    meta: {
      provider: providerImpl.name,
      model: providerImpl.model,
      attempts,
      generatedAt: new Date().toISOString(),
      source: args.mockSource,
    },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`Usage: node scripts/generate-brands.mjs [options]

Options:
  --limit <n>          Process at most n brands (in slug order). Default: all.
  --brand <slug>       Process a specific brand (repeatable or comma-separated).
  --provider <name>    deepseek | mock. Default: deepseek if DEEPSEEK_API_KEY is set, else mock.
  --retries <n>        Retry attempts for failed AI requests per brand. Default: 2.
  --force              Allow regenerating fields that already exist. Default: only fill missing fields.
  --out <file>         Output file for generated records. Default: brands.generated.json
  --log <file>         JSONL log file for per-brand results. Default: brands.generation.log.jsonl
  --dry-run            Validate configuration and list intended work without calling the AI.
  --debug              Print extra diagnostics.
  --help               Show this help.`);
    return;
  }

  const outPath = args.out || DEFAULT_OUT;
  const logPath = args.log || DEFAULT_LOG;
  const providerName = resolveProvider(args.provider);
  const isMock = providerName === 'mock';
  args.mockSource = isMock ? 'mock-test-data' : 'deepseek';

  if (isMock) {
    console.warn('WARNING: DEEPSEEK_API_KEY is not set (or --provider mock was requested).');
    console.warn('Using the MOCK provider. Mock records are synthetic test data and are NEVER promotable.');
    console.warn('');
  }

  const providerImpl = buildProvider({ provider: providerName });
  const slugs = listBrandSlugs();
  const selected = args.brands.length > 0 ? slugs.filter((s) => args.brands.includes(s)) : slugs;
  const toProcess = selected.slice(0, args.limit);

  if (args.brands.length > 0) {
    const missing = args.brands.filter((s) => !slugs.includes(s));
    if (missing.length > 0) {
      console.error(`Unknown brand slugs: ${missing.join(', ')}. Available: ${slugs.join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`Provider: ${providerName}${isMock ? ' (mock)' : ` (${providerImpl.model})`}`);
  console.log(`Brands to process: ${toProcess.length}${args.limit !== Infinity ? ` (limit ${args.limit})` : ''}`);
  console.log(`Force regenerate: ${args.force ? 'yes' : 'no'}`);
  console.log(`Output: ${args.dryRun ? '(dry-run, nothing written)' : outPath}`);
  console.log(`Log:    ${logPath}`);
  console.log('');

  if (toProcess.length === 0) {
    console.log('No brands to process.');
    return;
  }

  if (args.dryRun) {
    for (const slug of toProcess) {
      const brandFile = path.join(DATA_DIR, slug, 'brand.json');
      const existing = JSON.parse(readFileSync(brandFile, 'utf-8'));
      const wanted = args.force ? ENRICHABLE_FIELDS.slice() : missingFields(existing);
      console.log(`  - ${slug}: wants [${wanted.length ? wanted.join(', ') : 'nothing (skip)'}]`);
    }
    console.log('\nDry run complete. No AI calls made, nothing written.');
    return;
  }

  mkdirSync(path.dirname(outPath), { recursive: true });

  if (existsSync(outPath)) {
    console.log(`Removing previous output file: ${outPath}\n`);
    try { writeFileSync(outPath, '', 'utf-8'); } catch { /* ok */ }
  }

  const allResults = [];
  let hardFailures = 0;
  let skipped = 0;

  for (const slug of toProcess) {
    console.log(`Processing: ${slug}`);
    const brandDir = path.join(DATA_DIR, slug);
    const brandFile = path.join(brandDir, 'brand.json');
    let existingBrand;
    try {
      existingBrand = JSON.parse(readFileSync(brandFile, 'utf-8'));
    } catch (err) {
      console.error(`  ! ${slug}: cannot read brand.json (${err.message}). Skipping.`);
      hardFailures++;
      continue;
    }
    const knownModels = loadKnownModels(brandDir);
    const before = allResults.length;
    try {
      await processBrand({ slug, providerImpl, existingBrand, knownModels, allResults, args, logPath });
    } catch (err) {
      console.error(`  ! ${slug}: unexpected error (${err.message}).`);
      hardFailures++;
      continue;
    }
    if (allResults.length === before) skipped++;
  }

  const succeeded = allResults.filter((r) => r.status === 'ok').length;
  const failed = allResults.filter((r) => r.status === 'failed').length + hardFailures;

  if (!args.dryRun) {
    writeFileSync(outPath, JSON.stringify(allResults, null, 2), 'utf-8');
  }

  console.log('');
  console.log('--- Summary ---');
  console.log(`Brands processed:  ${toProcess.length}`);
  console.log(`Successful:        ${succeeded}`);
  console.log(`Failed:            ${failed}`);
  console.log(`Skipped:           ${skipped} (already complete or cannot be read)`);
  const failedRecords = allResults.filter((r) => r.status === 'failed');
  if (failedRecords.length > 0) {
    console.log('\nFailed records:');
    for (const f of failedRecords) console.log(`  ${f.slug}: ${f.errors.join('; ')}`);
  }
  if (!args.dryRun) {
    console.log(`\nGenerated output written to: ${outPath}`);
    console.log(`Log written to: ${logPath}`);
    console.log('\nReview brands.generated.json, then promote accepted records with:');
    console.log('  npm run promote:brands             # validates + previews the generated records');
    console.log('  npm run promote:brands -- --apply  # writes accepted records to src/data/<slug>/brand.json');
  }

  if (succeeded === 0 && !args.dryRun) process.exit(1);
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});