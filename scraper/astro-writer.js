import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function buildFrontmatter(data) {
  const fm = {
    title: data.title,
    slug: data.slug,
    price: data.price,
    metaDescription: data.metaDescription,
    excerpt: data.excerpt,
    tags: data.tags || [],
    sku: data.sku || data._source?.sku || '',
    publishedAt: data.publishedAt || new Date().toISOString().split('T')[0],
  };

  const lines = Object.entries(fm).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}: ${JSON.stringify(value)}`;
    }
    return `${key}: ${JSON.stringify(value)}`;
  });

  return '---\n' + lines.join('\n') + '\n---';
}

export function buildMdxContent(data) {
  const frontmatter = buildFrontmatter(data);
  const content = data.description || '';
  return frontmatter + '\n\n' + content;
}

export async function writeMdx(product, outputDir, data) {
  await ensureDir(outputDir);
  
  const filename = `${data.slug}.mdx`;
  const filepath = path.join(outputDir, filename);
  const content = buildMdxContent(data);
  
  await fs.writeFile(filepath, content, 'utf-8');
  return filepath;
}

export async function writeBatch(results, outputDir, options = {}) {
  const { onFile } = options;
  const written = [];
  
  for (const result of results) {
    if (!result.success) {
      written.push({ success: false, error: result.error, product: result.original });
      continue;
    }
    
    try {
      const filepath = await writeMdx(result.original, outputDir, result.rewritten);
      written.push({ success: true, filepath, slug: result.rewritten.slug });
      
      if (onFile) {
        onFile({ slug: result.rewritten.slug, filepath });
      }
    } catch (err) {
      written.push({ success: false, error: err.message, product: result.original });
    }
  }
  
  return written;
}

export function generateSchema() {
  return `import { z } from 'astro:content';

export const productSchema = z.object({
  title: z.string(),
  slug: z.string(),
  price: z.string(),
  metaDescription: z.string().max(160),
  excerpt: z.string().max(100),
  tags: z.array(z.string()),
  sku: z.string(),
  publishedAt: z.string().or(z.date()),
});

export type Product = z.infer<typeof productSchema>;
`;
}

export async function writeSchemaConfig(outputPath) {
  const schema = generateSchema();
  await fs.writeFile(outputPath, schema, 'utf-8');
  return outputPath;
}

export default {
  ensureDir,
  buildFrontmatter,
  buildMdxContent,
  writeMdx,
  writeBatch,
  generateSchema,
  writeSchemaConfig,
};
