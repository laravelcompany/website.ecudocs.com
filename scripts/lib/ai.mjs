import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const DEEPSEEK_DEFAULTS = {
  baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  temperature: Number(process.env.DEEPSEEK_TEMPERATURE ?? 0.2),
  maxTokens: Number(process.env.DEEPSEEK_MAX_TOKENS ?? 4000),
};

export const ENRICHABLE_FIELDS = [
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
];

export const NEVER_AI_FIELDS = ['name', 'slug', 'description', 'logo', 'productionModels', 'discontinuedModels'];

const SYSTEM_PROMPT = `You are an automotive technical documentation specialist for EcuDocs.com, a database of ECU (engine control unit) documentation, wiring diagrams, pinouts, and technical specifications.

STRICT SAFETY RULES:
- NEVER invent facts. If a fact cannot be established with reasonable confidence, OMIT that field entirely.
- NEVER fabricate: ECU part numbers, ECU compatibility, ECU specifications, engine codes, diagnostic protocols, pinouts, technical capabilities, vehicle compatibility, production dates, or historical claims.
- For the ecu_information and common_ecu_manufacturers fields, only provide broad, well-established information. If unsure, omit the field.
- Never output empty strings for any field. If you do not know a value, omit the key.
- Never invent model names.
- Output ONLY valid JSON. No markdown, no code fences, no commentary before or after the JSON, no trailing commas.`;

export function buildUserPrompt({ brand, wanted, knownModels }) {
  const sections = [
    '# Task',
    'Generate the missing fields for the automobile manufacturer described below. Fill ONLY the fields listed under "Fields to generate". Preserve the existing data exactly — do not repeat, paraphrase, or replace values that already exist.',
    '',
    '# Existing brand data (AUTHORITATIVE — do not change these values)',
    '```json',
    JSON.stringify(brand, null, 2),
    '```',
    '',
  ];

  if (knownModels && knownModels.length > 0) {
    sections.push(
      '# Known model names for this manufacturer (use these as popular_models where appropriate)',
      JSON.stringify(knownModels, null, 2),
      '',
    );
  }

  sections.push(
    '# Fields to generate',
    wanted.join(', '),
    '',
    '# Field guidance',
    '- history: concise, factual manufacturer history. No marketing fluff, no superlatives, no "pioneering"/"revolutionary" filler.',
    '- country: country of the manufacturer headquarters.',
    '- founded: year the manufacturer was founded (integer, 1800 or later).',
    '- parent_company: current parent company or group, e.g. "Stellantis", "Volkswagen Group". Omit if none.',
    '- current_status: one of active | defunct | inactive | discontinued | bankrupt | sold | merged | revived.',
    '- vehicle_types: array of broad categories (e.g. "Passenger cars", "SUVs", "Commercial vehicles").',
    '- popular_models: array of real, stable model names. Use the known model list where it is reliable; omit otherwise.',
    '- ecu_information: ONLY broad, reliable, publicly-known ECU context (e.g. which well-known ECU manufacturers commonly supply this brand). No part numbers, no pinouts, no protocol claims unless certain. Omit if not confident.',
    '- common_ecu_manufacturers: array of well-known ECU supplier names ONLY when confident (e.g. Bosch, Continental, Denso, Delphi, Keihin, Siemens VDO). Omit if unsupported.',
    '- related_brands: array of slug strings (lowercase, hyphenated) for clearly related brands only (same group or direct history). Omit if none.',
    '- seo_title: under 70 characters, includes the brand name and "ECU Documentation".',
    '- seo_description: under 160 characters, factual, describes the documentation the site provides for this brand.',
    '- faq: array of 0-3 objects { "question", "answer" } with genuinely useful, factually safe Q&A. No fabricated specs. Empty/uncertain questions should be omitted, not invented.',
    '',
    '# Rules',
    '- Do NOT include name, slug, description, logo, productionModels, or discontinuedModels in the output.',
    '- Omit any field you are not confident about.',
    '- Avoid generic filler and repetitive wording across different manufacturers.',
    '- Return valid JSON only.',
  );

  return sections.join('\n');
}

export function buildProvider({ provider }) {
  if (provider === 'mock') {
    return { name: 'mock', model: 'mock', async generate({ brand, wanted, knownModels }) {
      return mockGenerate(brand, wanted, knownModels);
    } };
  }
  if (provider === 'deepseek') {
    if (!DEEPSEEK_DEFAULTS.apiKey) {
      throw new Error('DEEPSEEK_API_KEY is required for the deepseek provider. Set it in .env or pass --provider mock for offline pipeline testing.');
    }
    return {
      name: 'deepseek',
      model: DEEPSEEK_DEFAULTS.model,
      async generate({ brand, wanted, knownModels }) {
        const content = await deepseekChat({
          system: SYSTEM_PROMPT,
          user: buildUserPrompt({ brand, wanted, knownModels }),
        });
        return parseModelJson(content);
      },
    };
  }
  throw new Error(`Unknown provider "${provider}". Use "deepseek" or "mock".`);
}

export function mockGenerate(brand, wanted, knownModels) {
  const out = {};
  const name = String(brand.name || '').trim() || 'This manufacturer';

  if (wanted.includes('history')) {
    out.history = `${name} conducts an automated brand-content enrichment pipeline test. This synthetic record verifies response parsing, schema validation, quality checks, and safe file output. It must never be promoted to production content.`;
  }
  if (wanted.includes('country')) out.country = 'Synthetic country';
  if (wanted.includes('founded')) out.founded = 1950;
  if (wanted.includes('current_status')) out.current_status = 'active';
  if (wanted.includes('vehicle_types')) out.vehicle_types = ['Passenger cars'];
  if (wanted.includes('popular_models')) {
    const models = (knownModels || []).filter((m) => typeof m === 'string').slice(0, 5);
    out.popular_models = models.length > 0 ? models : ['Synthetic mock model'];
  }
  if (wanted.includes('seo_title')) {
    out.seo_title = `${name} ECU Documentation | Synthetic Test | EcuDocs.com`.slice(0, 70);
  }
  if (wanted.includes('seo_description')) {
    out.seo_description = `Synthetic ${name} ECU documentation record for pipeline verification. Not production content.`.slice(0, 160);
  }
  return out;
}

export async function deepseekChat({ system, user }) {
  const { baseUrl, model, apiKey, temperature, maxTokens } = DEEPSEEK_DEFAULTS;

  let res;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    throw new Error(`DeepSeek network error: ${err.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`DeepSeek API ${res.status}: ${sanitizeErrorBody(body) || res.statusText}`);
  }

  const data = await res.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('DeepSeek returned no message content.');
  }
  return content;
}

function sanitizeErrorBody(body) {
  if (!body) return '';
  return String(body).replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}

export function parseModelJson(content) {
  let text = String(content).trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/m, '').trim();

  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {
    /* fall through to brace extraction */
  }

  const start = text.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
      } else if (c === '{') {
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            const sliced = text.slice(start, i + 1);
            const data = JSON.parse(sliced);
            if (data && typeof data === 'object' && !Array.isArray(data)) return data;
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error('Could not parse a JSON object from the model output.');
}

export function loadKnownModels(brandDir) {
  const file = path.join(brandDir, 'models.json');
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    if (!Array.isArray(data)) return [];
    return data.map((m) => m?.name).filter((n) => typeof n === 'string' && n.trim().length > 0);
  } catch {
    return [];
  }
}