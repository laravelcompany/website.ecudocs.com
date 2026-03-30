#!/usr/bin/env node

import 'dotenv/config';
import { readdir, rename, readFile } from 'fs/promises';
import { join, extname } from 'path';
import { existsSync } from 'fs';
import { PDFDocument } from 'pdf-lib';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const AI_CACHE = new Map();

function cleanFilename(filename) {
  let name = filename;
  const ext = extname(name);
  let base = name.slice(0, -ext.length);

  base = base.replace(/%20/g, ' ');
  base = base.replace(/%2[dD]/g, '-');
  base = base.replace(/%28/g, '(').replace(/%29/g, ')');

  base = base.replace(/^(\d{2}[_-])+/, '');

  base = base.replace(/_+/g, '-');
  base = base.replace(/\s+/g, '-');
  base = base.replace(/\s+/g, ' ');

  base = base.replace(/\s*\(\s*(\d+)\s*\)\s*/g, ' $1');

  base = base.replace(/[_-]?web\s*/gi, '');

  base = base.replace(/\s*\(\s*Part\s*\d+\s*\)/gi, '');

  base = base.replace(/\s+/g, ' ').trim();

  return base + ext;
}

function sanitizeFilename(name) {
  const safe = name.replace(/[^\w\s\-_.()]/g, '');
  return safe.replace(/\s+/g, ' ').trim();
}

function getEnv(key, defaultVal = null) {
  return process.env[key] || defaultVal;
}

async function getPdfMetadata(filePath) {
  try {
    const pdfBytes = await readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    
    const title = pdfDoc.getTitle();
    const author = pdfDoc.getAuthor();
    const subject = pdfDoc.getSubject();
    const keywords = pdfDoc.getKeywords();
    const creator = pdfDoc.getCreator();
    const producer = pdfDoc.getProducer();
    const creationDate = pdfDoc.getCreationDate();
    const pageCount = pdfDoc.getPageCount();

    return {
      title: title || null,
      author: author || null,
      subject: subject || null,
      keywords: keywords || null,
      creator: creator || null,
      producer: producer || null,
      creationDate: creationDate?.toISOString() || null,
      pageCount
    };
  } catch (err) {
    console.warn(`  [PDF] Failed to extract metadata: ${err.message}`);
    return null;
  }
}

async function extractPdfText(filePath, maxPages = 3) {
  try {
    const pdfBytes = await readFile(filePath);
    const data = await pdfParse(pdfBytes, { max: maxPages });
    return data.text.slice(0, 5000);
  } catch (err) {
    console.warn(`  [PDF] Failed to extract text: ${err.message}`);
    return null;
  }
}

