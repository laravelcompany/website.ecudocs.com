#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import readline from 'readline';
import events from 'events';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = 'pdf2html.config.json';
const LOG_FILE = 'pdf2html.log';

const DEFAULT_CONFIG = {
  inputDir: 'src/content/pdfs',
  outputDir: 'src/content/pdf-html',
  zoom: 1.5,
  parallel: 1,
  tool: 'auto',
  singleHtml: false,
  generateIndex: true,
  embed: true,
  force: false,
  watch: false
};

class Logger {
  constructor(logPath) {
    this.logPath = logPath;
    this.stream = null;
    if (logPath) {
      this.stream = fs.createWriteStream(logPath, { flags: 'a' });
    }
  }

  log(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] [${level}] ${message} ${args.map(a => String(a)).join(' ')}`;
    console.log(formatted);
    if (this.stream) {
      this.stream.write(formatted + '\n');
    }
  }

  info(message, ...args) { this.log('INFO', message, ...args); }
  warn(message, ...args) { this.log('WARN', message, ...args); }
  error(message, ...args) { this.log('ERROR', message, ...args); }
  debug(message, ...args) { this.log('DEBUG', message, ...args); }

  close() {
    if (this.stream) {
      this.stream.end();
    }
  }
}

class ProgressBar {
  constructor(total, logger) {
    this.total = total;
    this.current = 0;
    this.startTime = Date.now();
    this.logger = logger;
  }

  update(current, message = '') {
    this.current = current;
    const percent = Math.round((current / this.total) * 100);
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const barLength = 30;
    const filled = Math.round((barLength * current) / this.total);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
    
    process.stdout.write(`\r[${bar}] ${percent}% (${current}/${this.total}) ${message ? `- ${message}` : ''} (${elapsed}s)`);
    
    if (current === this.total) {
      process.stdout.write('\n');
    }
  }
}

class PdfToHtmlConverter {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = new Logger(path.join(process.cwd(), LOG_FILE));
    this.tool = null;
    this.toolArgs = [];
    this.stats = { processed: 0, failed: 0, skipped: 0, totalPages: 0 };
  }

  async checkSystemDeps() {
    this.logger.info('Checking system dependencies...');
    
    const tools = {
      pdfinfo: { required: true, alt: null },
      pdf2html: { required: false, alt: 'pdftohtml' },
      pdftohtml: { required: false, alt: null },
      pdf2htmlEX: { required: false, alt: null }
    };

    for (const [tool, info] of Object.entries(tools)) {
      const { required, alt } = info;
      try {
        const { stdout } = await execAsync(`which ${tool}`);
        tools[tool].available = true;
        this.logger.info(`  ✓ ${tool} found at ${stdout.trim()}`);
      } catch {
        tools[tool].available = false;
        if (required) {
          this.logger.error(`  ✗ ${tool} is required but not found`);
          this.printInstallInstructions(alt);
        } else {
          this.logger.warn(`  - ${tool} not found (optional)`);
        }
      }
    }

    if (!tools.pdfinfo.available) {
      throw new Error('pdfinfo is required. Cannot proceed.');
    }

    if (this.config.tool === 'auto') {
      if (tools.pdf2html.available) {
        this.tool = 'pdf2html';
      } else if (tools.pdftohtml.available) {
        this.tool = 'pdftohtml';
      } else if (tools.pdf2htmlEX.available) {
        this.tool = 'pdf2htmlEX';
      } else {
        throw new Error('No suitable PDF to HTML converter found. Install pdf2html, pdftohtml, or pdf2htmlEX.');
      }
    } else {
      this.tool = this.config.tool;
      if (!tools[this.tool]?.available) {
        throw new Error(`Specified tool '${this.tool}' is not available.`);
      }
    }

    this.logger.info(`Using tool: ${this.tool}`);
    return tools;
  }

  printInstallInstructions(altTool) {
    console.log('\n========================================');
    console.log('REQUIRED PACKAGES NOT FOUND');
    console.log('========================================');
    console.log('\nTo install required dependencies on Fedora 43, run:');
    console.log('  sudo dnf install poppler-utils');
    if (altTool) {
      console.log(`\nFor ${altTool}, you may need to build from source or find an alternative package.`);
    }
    console.log('\nAlternatively, you can use the npm pdf2html package:');
    console.log('  npm install pdf2html --save-dev');
    console.log('========================================\n');
  }

  getToolArgs(pdfPath, outputPath, page = null) {
    const baseArgs = [];
    
    switch (this.tool) {
      case 'pdf2html':
        baseArgs.push(`--zoom ${this.config.zoom}`);
        if (this.config.embed) {
          baseArgs.push('--embed image --embed font --embed js --embed css');
        }
        if (page !== null) {
          baseArgs.push(`--first-page ${page}`, `--last-page ${page}`);
        }
        return [...baseArgs, `"${pdfPath}"`, `"${outputPath}"`];
      
      case 'pdftohtml':
        baseArgs.push(`-zoom ${this.config.zoom}`);
        if (this.config.singleHtml) {
          baseArgs.push('-c');
        }
        if (!this.config.embed) {
          baseArgs.push('-noembed');
        }
        if (page !== null) {
          baseArgs.push(`-f ${page}`, `-l ${page}`);
        }
        return [...baseArgs, `"${pdfPath}"`, `"${outputPath}"`];
      
      case 'pdf2htmlEX':
        baseArgs.push(`--zoom ${this.config.zoom}`);
        if (!this.config.embed) {
          baseArgs.push('--embed exfont false');
        }
        if (page !== null) {
          baseArgs.push(`--first-page ${page}`, `--last-page ${page}`);
        }
        return [...baseArgs, `"${pdfPath}"`, `"${outputPath}"`];
      
      default:
        return [];
    }
  }

  async getPageCount(pdfPath) {
    try {
      const { stdout } = await execAsync(`pdfinfo "${pdfPath}" 2>/dev/null`);
      const match = stdout.match(/^Pages:\s*(-?\d+)/m);
      const count = match ? parseInt(match[1], 10) : 0;
      if (count <= 0) {
        this.logger.warn(`Invalid page count ${count} for ${pdfPath}`);
        return 0;
      }
      return count;
    } catch (err) {
      this.logger.error(`Failed to get page count for ${pdfPath}: ${err.message}`);
      return 0;
    }
  }

  async validatePdf(pdfPath) {
    if (!fs.existsSync(pdfPath)) {
      return { valid: false, error: 'File does not exist' };
    }

    const ext = path.extname(pdfPath).toLowerCase();
    if (ext !== '.pdf') {
      return { valid: false, error: 'Not a PDF file' };
    }

    try {
      const { stdout } = await execAsync(`pdfinfo "${pdfPath}" 2>&1`);
      if (stdout.includes('Error') || stdout.includes('Invalid')) {
        return { valid: false, error: 'Invalid or corrupted PDF' };
      }
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  sanitizeFolderName(filename) {
    return filename
      .replace(/\.pdf$/i, '')
      .replace(/[<>:"/\\|?*]/g, '-')
      .trim();
  }

  async convertPage(pdfPath, outputPath, pageNum) {
    const args = this.getToolArgs(pdfPath, outputPath, pageNum);
    const cmd = `${this.tool} ${args.join(' ')}`;
    
    try {
      await execAsync(cmd, { stdio: 'pipe' });
      return { success: true, page: pageNum };
    } catch (err) {
      return { success: false, page: pageNum, error: err.message };
    }
  }

  async processPdf(pdfPath, progress) {
    const baseName = path.basename(pdfPath, '.pdf');
    const folderName = this.sanitizeFolderName(baseName);
    const folderPath = path.join(this.config.outputDir, folderName);

    const validation = await this.validatePdf(pdfPath);
    if (!validation.valid) {
      this.logger.error(`Validation failed for ${pdfPath}: ${validation.error}`);
      throw new Error(validation.error);
    }

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    if (!this.config.force) {
      const existingFiles = fs.readdirSync(folderPath).filter(f => f.match(/^page-\d+\.html$/));
      if (existingFiles.length > 0) {
        this.logger.info(`Skipping ${baseName} - already converted (use --force to overwrite)`);
        this.stats.skipped++;
        return { skipped: true, pages: existingFiles.length };
      }
    }

    const pageCount = await this.getPageCount(pdfPath);
    if (pageCount === 0) {
      throw new Error('Could not determine page count');
    }

    this.logger.info(`Converting ${baseName} (${pageCount} pages)...`);

    const results = [];
    const pages = Array.from({ length: pageCount }, (_, i) => i + 1);

    const worker = async (page) => {
      const outputPath = path.join(folderPath, `page-${page}.html`);
      return this.convertPage(pdfPath, outputPath, page);
    };

    if (this.config.parallel === 1) {
      for (let i = 0; i < pages.length; i++) {
        const result = await worker(pages[i]);
        results.push(result);
        progress.update(this.stats.processed + this.stats.failed + this.stats.skipped + i + 1, baseName);
      }
    } else {
      const queue = [];
      let index = 0;
      
      const runWorker = async () => {
        while (index < pages.length) {
          const page = pages[index++];
          const result = await worker(page);
          results.push(result);
          progress.update(this.stats.processed + this.stats.failed + this.stats.skipped + index, baseName);
        }
      };

      const workers = Array.from({ length: this.config.parallel }, () => runWorker());
      await Promise.all(workers);
    }

    const failures = results.filter(r => !r.success);
    if (failures.length > 0) {
      this.logger.error(`Failed pages: ${failures.map(f => f.page).join(', ')}`);
    }

    return { success: failures.length === 0, pages: pageCount, failures: failures.length };
  }

  async generateIndex() {
    if (!this.config.generateIndex) return;

    const outputDir = this.config.outputDir;
    const entries = fs.readdirSync(outputDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(dir => {
        const pdfName = dir.name;
        const htmlFiles = fs.readdirSync(path.join(outputDir, dir.name))
          .filter(f => f.match(/^page-\d+\.html$/))
          .sort((a, b) => {
            const numA = parseInt(a.match(/page-(\d+)/)?.[1] || '0');
            const numB = parseInt(b.match(/page-(\d+)/)?.[1] || '0');
            return numA - numB;
          });
        return { name: pdfName, pages: htmlFiles };
      })
      .filter(e => e.pages.length > 0);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PDF Index</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { border-bottom: 2px solid #333; padding-bottom: 10px; }
    .pdf-item { margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 8px; }
    .pdf-item h2 { margin: 0 0 10px 0; }
    .pages { display: flex; flex-wrap: wrap; gap: 10px; }
    .page-link { padding: 5px 10px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; font-size: 14px; }
    .page-link:hover { background: #0056b3; }
  </style>
</head>
<body>
  <h1>PDF Documents</h1>
  ${entries.map(entry => `
  <div class="pdf-item">
    <h2>${entry.name}</h2>
    <div class="pages">
      ${entry.pages.map(page => `<a class="page-link" href="${entry.name}/${page}">${page.replace('.html', '')}</a>`).join('\n      ')}
    </div>
  </div>`).join('\n')}
</body>
</html>`;

