# LM Studio Tools - RAG

RAG MCP tool for persistent document ingestion and semantic retrieval, with robust support for dynamic/JavaScript documentation sites (e.g., browserless-docs.mcp.kapa.ai, docs.browserless.io) via browser-rendered fallback and BrowserQL guidance.

## MCP Operations
- ingest_documents
- query_knowledge
- list_sources
- delete_source
- reindex_source

## Features
- Token-aware chunking
- LM Studio embeddings support
- SQLite source/chunk/vector persistence
- AskUser approval gating for write and destructive operations
- **Dynamic docs fallback:** If document ingestion from a URL fails or returns empty (e.g., due to JavaScript rendering), RAG automatically falls back to browser-rendered extraction using the Browserless MCP tool for known dynamic documentation domains.
- **BrowserQL guidance:** For dynamic docs domains, if browser-rendered extraction is required, the Browserless tool will return explicit guidance to use BrowserQL (browserless_bql) for robust content capture. See below for details.

## Environment Variables
- RAG_DB_PATH (default ./rag.db, resolved relative to the script directory)
- RAG_EMBEDDING_MODEL (default nomic-ai/nomic-embed-text-v1.5)
- RAG_EMBEDDINGS_MODE (lmstudio|mock, default lmstudio)
- RAG_CHUNK_SIZE_TOKENS (default 384)
- RAG_CHUNK_OVERLAP_TOKENS (default 75)
- RAG_QUERY_TOP_K (default 6)
- RAG_DOC_SCRAPER_ENDPOINT (default http://localhost:3336/tools/read_document)
- RAG_ASK_USER_ENDPOINT (default http://localhost:3338/tools/ask_user_interview)
- RAG_BYPASS_APPROVAL (set to "true" to skip write approval gates)

## Dynamic Documentation Sites: Fallback and BrowserQL Playbook

Some documentation sites (notably those powered by kapa.ai, browserless-docs.mcp.kapa.ai, docs.browserless.io, etc.) require JavaScript execution to render content. For these, RAG will:

1. Attempt ingestion via DocumentScraper (default).
2. If content is empty or blocked, and the domain matches a known dynamic docs site, RAG will automatically call the Browserless MCP tool (`browserless_content`).
3. If Browserless detects a dynamic docs domain, it will return explicit guidance to use BrowserQL (`browserless_bql`) for robust extraction, including an example query.

**BrowserQL Example for Dynamic Docs:**

```
{
	"query": "query { pageText(url: \"https://browserless-docs.mcp.kapa.ai\") { text } }"
}
```

**Recommended workflow:**
- For dynamic docs, always prefer BrowserQL if standard extraction fails or guidance is returned.
- Ingest the captured text via the `text` field in RAG.

See the Browserless README for more BrowserQL examples and capabilities.
