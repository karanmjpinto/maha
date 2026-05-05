# Maha MCP Servers — Qatar Legal Data

Each subdirectory is a standalone MCP server that wraps a public Qatar legal data portal and exposes its content as tools to the Maha LLM.

## Servers

| Directory | Source portal | Default port | Status |
|---|---|---|---|
| [`al-meezan/`](./al-meezan) | https://www.almeezan.qa — Qatari laws, decrees, ministerial decisions, treaties (ar/en) | 7010 | implemented; selectors documented, awaiting Qatar-IP verification |
| [`qfc-court/`](./qfc-court) | https://www.qicdrc.gov.qa — QFC Civil & Commercial Court judgments, arbitration awards (en) | 7011 | implemented and verified live; uses the upstream JSON list endpoint |
| [`qatar-gazette/`](./qatar-gazette) | https://www.gco.gov.qa — Qatar Official Gazette (ar) | 7012 | implemented; selectors documented, awaiting Qatar-IP verification |
| [`adaalaty/`](./adaalaty) | https://www.moj.gov.qa — Ministry of Justice services and judicial circulars (ar/en) | 7013 | implemented; selectors documented, awaiting Qatar-IP verification |

The QICDRC portal turned out to render its judgment listing from a JSON endpoint at `/judgements/list?page=N&items_per_page=K` (note the British spelling). The `qfc-court` server uses that JSON directly instead of scraping HTML and exposes 496+ judgments with neutral citations, judgement dates, parties, judges, keywords, and AI summaries.

The other three portals (Al Meezan, GCO Gazette, MoJ) restrict access to Qatar IPs at the WAF/Cloudflare layer. Their scrapers were written based on the documented Drupal theme and standard portal structures — the selectors will work when run from a Qatar-resident host (MEEZA, Ooredoo Cloud, Microsoft Qatar Region) but should be tightened against live HTML on first deploy.

## Tool surface

Every server implements at minimum:

- `search(query, lang?, limit?)` — full-text search.
- `fetch(id, lang?)` — retrieve the full text and metadata of a single record.
- `list_recent` or a source-specific listing (`list_issues`, `list_circulars`, `list_services`).

Each `search` returns objects of type `SearchResult { id, title, snippet?, url, lang?, date?, source }`. Each `fetch` returns `FetchedDocument { id, title, url, lang?, text, metadata, pdfUrls? }`.

## Running locally

From the repo root:

```bash
# install dependencies for shared lib + all four servers
npm run mcp:install --prefix backend

# build all four
npm run mcp:build --prefix backend

# run a single server
npm run mcp:qfc-court --prefix backend

# or run all four in separate terminals:
npm run mcp:al-meezan     --prefix backend
npm run mcp:qfc-court     --prefix backend
npm run mcp:qatar-gazette --prefix backend
npm run mcp:adaalaty      --prefix backend
```

Each server listens on its default port (7010/7011/7012/7013) at `/mcp` with a `/healthz` endpoint. Override the port with `PORT=…`.

## Wiring into the Maha backend

Set in `backend/.env`:

```env
MCP_SERVERS=[
  {"name":"al-meezan","url":"http://localhost:7010/mcp"},
  {"name":"qfc-court","url":"http://localhost:7011/mcp"},
  {"name":"qatar-gazette","url":"http://localhost:7012/mcp"},
  {"name":"adaalaty","url":"http://localhost:7013/mcp"}
]
```

The Maha backend's MCP client (`backend/src/lib/mcp.ts`) connects to each on startup and exposes their tools to every conversation.

## Architecture

```
mcp-servers/
├── shared/                  # @maha/mcp-shared — HTTP client, MCP bootstrap, cache
│   └── src/
│       ├── server.ts        # startMcpServer() — Express + Streamable HTTP transport
│       ├── http.ts          # throttled HttpClient with polite User-Agent
│       ├── cache.ts         # in-memory LRU
│       └── types.ts         # SearchResult, FetchedDocument
├── al-meezan/               # Qatari laws/decrees portal scraper
├── qfc-court/               # QICDRC JSON API adapter
├── qatar-gazette/           # Qatar Official Gazette scraper
└── adaalaty/                # MoJ portal scraper
```

Each server is independent: separate `package.json`, separate `dist/`, separate process. They share only the `shared` package via a `file:` dependency.

## Polite-scraping policy

Every HTTP request goes through `HttpClient`, which:

- sets a descriptive `User-Agent` identifying the project and a contact URL
- throttles to one request every 1.5–2 seconds per host
- caches `search` and `fetch` results in-process for 15 minutes

Cache aggressively in production. If a portal operator wants a direct feed instead, the contact details are in the project README.

## Verification status

| Server | Live-tested | Notes |
|---|---|---|
| `qfc-court` | yes | Verified against live qicdrc.gov.qa from outside Qatar — JSON endpoint is open. `list_recent`, `search`, and `fetch` all return real data. |
| `al-meezan` | no | Selectors based on documented Drupal theme. Run `probe` after deploy and tighten. |
| `qatar-gazette` | no | Cloudflare-protected; selectors based on GCO theme. |
| `adaalaty` | no | Geofenced; selectors based on standard Drupal theme. |

When deploying to Qatar-resident infrastructure, run each non-verified server's `search` and `list_*` against known queries, compare the parsed output to the upstream HTML, and update the selectors in `src/scraper.ts` if the real markup differs.
