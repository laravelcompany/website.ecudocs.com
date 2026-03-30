# PDF to HTML Converter

Converts PDF files to HTML using `pdfinfo` (for page count) and `pdf2html`/`pdftohtml` for conversion.

## Installation (Fedora 43)

### Required System Packages

Install poppler-utils (provides `pdfinfo` and `pdftohtml`):

```bash
sudo dnf install poppler-utils
```

### Optional: pdf2htmlEX

For better quality conversions, you can install `pdf2htmlEX` from source:

```bash
# Build from source (requires development tools)
git clone https://github.com/pdf2htmlEX/pdf2htmlEX.git
cd pdf2htmlEX
cmake .
make
sudo make install
```

### Node.js Dependencies

The npm `pdf2html` package is included in devDependencies:

```bash
npm install
```

## Usage

### Basic Usage

```bash
node pdf-to-html.mjs
```

### Command-Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--input`, `-i` | Input directory with PDFs | `src/content/pdfs` |
| `--output`, `-o` | Output directory for HTML | `src/content/pdf-html` |
| `--zoom`, `-z` | Zoom level (1.0-3.0) | `1.5` |
| `--parallel`, `-p` | Number of parallel workers | `1` |
| `--tool` | Tool: pdf2html, pdftohtml, pdf2htmlEX, auto | `auto` |
| `--single` | Combine pages into single HTML | `false` |
| `--no-index` | Skip index.html generation | `false` |
| `--no-embed` | Don't embed fonts/images | `false` |
| `--force`, `-f` | Overwrite existing conversions | `false` |
| `--watch`, `-w` | Watch for new PDFs | `false` |
| `--help`, `-h` | Show help | - |

### Examples

```bash
# Convert all PDFs in default directories
node pdf-to-html.mjs

# Use custom input/output directories
node pdf-to-html.mjs --input ./mypdfs --output ./html

# Use 4 parallel workers for faster conversion
node pdf-to-html.mjs --parallel 4

# Higher zoom for better quality
node pdf-to-html.mjs --zoom 2.0

# Force overwrite existing conversions
node pdf-to-html.mjs --force

# Watch mode - auto-convert new PDFs
node pdf-to-html.mjs --watch
```

## Configuration File

Create `pdf2html.config.json` in the project root to set defaults:

```json
{
  "inputDir": "src/content/pdfs",
  "outputDir": "src/content/pdf-html",
  "zoom": 1.5,
  "parallel": 1,
  "tool": "auto",
  "singleHtml": false,
  "generateIndex": true,
  "embed": true,
  "force": false,
  "watch": false
}
```

Command-line arguments override config file settings.

## Output Structure

```
output-dir/
├── index.html           # Index page linking to all PDFs
├── document-name/
│   ├── page-1.html
│   ├── page-2.html
│   └── ...
└── another-document/
    └── ...
```

## Tool Detection

The script auto-detects available tools in this order:
1. `pdf2html` (npm package or system)
2. `pdftohtml` (poppler-utils)
3. `pdf2htmlEX` (if installed)

## Logging

Logs are written to `pdf2html.log` with timestamps. Progress is shown in the terminal.

## Test Plan

1. **Clean Run Test**
   ```bash
   # Remove existing output
   rm -rf src/content/pdf-html/*
   # Run converter
   node pdf-to-html.mjs
   # Verify HTML files created
   ls src/content/pdf-html/
   ```

2. **Parallel Processing Test**
   ```bash
   node pdf-to-html.mjs --parallel 4
   ```

3. **Resume Test**
   ```bash
   # Run again - should skip existing
   node pdf-to-html.mjs
   # Verify skipped count
   ```

4. **Force Overwrite Test**
   ```bash
   node pdf-to-html.mjs --force
   ```

5. **Invalid PDF Test**
   ```bash
   # Add invalid file to PDFs directory
   echo "not a pdf" > src/content/pdfs/bad.pdf
   node pdf-to-html.mjs
   # Verify error handling
   ```

## Troubleshooting

### "pdfinfo is required but not found"
Install poppler-utils:
```bash
sudo dnf install poppler-utils
```

### "No suitable PDF to HTML converter found"
Install at least one converter:
```bash
sudo dnf install poppler-utils  # provides pdftohtml
# OR
npm install pdf2html            # npm package
```

### Slow conversion
Increase parallel workers:
```bash
node pdf-to-html.mjs --parallel 4
```