async function generateAiFilename(filePath, metadata) {
  const ollamaUrl = getEnv('OLLAMA_URL', 'http://ai.izdrail.com');
  const model = getEnv('OLLAMA_MODEL', 'mistral:7b');
  
  if (!ollamaUrl) {
    console.log('  [AI] No OLLAMA_URL found, skipping AI generation');
    return null;
  }

  const cacheKey = `${filePath}:${metadata?.title || 'no-title'}`;
  if (AI_CACHE.has(cacheKey)) {
    console.log('  [AI] Using cached result');
    return AI_CACHE.get(cacheKey);
  }

  try {
    const text = await extractPdfText(filePath, 3);
    
    let prompt = 'Generate a short, descriptive filename (max 60 characters) for a PDF document. ';
    prompt += 'Output ONLY the filename (with .pdf extension), no explanation.\n';
    prompt += 'Use hyphens between words, no special characters.\n\n';
    
    if (metadata?.title) {
      prompt += `Document title: ${metadata.title}\n`;
    }
    if (metadata?.author) {
      prompt += `Author: ${metadata.author}\n`;
    }
    if (metadata?.subject) {
      prompt += `Subject: ${metadata.subject}\n`;
    }
    if (metadata?.keywords) {
      prompt += `Keywords: ${metadata.keywords}\n`;
    }
    if (text) {
      prompt += `\nFirst few pages content preview:\n${text.slice(0, 2000)}\n`;
    }

    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    let filename = data.response?.trim() || '';
    
    filename = filename.replace(/^["']|["']$/g, '');
    filename = filename.replace(/\.pdf$/i, '') + '.pdf';
    
    if (filename.length > 100) {
      filename = filename.slice(0, 97) + '.pdf';
    }

    AI_CACHE.set(cacheKey, filename);
    console.log('  [AI] Generated filename:', filename);
    
    return filename;
  } catch (err) {
    console.warn(`  [AI] AI generation failed: ${err.message}`);
    return null;
  }
}

async function getPdfTitle(filePath) {
  console.log('  [PDF] Extracting metadata...');
  const metadata = await getPdfMetadata(filePath);
  
  if (!metadata) {
    console.log('  [PDF] Metadata extraction failed, using original name');
    return null;
  }

  console.log(`  [PDF] Pages: ${metadata.pageCount}`);
  if (metadata.title) {
    console.log(`  [PDF] Title found: "${metadata.title}"`);
    return metadata.title;
  }

  if (metadata.author) console.log(`  [PDF] Author: ${metadata.author}`);
  if (metadata.subject) console.log(`  [PDF] Subject: ${metadata.subject}`);

  console.log('  [PDF] No title found, attempting AI generation...');
  const aiFilename = await generateAiFilename(filePath, metadata);
  
  if (aiFilename) {
    const ext = extname(aiFilename);
    return aiFilename.slice(0, -ext.length);
  }

  return null;
}

async function renameFiles(directory, dryRun = false) {
  const files = await readdir(directory);
  const regularFiles = files.filter(file => {
    const fullPath = join(directory, file);
    return !fullPath.endsWith('.js') && !fullPath.endsWith('.py') && !fullPath.endsWith('.md');
  });

  if (regularFiles.length === 0) {
    console.log('No files found.');
    return;
  }

  const usedNames = new Set();
  let pdfCount = 0;
  let renamedCount = 0;

  for (const oldName of regularFiles) {
    const oldPath = join(directory, oldName);
    const ext = extname(oldName);
    const isPdf = ext.toLowerCase() === '.pdf';
    
    let newName;
    
    if (isPdf) {
      pdfCount++;
      console.log(`Processing PDF: ${oldName}`);
      const pdfTitle = await getPdfTitle(oldPath);
      
      if (pdfTitle) {
        newName = cleanFilename(pdfTitle + ext);
      } else {
        console.log('  -> Falling back to original cleaning logic');
        newName = cleanFilename(oldName);
      }
    } else {
      console.log(`Processing: ${oldName}`);
      newName = cleanFilename(oldName);
    }
    
    newName = sanitizeFilename(newName);

    console.log('  -> ' + newName);

    if (newName === oldName || !newName) {
      console.log('  -> No change needed');
      continue;
    }

    let finalName = newName;
    let counter = 1;
    let newPath = join(directory, finalName);
    while (usedNames.has(newPath) || existsSync(newPath)) {
      const ext = extname(finalName);
      const base = finalName.slice(0, -ext.length);
      finalName = base + '_' + counter + ext;
      newPath = join(directory, finalName);
      counter++;
      if (counter > 100) {
        console.log('  -> Could not find unique name, skipping');
        break;
      }
    }

    if (dryRun) {
      console.log('  -> Would rename to: ' + finalName);
    } else {
      try {
        await rename(oldPath, newPath);
        console.log('  -> Renamed to: ' + finalName);
        usedNames.add(newPath);
        renamedCount++;
      } catch (err) {
        console.error('  -> Rename error: ' + err.message);
      }
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total files processed: ${regularFiles.length}`);
  console.log(`PDF files: ${pdfCount}`);
  if (!dryRun) {
    console.log(`Renamed: ${renamedCount}`);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  let directory = '.';
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (!arg.startsWith('-')) {
      directory = arg;
    }
  }

  return { directory, dryRun };
}

const { directory, dryRun } = parseArgs();
renameFiles(directory, dryRun)
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
