import { z } from 'zod';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const faqItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

const countOrDescription = z.union([
  z.number().int().nonnegative(),
  z.string().min(1),
]);

export const brandSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  logo: z.string().url().optional(),
  productionModels: countOrDescription.optional(),
  discontinuedModels: countOrDescription.optional(),
  slug: z.string().regex(SLUG_PATTERN).optional(),
  history: z.string().optional(),
  country: z.string().optional(),
  founded: z.number().int().min(1800).optional(),
  parent_company: z.string().optional(),
  current_status: z.string().optional(),
  vehicle_types: z.array(z.string().min(1)).optional(),
  popular_models: z.array(z.string().min(1)).optional(),
  ecu_information: z.string().optional(),
  common_ecu_manufacturers: z.array(z.string().min(1)).optional(),
  related_brands: z.array(z.string().regex(SLUG_PATTERN)).optional(),
  seo_title: z.string().optional(),
  seo_description: z.string().optional(),
  faq: z.array(faqItemSchema).optional(),
});

export function parseBrand(data) {
  return brandSchema.safeParse(data);
}

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '');
}
