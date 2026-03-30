# Enhanced File Renaming Script

## Overview

This script renames files in a directory with intelligent cleaning. It includes special handling for PDF files with metadata extraction and optional AI-powered filename generation.

## Features

- **Filename Cleaning**: Removes URL-encoded characters, strips prefixes/suffixes, normalizes whitespace
- **PDF Metadata Extraction**: Uses `pdf-lib` to extract title, author, subject, keywords from PDFs
- **AI-Powered Filenames**: Uses Ollama (mistral:7b) to generate descriptive filenames when PDF title is missing
- **Duplicate Handling**: Automatically handles duplicate filenames with numeric suffixes
- **Dry-Run Mode**: Preview changes without actually renaming files

## Installation

```bash
npm install
```

## Configuration

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. (Optional) Customize Ollama settings in `.env`:
   ```
   OLLAMA_URL=http://ai.izdrail.com
   OLLAMA_MODEL=mistral:7b
   ```
   - Default uses the local Ollama server at `ai.izdrail.com`
   - **Note**: Without a running Ollama server, PDFs without titles will fall back to the original filename cleaning logic

## Usage

```bash
# Dry run (preview changes)
node rename_with_ai.js /path/to/directory --dry-run

# Actual rename
node rename_with_ai.js /path/to/directory

# Use current directory
node rename_with_ai.js --dry-run
```

## How It Works (PDF Files)

1. Extracts PDF metadata using `pdf-lib`
2. If `Title` field exists, uses it as the new filename
3. If no title, uses Ollama AI to generate a filename from:
   - Author, subject, keywords
   - First 3 pages of text content
4. Applies the same cleaning/sanitization logic as other files
5. Handles duplicates with numeric suffixes

## Example

```bash
# Dry run on a directory with PDFs
$ node rename_with_ai.js ./documents --dry-run

Processing PDF: document%20with%20spaces.pdf
  [PDF] Extracting metadata...
  [PDF] Pages: 15
  [PDF] Title found: "Annual Report 2023"
  -> Annual-Report-2023.pdf
  -> Would rename to: Annual-Report-2023.pdf
```

## Dependencies

- `pdf-lib` - PDF metadata and text extraction
- `dotenv` - Environment variable loading
