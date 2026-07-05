# RAG Quick Start Guide

This guide shows how to use the RAG (Retrieval-Augmented Generation) MCP server to build and search knowledge bases.

## Prerequisites

1. **LM Studio** running locally with model loaded
2. **MCP Toolkit** built: `npm run build`
3. **Proxy gateway (optional)**: `npm run proxy` only if your environment blocks direct web access
4. **RAG server** running: `npm run start:rag` (or started by your MCP client)

## Workflow

### 1. Ingest Web Content

Use `ingest_webpage` to fetch, render, chunk, embed, and store a webpage in one call:

```
LLM Prompt:
"Ingest the Anthropic API documentation. 
Use documentId='anthropic-api-docs', title='Anthropic API Reference'"

MCP Tool Call:
ingest_webpage(
  url="https://docs.anthropic.com/en/api/getting-started",
  documentId="anthropic-api-docs",
  title="Anthropic API Reference"
)

Response:
{
  "success": true,
  "url": "https://docs.anthropic.com/en/api/getting-started",
  "documentId": "anthropic-api-docs",
  "chunks": 42,
  "chars": 15234,
  "message": "Successfully ingested webpage: Anthropic API Reference (42 chunks)"
}
```

**What happens:**
1. Browser server fetches the page with JavaScript rendering (Playwright)
2. RAG server chunks the content (default 1000 chars per chunk, 200 char overlap)
3. LM Studio's embeddings API generates vector embeddings for each chunk
4. Vectors and metadata stored in `rag-data/index.json`

### 2. Search Knowledge Base

Use `search_knowledge` to find relevant information:

```
LLM Prompt:
"What are the token limits for Claude models?"

MCP Tool Call:
search_knowledge(
  query="What are the token limits for Claude models?",
  topK=5,
  includeSemanticScore=true
)

Response:
{
  "query": "What are the token limits for Claude models?",
  "resultCount": 5,
  "results": [
    {
      "documentId": "anthropic-api-docs",
      "chunkIndex": 3,
      "text": "Claude 3 Opus: 200k tokens input, 4k tokens output. Claude 3 Sonnet: 200k tokens input, 4k tokens output...",
      "score": 0.892
    },
    {
      "documentId": "anthropic-api-docs",
      "chunkIndex": 7,
      "text": "All Claude models support vision capabilities. Maximum image resolution: 2000x2000 pixels, supports...",
      "score": 0.756
    },
    // ... 3 more results
  ]
}
```

**How it works:**
1. Query is converted to embedding using LM Studio's embeddings API
2. Cosine similarity computed between query embedding and all stored chunk embeddings
3. Top-k results returned sorted by relevance score (0-1)
4. LLM uses returned chunks as context to answer the question

### 3. Manage Knowledge Base

#### List stored documents:
```
list_documents(limit=10)

Response:
{
  "documentCount": 3,
  "documents": [
    {
      "id": "anthropic-api-docs",
      "title": "Anthropic API Reference",
      "url": "https://docs.anthropic.com/en/api/getting-started",
      "chunkCount": 42,
      "addedAt": "2026-03-08T20:15:34.123Z"
    },
    // ... more docs
  ]
}
```

#### Delete a document:
```
delete_document(documentId="anthropic-api-docs")

Response:
{
  "documentId": "anthropic-api-docs",
  "title": "Anthropic API Reference",
  "deletedChunks": 42,
  "message": "Deleted document and 42 chunks"
}
```

## Chunking Strategies

Control how documents are split:

### Fixed-size (default)
```
store_document(
  documentId="...",
  title="...",
  content="...",
  chunkSize=1000,        // 1000 characters
  chunkOverlap=200       // 200 char overlap between chunks
)
```
✅ Predictable, fast
❌ May split mid-sentence

### Sentence-aware
```
chunk_text(
  text="...",
  chunkSize=1000,
  strategy="sentence"
)
```
✅ Respects sentence boundaries
❌ Variable chunk sizes

### Semantic (paragraph-based)
```
chunk_text(
  text="...",
  chunkSize=1000,
  strategy="semantic"
)
```
✅ Preserves semantic coherence
❌ Slower, assumes well-formatted input