    const indexPath = path.join(outputDir, 'index.html');
    fs.writeFileSync(indexPath, html);
    this.logger.info(`Generated index: ${indexPath}`);
  }

  async run() {
    const inputDir = path.resolve(this.config.inputDir);
    const outputDir = path.resolve(this.config.outputDir);

    if (!fs.existsSync(inputDir)) {
      throw new Error(`Input directory not found: ${inputDir}`);
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    this.logger.info(`Input: ${inputDir}`);
    this.logger.info(`Output: ${outputDir}`);
    this.logger.info(`Parallel workers: ${this.config.parallel}`);

    const pdfFiles = fs.readdirSync(inputDir)
      .filter(f => f.toLowerCase().endsWith('.pdf'))
      .sort();

    if (pdfFiles.length === 0) {
      this.logger.warn('No PDF files found');
      return;
    }

    this.logger.info(`Found ${pdfFiles.length} PDF files`);

    const progress = new ProgressBar(pdfFiles.length, this.logger);

    for (let i = 0; i < pdfFiles.length; i++) {
      const pdfFile = pdfFiles[i];
      const pdfPath = path.join(inputDir, pdfFile);

      try {
        const result = await this.processPdf(pdfPath, progress);
        if (result.skipped) {
          this.stats.skipped += 1;
        } else {
          this.stats.processed += 1;
          this.stats.totalPages += result.pages;
        }
      } catch (err) {
        this.logger.error(`Failed to process ${pdfFile}: ${err.message}`);
        this.stats.failed += 1;
      }

      progress.update(i + 1);
    }

    await this.generateIndex();

    this.logger.info('========================================');
    this.logger.info(`Processed: ${this.stats.processed} PDFs`);
    this.logger.info(`Skipped: ${this.stats.skipped} PDFs`);
    this.logger.info(`Failed: ${this.stats.failed} PDFs`);
    this.logger.info(`Total pages: ${this.stats.totalPages}`);
    this.logger.info(`Output: ${outputDir}`);
    this.logger.info('========================================');

    this.logger.close();

    if (this.config.watch) {
      this.watchMode(inputDir);
    }
  }

  watchMode(inputDir) {
    this.logger.info('Watching for new PDF files...');
    let watcher = fs.watch(inputDir, { persistent: true }, (eventType, filename) => {
      if (eventType === 'rename' && filename?.toLowerCase().endsWith('.pdf')) {
        const pdfPath = path.join(inputDir, filename);
        if (fs.existsSync(pdfPath)) {
          this.logger.info(`New PDF detected: ${filename}`);
          this.processPdf(pdfPath, new ProgressBar(1, this.logger)).catch(err => {
            this.logger.error(`Watch error: ${err.message}`);
          });
        }
      }
    });

    process.on('SIGINT', () => {
      watcher.close();
      this.logger.info('Stopped watching');
      process.exit(0);
    });
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const config = { ...DEFAULT_CONFIG };
  const configPath = path.join(process.cwd(), CONFIG_FILE);

  if (fs.existsSync(configPath)) {
    try {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      Object.assign(config, fileConfig);
    } catch (err) {
      console.warn(`Warning: Failed to parse config file: ${err.message}`);
    }
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--input':
      case '-i':
        config.inputDir = args[++i];
        break;
      case '--output':
      case '-o':
        config.outputDir = args[++i];
        break;
      case '--zoom':
      case '-z':
        config.zoom = parseFloat(args[++i]);
        break;
      case '--parallel':
      case '-p':
        config.parallel = parseInt(args[++i], 10);
        break;
      case '--tool':
      case '-t':
        config.tool = args[++i];
        break;
      case '--single':
        config.singleHtml = true;
        break;
      case '--no-index':
        config.generateIndex = false;
        break;
      case '--no-embed':
        config.embed = false;
        break;
      case '--force':
      case '-f':
        config.force = true;
        break;
      case '--watch':
      case '-w':
        config.watch = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        if (arg.startsWith('--')) {
          console.warn(`Unknown option: ${arg}`);
        }
    }
  }

  return config;
}

