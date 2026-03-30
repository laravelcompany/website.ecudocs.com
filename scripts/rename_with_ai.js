#!/usr/bin/env node

import { readdir, rename } from 'fs/promises';
import { join, extname } from 'path';
import { existsSync } from 'fs';

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

  for (const oldName of regularFiles) {
    const oldPath = join(directory, oldName);
    let newName = cleanFilename(oldName);
    newName = sanitizeFilename(newName);

    console.log('Processing: ' + oldName);
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
      } catch (err) {
        console.error('  -> Rename error: ' + err.message);
      }
    }
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
