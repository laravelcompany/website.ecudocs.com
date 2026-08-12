# Brand Content Pipeline

This repository keeps `src/data/brands.json` as the legacy manufacturer index and adds optional structured enrichment per manufacturer in:

`src/data/<brand-slug>/brand.json`

## Design goals

- preserve existing manufacturer URLs and the current JSON-driven architecture;
- render enrichment only when data exists;
- avoid empty UI sections;
- keep static generation and avoid unnecessary client-side JavaScript;
- separate generated candidates from reviewed production data;
- require source provenance for technical claims whenever possible;
- omit uncertain ECU details instead of guessing.

## Enriched brand shape

Each `brand.json` may contain:

- `name`
- `slug`
- `description`
- `history`
- `country`
- `founded`
- `parent_company`
- `current_status`
- `vehicle_types`
- `popular_models`
- `ecu_information`
- `common_ecu_manufacturers`
- `related_brands`
- `seo_title`
- `seo_description`
- `faq`
- `sources`

Only `name` and `slug` are required by the validator. Optional fields should be omitted when reliable data is unavailable.

## Validation

Run:

```bash
npm run validate:brands
```

The validator checks JSON shape, slug consistency, plausible founded year, array fields, FAQ entries, SEO lengths and missing source provenance for technical ECU content. Warnings are review signals; validation errors fail with exit code 1.

## Recommended AI-assisted workflow

AI should not write directly into production files.

Recommended process:

```text
legacy brand + existing model/resources
        ↓
AI generates candidate JSON
        ↓
source/fact review
        ↓
validator
        ↓
manual promotion to src/data/<slug>/brand.json
        ↓
Astro build
```

A provider-specific generator can be added later, but the production schema and validator are intentionally provider-neutral. This avoids coupling content maintenance to a single AI vendor.

### Generation rules

The prompt or generation layer should instruct the model to:

1. use only manufacturer-specific facts;
2. omit facts it cannot support;
3. never invent ECU part numbers, protocols, pinouts or compatibility;
4. use existing ECU Docs model/manual/pinout data where available;
5. return structured JSON only;
6. provide source URLs used to ground factual or technical claims;
7. avoid repetitive SEO copy between brands.

## Adding a manufacturer enrichment

1. Confirm the manufacturer already exists in `src/data/brands.json`.
2. Use the same normalized slug used by the existing manufacturer route.
3. Add or update `src/data/<slug>/brand.json`.
4. Run `npm run validate:brands`.
5. Run `npm run build`.
6. Review the rendered manufacturer page and internal links before committing.

Adding enrichment never requires creating another Astro page. The generic manufacturer template consumes the optional JSON data.