function printHelp() {
  console.log(`
PDF to HTML Converter
======================

Usage: node pdf-to-html.mjs [options]

Options:
  --input, -i <dir>      Input directory containing PDFs (default: src/content/pdfs)
  --output, -o <dir>     Output directory for HTML files (default: src/content/pdf-html)
  --zoom, -z <number>    Zoom level for conversion (default: 1.5)
  --parallel, -p <num>   Number of parallel workers (default: 1)
  --tool <name>          PDF tool to use: pdf2html, pdftohtml, pdf2htmlEX, auto (default: auto)
  --single              Combine all pages into single HTML file (if tool supports)
  --no-index            Don't generate index.html
  --no-embed            Don't embed fonts/images (smaller files)
  --force, -f           Overwrite existing conversions
  --watch, -w           Watch for new PDFs and convert automatically
  --help, -h            Show this help message

Configuration:
  Default settings can be stored in ${CONFIG_FILE}

Examples:
  node pdf-to-html.mjs
  node pdf-to-html.mjs --input ./mypdfs --output ./html --parallel 4
  node pdf-to-html.mjs --zoom 2 --force
  node pdf-to-html.mjs --watch
`);
}

async function main() {
  const config = parseArgs();
  
  try {
    const converter = new PdfToHtmlConverter(config);
    await converter.checkSystemDeps();
    await converter.run();
  } catch (err) {
    console.error(`\nFatal error: ${err.message}`);
    process.exit(1);
  }
}

main();
