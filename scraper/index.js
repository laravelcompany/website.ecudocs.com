import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';

const BASE_URL = 'https://auto24parts.com/en_GB/c/ECU-Engine-control-unit/624';
const OUTPUT_FILE = 'products.json';
const OUTPUT_DETAILS_FILE = 'products-with-details.json';
const INPUT_FILE = 'products.json';
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

const fetchProductPage = async (url, retryCount = 0) => {
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
      return fetchProductPage(url, retryCount + 1);
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

const extractProductDetails = (html) => {
  const $ = cheerio.load(html);
  const details = {};

  const name = $('h1[itemprop="name"]').text().trim() ||
               $('h1.name').text().trim() ||
               $('h1').first().text().trim();
  details.name = name.replace(/\s+/g, ' ').trim();

  const price = $('em.main-price').first().text().trim() ||
                $('[itemprop="price"]').first().text().trim() ||
                $('[class*="price"]').first().text().trim();
  const priceMatch = price ? price.match(/€\s*[\d,]+\.?\d*/) : null;
  details.price = priceMatch ? priceMatch[0].replace(/\s/g, '') : null;

  const priceCurrency = $('[itemprop="priceCurrency"]').attr('content') || 'EUR';
  details.priceCurrency = priceCurrency;

  const netPrice = $('em.main-price').parent().next('.price-netto').find('.main-price').text().trim();
  const netPriceMatch = netPrice ? netPrice.match(/€\s*[\d,]+\.?\d*/) : null;
  details.netPrice = netPriceMatch ? netPriceMatch[0].replace(/\s/g, '') : null;

  details.category = $('meta[itemprop="category"]').attr('content') || null;

  details.brand = $('meta[itemprop="brand"]').attr('content') ||
                  $('.manufacturer a.brand').text().trim() ||
                  $('div.manufacturer em').next('a').text().trim() || null;

  details.productCode = $('div.code span').text().trim() || null;
  details.sku = $('meta[itemprop="sku"]').attr('content') || null;

  const availabilityText = $('div.availability .second').text().trim();
  details.availability = availabilityText || null;

  const deliveryText = $('span.lowest-cost').text().trim();
  const deliveryCountry = $('span.lowest-cost-shipping-country').text().trim();
  details.shipping = {
    cost: deliveryText || null,
    country: deliveryCountry || null
  };

  details.description = $('#offer-short-en').html() || null;

  const imageLinks = [];
  const mainImg = $('div.mainimg a#prodimg254257');
  if (mainImg.length) {
    const href = mainImg.attr('href');
    const fullImgUrl = href ? `https://auto24parts.com${href}` : null;
    if (fullImgUrl) imageLinks.push(fullImgUrl);
  }
  $('div.smallgallery a').each((i, el) => {
    const href = $(el).attr('href');
    if (href) {
      const fullImgUrl = `https://auto24parts.com${href}`;
      if (!imageLinks.includes(fullImgUrl)) {
        imageLinks.push(fullImgUrl);
      }
    }
  });
  details.images = imageLinks;

  details.technicalData = {};
  $('table.table tbody tr').each((i, el) => {
    const $el = $(el);
    const key = $el.find('td.name').text().trim();
    const value = $el.find('td.value').text().trim();
    if (key && value) {
      details.technicalData[key] = value;
    }
  });

  return details;
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

const scrapeProductDetails = async () => {
  console.log('Starting detailed product scraping...');
  
  let products;
  try {
    const content = await fs.readFile(INPUT_FILE, 'utf-8');
    products = JSON.parse(content);
    console.log(`Loaded ${products.length} products from ${INPUT_FILE}`);
  } catch (error) {
    console.error(`Failed to load ${INPUT_FILE}: ${error.message}`);
    console.error('Please run the scraper first to generate products.json');
    return;
  }

  const productsWithDetails = [];

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    console.log(`[${i + 1}/${products.length}] Scraping: ${product.name.substring(0, 50)}...`);

    try {
      const html = await fetchProductPage(product.link);
      const details = extractProductDetails(html);

      productsWithDetails.push({
        ...product,
        ...details,
      });
    } catch (error) {
      console.error(`Error scraping ${product.link}: ${error.message}`);
      productsWithDetails.push({
        ...product,
        error: error.message,
      });
    }

    if (i < products.length - 1) {
      await randomDelay();
    }
  }

  await fs.writeFile(OUTPUT_DETAILS_FILE, JSON.stringify(productsWithDetails, null, 2));
  console.log(`\nDone! Extracted details for ${productsWithDetails.length} products.`);
  console.log(`Results saved to ${OUTPUT_DETAILS_FILE}`);

  return productsWithDetails;
};

const args = process.argv.slice(2);
if (args.includes('--details')) {
  scrapeProductDetails().catch(console.error);
} else {
  scrapeAll().catch(console.error);
}
