# DocumentScraper

Document scraping and reading tool for local workspace files and remote URLs.

## Features

- Reads local and remote documents
- Supports txt, markdown, html, pdf, docx, csv, and tsv
- Generates structured sections and deterministic high-quality descriptions
- Detects encrypted PDFs and returns user-facing encryption notifications

## Endpoints

- `GET /health`
- `GET /tool-schema`
- `POST /tools/read_document`
- `POST /tools/crawl_documents`

## Security

- Blocks localhost and private network URL targets
- Restricts local file reads to workspace root
- Enforces response size and timeout caps
- Redacts sensitive request auth inputs from output logs

## Environment Variables

- `PORT` (default `3336`)
- `DOC_SCRAPER_DEFAULT_TIMEOUT_MS` (default `20000`)
- `DOC_SCRAPER_MAX_TIMEOUT_MS` (default `60000`)
- `DOC_SCRAPER_MAX_CONTENT_BYTES` (default `52428800`)
- `DOC_SCRAPER_MAX_CONTENT_CHARS` (default `50000`)
- `DOC_SCRAPER_WORKSPACE_ROOT` (default current working directory)
