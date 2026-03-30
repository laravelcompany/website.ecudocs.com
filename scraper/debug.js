import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://auto24parts.com/en_GB/c/ECU-Engine-control-unit/624';

const fetchPage = async (pageNum) => {
  const url = pageNum === 1 ? BASE_URL : `${BASE_URL}/${pageNum}`;
  console.log(`Fetching ${url}...`);

  const { data } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
  });
  return data;
};

const debugPage = async (pageNum) => {
  const html = await fetchPage(pageNum);
  const $ = cheerio.load(html);

  console.log('\n=== Pagination elements ===');
  console.log($('.pagination').html()?.substring(0, 500) || 'No .pagination found');
  console.log('\n=== All links with page numbers ===');
  $('a').each((i, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (href.includes('/624/') || text.match(/^\d+$/)) {
      console.log(`Text: "${text}", href: ${href}`);
    }
  });

  console.log('\n=== Body class ===');
  console.log($('body').attr('class'));

  console.log('\n=== Sample product structure ===');
  const productHtml = $('.product-main-wrap').first().html();
  console.log(productHtml?.substring(0, 800) || 'No products found');
};

debugPage(1);
