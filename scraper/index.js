import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';

const BASE_URL = 'https://auto24parts.com/en_GB/c/ECU-Engine-control-unit/624';
const OUTPUT_FILE = 'products.json';
const DELAY_MS = 2000;
const MAX_RETRIES = 3;
const MAX_PAGES = 426;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const randomDelay = (min = 1500, max = 3000) => {
  return sleep(Math.floor(Math.random() * (max - min + 1)) + min);
};

const fetchPage = async (pageNum, retryCount = 0) => {
  const url = pageNum === 1 ? BASE_URL : `${BASE_URL}/${pageNum}`;
  console.log(`Fetching ${url}...`);

  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      },
      timeout: 30000,
    });
    return data;
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.log(`Retry ${retryCount + 1}/${MAX_RETRIES} for ${url} after error: ${error.message}`);
      await sleep(3000 * (retryCount + 1));
      return fetchPage(pageNum, retryCount + 1);
    }
    throw error;
  }
};

const extractProducts = (html) => {
  const $ = cheerio.load(html);
  const products = [];

  $('.product-main-wrap').each((i, el) => {
    const $el = $(el);

    const name = $el.find('.productname, .product-name, .name, .title').first().text().trim() ||
                 $el.find('.prodimage').attr('title')?.trim() || '';

    let price = $el.find('.price, .product-price, [class*="price"]').first().text().trim();
    if (price) {
      const priceMatch = price.match(/€\s*[\d,]+\.?\d*/);
      price = priceMatch ? priceMatch[0].replace(/\s/g, '') : null;
    }

    const link = $el.find('.prodimage').attr('href');
    const fullLink = link ? `https://auto24parts.com${link}` : null;

    if (name) {
      products.push({
        name: name.replace(/\s+/g, ' ').trim(),
        price: price,
        link: fullLink,
      });
    }
  });

  return products;
};

let totalPages = null;

const hasNextPage = (html, currentPage) => {
  const $ = cheerio.load(html);

  if (totalPages === null) {
    const pageLinks = $('a[href*="/624/"]').map((i, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(/\/624\/(\d+)/);
      return match ? parseInt(match[1]) : 0;
    }).get();
    totalPages = Math.max(...pageLinks.filter(p => p > 0), 1);
    console.log(`Total pages detected: ${totalPages}`);
  }

  return currentPage < totalPages;
};

const scrapeAll = async () => {
  let allProducts = [];
  let page = 1;
  let hasMore = true;
  let consecutiveEmpty = 0;

  while (hasMore) {
    if (page > MAX_PAGES) {
      console.log(`Reached max pages limit (${MAX_PAGES})`);
      break;
    }

    const html = await fetchPage(page);
    const products = extractProducts(html);

    if (products.length === 0) {
      consecutiveEmpty++;
      console.log(`No products on page ${page} (empty: ${consecutiveEmpty})`);

      if (consecutiveEmpty >= 3) break;
    } else {
      consecutiveEmpty = 0;
      allProducts = allProducts.concat(products);
      console.log(`Page ${page}: ${products.length} products (total: ${allProducts.length})`);
    }

    hasMore = hasNextPage(html, page);
    page++;

    if (hasMore) await randomDelay();
  }

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(allProducts, null, 2));
  console.log(`\nDone! Extracted ${allProducts.length} products total.`);
  console.log(`Results saved to ${OUTPUT_FILE}`);

  return allProducts;
};

scrapeAll().catch(console.error);
