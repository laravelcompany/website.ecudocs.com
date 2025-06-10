import { defineCollection, z } from 'astro:content';

const automobiles = defineCollection({
  type: 'content',
  schema: z.object({
    name: z.string(),
    brand: z.string(),
  }),
});

const brands = defineCollection({
  type: 'content',
  schema: z.object({
    name: z.string(),
    url: z.string(),
    logo: z.string(),
  }),
});

export const collections = {
  'automobiles': automobiles,
  'brands': brands,
};

///"id","url_hash","url","brand_id","name","description","engine_id","engine_name","created_at","updated_at","no_data"