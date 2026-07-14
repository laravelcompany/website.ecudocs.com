// rewrite.js — Core single-product rewrite engine
// Import this anywhere: Astro API routes, batch scripts, Express, etc.

import 'dotenv/config';
import axios from 'axios';

const CONFIG = {
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'https://ai.izdrail.com',
  MODEL: process.env.MODEL || 'mistral:7b',
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 3,
  PRICE_INCREMENT: parseInt(process.env.PRICE_INCREMENT) || 100,
  TEMPERATURE: parseFloat(process.env.TEMPERATURE) || 0.3,
  TIMEOUT_MS: parseInt(process.env.TIMEOUT_MS) || 120000,
};

// ─── Prompt ──────────────────────────────────────────────────────────────────

function buildPrompt(product) {
  const context = {
    name:          product.name          || '',
    price:         product.price         || '',
    brand:         product.brand         || '',
    category:      product.category      || '',
    description:   product.description   || '',
    technicalData: product.technicalData || {},
    sku:           product.sku           || product.productCode || '',
  };

  return `You are an expert ECU repair master technician and automotive SEO copywriter for a professional e-commerce site built with Astro.

### INPUT PRODUCT DATA:
${JSON.stringify(context, null, 2)}

### YOUR TASK:

1. **REWRITE TITLE**: Format as "[Primary Keyword] + [Vehicle] + [Engine] + [Brand] + [Part Numbers] + [Selling Point]"
   - Keep: Vehicle, Brand, ALL part numbers exactly as given
   - Add signals: "Plug & Play", "OEM Tested", "Warranty", "ECU Replacement"
   - Max 100 characters

2. **GENERATE SLUG**: URL-safe, hyphenated version of the title (lowercase, no special chars, max 80 chars)
   - Example: "plug-play-ecu-bmw-330d-m57-bosch-0281012345-tested"

3. **WRITE META DESCRIPTION**: 150–160 character SEO meta description for Google.

4. **REWRITE DESCRIPTION**: Structured HTML (no markdown, no code fences) with:
   <section class="overview"> — Expert overview, 2–3 sentences, technical & trustworthy tone
   <section class="features"> — <ul> of 5–6 key features with <li> elements
   <section class="specs"> — <table> of technical specifications from technicalData
   <section class="shipping"> — Shipping & warranty information (EU, 12-month warranty, fast dispatch)
   <section class="compatibility"> — Compatibility notes and fitment caution

5. **PRICE**: Add exactly +${CONFIG.PRICE_INCREMENT} EUR to the price value (e.g., €450.00 → €550.00)

6. **TAGS**: Array of 5–8 SEO keyword tags (strings). Examples: "ECU repair", "Plug & Play ECU", OEM part numbers, vehicle model.

7. **EXCERPT**: One punchy sentence (max 30 words) for product cards on listing pages.

### STRICT OUTPUT — Return ONLY valid JSON, no markdown fences, no commentary:
{
  "title": "...",
  "slug": "...",
  "metaDescription": "...",
  "price": "€XXX.XX",
  "excerpt": "...",
  "tags": ["...", "..."],
  "description": "<section class=\\"overview\\">...</section>..."
}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parsePrice(priceStr, increment = CONFIG.PRICE_INCREMENT) {
  const match = String(priceStr || '').match(/[\d,]+\.?\d*/);
  const base = match ? parseFloat(match[0].replace(',', '')) : 450;
  return `€${(base + increment).toFixed(2)}`;
}

function extractJSON(raw) {
  // Strip potential markdown code fences
  const cleaned = raw.replace(/```json|```/gi, '').trim();
  // Find outermost JSON object
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function safeSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 80);
}

// ─── Core API call ────────────────────────────────────────────────────────────

async function callModel(prompt, attempt = 0) {
  try {
    const res = await axios.post(
      `${CONFIG.OLLAMA_BASE_URL}/api/generate`,
      {
        model:   CONFIG.MODEL,
        prompt,
        stream:  false,
        options: { temperature: CONFIG.TEMPERATURE, num_predict: 2048 },
      },
      { timeout: CONFIG.TIMEOUT_MS }
    );

    const raw = res.data?.response?.trim();
    if (!raw) throw new Error('Empty response from model');
    return extractJSON(raw);

  } catch (err) {
    if (attempt < CONFIG.MAX_RETRIES) {
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(r => setTimeout(r, delay));
      return callModel(prompt, attempt + 1);
    }
    throw err;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Rewrite a single product for Astro content.
 *
 * @param {object} product  — Raw product object from your JSON source
 * @param {object} [opts]   — Optional overrides: { priceIncrement, model }
 * @returns {Promise<RewriteResult>}
 *
 * @typedef {object} RewriteResult
 * @property {string}   title
 * @property {string}   slug
 * @property {string}   metaDescription
 * @property {string}   price
 * @property {string}   excerpt
 * @property {string[]} tags
 * @property {string}   description   — Clean HTML, ready for Astro's set:html
 * @property {object}   _source       — Original product (reference)
 * @property {object}   _meta         — Processing metadata
 */
async function rewriteSingle(product, opts = {}) {
  const start = Date.now();
  const prompt = buildPrompt(product);
  const aiResult = await callModel(prompt);

  // Enforce our price rule regardless of what AI returned
  const price = parsePrice(product.price, opts.priceIncrement ?? CONFIG.PRICE_INCREMENT);

  // Guarantee a slug even if AI omits it
  const slug = aiResult.slug
    ? safeSlug(aiResult.slug)
    : safeSlug(aiResult.title || product.name || product.sku || 'ecu-product');

  return {
    title:           aiResult.title           || product.name,
    slug,
    metaDescription: aiResult.metaDescription || '',
    price:           aiResult.price           || price,
    excerpt:         aiResult.excerpt         || '',
    tags:            Array.isArray(aiResult.tags) ? aiResult.tags : [],
    description:     aiResult.description     || product.description || '',
    _source: product,
    _meta: {
      processedAt:    new Date().toISOString(),
      model:          opts.model ?? CONFIG.MODEL,
      durationMs:     Date.now() - start,
      priceIncrement: opts.priceIncrement ?? CONFIG.PRICE_INCREMENT,
    },
  };
}

export { rewriteSingle, parsePrice, safeSlug, CONFIG };

// ─── CLI Runner ───────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const args = process.argv.slice(2);
    if (args.length === 0) {
      console.error('Usage: node rewrite.js <product.json> [index]');
      console.error('       node rewrite.js <product.json> --batch');
      process.exit(1);
    }

    const productPath = args[0];
    const fs = await import('fs/promises');
    const path = await import('path');
    const data = JSON.parse(await fs.readFile(productPath, 'utf-8'));

    let products = Array.isArray(data) ? data : [data];
    const outputDir = path.join(process.cwd(), 'ai-ecus');
    await fs.mkdir(outputDir, { recursive: true });

    const isBatch = args.includes('--batch') || args.includes('-b');

    if (isBatch) {
      console.log(`Processing ${products.length} products...`);
      let succeeded = 0, failed = 0;

      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const productName = product.name || product.productCode || `product-${i}`;
        console.log(`[${i + 1}/${products.length}] Rewriting: ${productName}`);

        try {
          const result = await rewriteSingle(product);
          const outputPath = path.join(outputDir, `${result.slug}.json`);
          await fs.writeFile(outputPath, JSON.stringify(result, null, 2));
          console.log(`  → Saved: ${result.slug}.json`);
          succeeded++;
        } catch (err) {
          console.error(`  → FAILED: ${err.message}`);
          failed++;
        }

        if (i < products.length - 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      console.log(`\nDone! Succeeded: ${succeeded}, Failed: ${failed}`);
      process.exit(failed > 0 ? 1 : 0);
    }

    const index = args[1] ? parseInt(args[1]) : 0;
    if (index >= products.length) {
      console.error(`Index ${index} out of range. Total products: ${products.length}`);
      process.exit(1);
    }

    const product = products[index];
    console.log(`Rewriting product ${index}:`, product.name || product.productCode);
    const result = await rewriteSingle(product);

    const outputPath = path.join(outputDir, `${result.slug}.json`);
    await fs.writeFile(outputPath, JSON.stringify(result, null, 2));

    console.log(`Saved to: ${outputPath}`);
    console.log(JSON.stringify(result, null, 2));
  })();
}
