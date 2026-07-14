// astro-integration.examples.js — Ready-to-paste code for your Astro project
// Copy these into your Astro project as needed

// ──────────────────────────────────────────────────────────────────────────────
// FILE: src/content/config.ts
// ──────────────────────────────────────────────────────────────────────────────

import { defineCollection, z } from 'astro:content';

const products = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    price: z.string(),
    metaDescription: z.string().max(160),
    excerpt: z.string().max(100),
    tags: z.array(z.string()),
    sku: z.string(),
    publishedAt: z.string().or(z.date()),
  }),
});

export const collections = {
  products,
};

// ──────────────────────────────────────────────────────────────────────────────
// FILE: src/pages/products/[slug].astro
// ──────────────────────────────────────────────────────────────────────────────

import { getCollection } from 'astro:content';

export async function getStaticPaths() {
  const products = await getCollection('products');
  return products.map((product) => ({
    params: { slug: product.slug },
    props: { product },
  }));
}

const { product } = Astro.props;
const { Content } = await product.render();

const schemaMarkup = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: product.data.title,
  description: product.data.metaDescription,
  offers: {
    '@type': 'Offer',
    price: product.data.price,
    priceCurrency: 'EUR',
  },
};
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{product.data.title} | ECU Parts</title>
    <meta name="description" content={product.data.metaDescription} />
    <link rel="canonical" href={Astro.url.href} />
    <script type="application/ld+json" set:html={JSON.stringify(schemaMarkup)} />
  </head>
  <body>
    <main class="product-page">
      <header>
        <h1>{product.data.title}</h1>
        <p class="price">{product.data.price}</p>
        <p class="sku">SKU: {product.data.sku}</p>
      </header>

      <article>
        <Content />
      </article>

      <footer>
        <div class="tags">
          {product.data.tags.map((tag) => (
            <span class="tag">{tag}</span>
          ))}
        </div>
      </footer>
    </main>
  </body>
</html>

<style>
  .product-page {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
  }
  .price {
    font-size: 1.5rem;
    font-weight: bold;
    color: #22c55e;
  }
  .sku {
    color: #6b7280;
    font-size: 0.875rem;
  }
  .tag {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    margin: 0.25rem;
    background: #f3f4f6;
    border-radius: 0.25rem;
    font-size: 0.75rem;
  }
</style>

// ──────────────────────────────────────────────────────────────────────────────
// FILE: src/components/ProductCard.astro
// ──────────────────────────────────────────────────────────────────────────────

---
interface Props {
  title: string;
  slug: string;
  price: string;
  excerpt: string;
  tags: string[];
}

const { title, slug, price, excerpt, tags } = Astro.props;
---

<article class="product-card">
  <a href={`/products/${slug}`}>
    <h2>{title}</h2>
    <p class="price">{price}</p>
    <p class="excerpt">{excerpt}</p>
    <div class="tags">
      {tags.slice(0, 3).map((tag) => (
        <span class="tag">{tag}</span>
      ))}
    </div>
  </a>
</article>

<style>
  .product-card {
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 1rem;
    transition: box-shadow 0.2s;
  }
  .product-card:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
  .product-card a {
    text-decoration: none;
    color: inherit;
  }
  h2 {
    font-size: 1.125rem;
    margin: 0 0 0.5rem;
  }
  .price {
    font-weight: bold;
    color: #22c55e;
  }
  .excerpt {
    color: #6b7280;
    font-size: 0.875rem;
  }
  .tag {
    font-size: 0.75rem;
    padding: 0.125rem 0.375rem;
    background: #f3f4f6;
    border-radius: 0.25rem;
    margin-right: 0.25rem;
  }
</style>

// ──────────────────────────────────────────────────────────────────────────────
// FILE: src/pages/api/rewrite.ts (Astro SSR API Route)
// ──────────────────────────────────────────────────────────────────────────────

import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { product, options } = body;

    if (!product) {
      return new Response(JSON.stringify({ error: 'product is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const response = await fetch('http://localhost:3001/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product, options }),
    });

    const data = await response.json();
    
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config = {
  runtime: 'node',
};

// ──────────────────────────────────────────────────────────────────────────────
// EXAMPLE: Using in your admin panel to trigger a rewrite
// ──────────────────────────────────────────────────────────────────────────────

/*
async function triggerRewrite(productId) {
  const response = await fetch('/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product: { id: productId, /* ... product data *\/ }
    })
  });
  
  const result = await response.json();
  console.log('Rewrite result:', result);
}
*/

// ──────────────────────────────────────────────────────────────────────────────
// EXAMPLE: Batch rewrite with polling
// ──────────────────────────────────────────────────────────────────────────────

/*
async function batchRewrite(products) {
  // Start batch job
  const response = await fetch('http://localhost:3001/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      products,
      outputDir: './src/content/products'
    })
  });
  
  const { jobId } = await response.json();
  console.log('Started batch job:', jobId);
  
  // Poll for status
  while (true) {
    await new Promise(r => setTimeout(r, 2000));
    
    const statusRes = await fetch(`http://localhost:3001/batch/${jobId}`);
    const status = await statusRes.json();
    
    console.log(`Progress: ${status.progress.percentage}%`);
    
    if (status.status === 'completed') {
      console.log('Batch complete!', status.written);
      break;
    }
    
    if (status.status === 'failed') {
      console.error('Batch failed:', status.error);
      break;
    }
  }
}
*/

export default null;
