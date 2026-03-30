# Auto24Parts Scraper

Node.js scraper for extracting ECU product data from auto24parts.com.

## Setup

```bash
cd scraper
npm install
```

## Run

```bash
node index.js
```

Output is saved to `products.json`.

## Configuration

Edit `scraper/index.js` to adjust:

- `BASE_URL` - Target category URL
- `OUTPUT_FILE` - Output filename
- `MAX_PAGES` - Maximum pages to scrape (default: 50)
- `DELAY_MS` - Base delay between requests

## Notes

- The scraper detects total pages by analyzing pagination links on the first page
- Includes 1.5-3 second random delay between requests to be respectful
- Retries failed requests up to 3 times
- If the site blocks requests, consider using Playwright instead of Axios