## Document Ingestion Methods

### From Web
```
ingest_webpage(
  url="https://example.com/article",
  documentId="article-2026",
  title="Article Title"
)
```
Combines: fetch_page_rendered + store_document

### From Local Files

PDF:
```
extract_pdf_text(filePath="/docs/paper.pdf", maxPages=10)
// Then: store_document(documentId="...", title="...", content=extracted_text)
```

DOCX:
```
extract_docx_text(filePath="/docs/report.docx")
// Then: store_document(...)
```

Markdown:
```
extract_markdown(filePath="/docs/guide.md")
// Then: store_document(...)
```

## Environment Configuration

Control RAG behavior with environment variables:

```bash
# Embeddings endpoint (default: http://localhost:1234)
export LM_STUDIO_URL="http://localhost:1234"

# Vector index storage location (default: rag-data/)
export RAG_DATA_DIR="/path/to/rag-data"

# Start RAG server
npm run start:rag
```

## Performance Tips

### Optimize Chunking
- **Smaller chunks (500 chars):** More precise results, more API calls, slower search
- **Larger chunks (2000 chars):** Broader context, fewer embeddings, faster search
- **Sweet spot:** 1000-1500 chars for balanced retrieval quality

### Cache Embeddings
- Embeddings are automatically cached in memory
- Re-ingesting the same text: instant (no re-embedding)
- Cache cleared on server restart (use `RAG_DATA_DIR` for persistence)

### Batch Operations
- `search_knowledge` is fast (in-process vector similarity)
- Ingestion is slow (embedding generation = API calls)
- Ingest in advance, search interactively

## Common Workflows

### Research Assistant Pattern
```
1. User: "Research machine learning papers"
2. Agent: ingest_webpage(arxiv.org papers)
3. User: "Summarize the latest on transformers"
4. Agent: search_knowledge("transformer architecture") → get relevant chunks → summarize
```

### Code Documentation Pattern
```
1. Agent: ingest_webpage(https://docs.python.org) with documentId="python-docs"
2. User: "How do I use list comprehensions?"
3. Agent: search_knowledge("list comprehension") → retrieve code examples
```

### Knowledge Base Pattern
```
1. Daily: ingest_webpage(blog posts, docs, articles) with unique IDs
2. Weekly: list_documents() to review ingested content
3. Monthly: delete_document() to remove outdated information
4. Always: search_knowledge(query) to find relevant information
```

## Troubleshooting

### "Failed to generate embeddings"
- LM Studio not running or unreachable
- Check: `curl http://localhost:1234/v1/embeddings` returns valid response
- Fix: Ensure LM Studio is running and `LM_STUDIO_URL` environment variable is correct

### "No documents in knowledge base"
- Haven't ingested anything yet
- First: `ingest_webpage(url, documentId, title)` to add content
- Verify: `list_documents()` returns items

### Search returns low relevance scores
- Query too vague or different language than documents
- Chunks too small (incomplete context)
- Try: `search_knowledge(query, topK=20)` to see more results
- Solution: Re-chunk with larger size

### Vector store file missing
- `rag-data/index.json` required for persistence
- Created automatically on first ingestion
- If deleted: restart server and re-ingest documents
- Location customizable via `RAG_DATA_DIR`

## Advanced Usage

### Custom Chunking + Embedding + Storage

```
Step 1: chunk_text(
  text="...",
  chunkSize=2000,
  strategy="semantic"
)

Step 2: generate_embeddings(
  texts=[chunks...],
  model="nomic-embed-text"
)

Step 3: store_document(
  documentId="custom-doc",
  title="Custom Document",
  content="...",
  chunkSize=2000
)
```

Useful for: Custom preprocessing, multiple document types, custom embeddings models

## Next Steps

1. **Ingest your first webpage:** `ingest_webpage(url, documentId, title)`
2. **Search it:** `search_knowledge(query)`
3. **Add more documents** from web or local files
4. **Use in LM Studio chat** to answer questions grounded in your knowledge base
