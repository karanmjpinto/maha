# Maha MCP Servers — Qatar Legal Data

This directory holds MCP (Model Context Protocol) server implementations that wrap public Qatar legal data portals. None of these portals expose a stable API, so each server is a focused scraper that exposes a small set of tools (`search`, `fetch`, etc.) over the MCP HTTP transport.

The servers are independent of the main Maha backend. Run them on the same host or on separate Qatar-resident infrastructure (MEEZA, Ooredoo Cloud) and point `MCP_SERVERS` at them.

## Servers

| Directory | Source portal | Default port | Status |
|---|---|---|---|
| `al-meezan/` | https://www.almeezan.qa — Qatari laws, decrees, ministerial decisions, treaties (ar/en) | 7010 | scaffold |
| `qfc-court/` | https://www.qicdrc.gov.qa — QFC Civil & Commercial Court judgments, arbitration awards (en) | 7011 | scaffold |
| `qatar-gazette/` | https://www.gco.gov.qa — Qatar Official Gazette (ar) | 7012 | scaffold |
| `adaalaty/` | https://www.moj.gov.qa — Ministry of Justice services and judicial circulars (ar/en) | 7013 | scaffold |

## Tool surface (target)

Each server exposes at minimum:

- `search(query: string, lang?: "ar" | "en", date_from?: string, date_to?: string)` — full-text search returning result IDs, titles, and snippets.
- `fetch(id: string)` — return the full text of a result by ID.
- `list_recent(limit?: number)` — most recently published items.

Additional source-specific tools:

- `al-meezan`: `find_law(law_number: string, year: number)`, `find_article(law_id: string, article_number: string)`
- `qfc-court`: `find_judgment(case_number: string)`, `list_arbitration_awards(year?: number)`
- `qatar-gazette`: `list_issues(year: number)`, `fetch_issue(issue_number: string, year: number)`
- `adaalaty`: `list_circulars()`, `find_circular(circular_number: string)`

## Running

```bash
# install deps
npm install --prefix backend/mcp-servers/al-meezan

# run a single server
npm run start --prefix backend/mcp-servers/al-meezan

# or use the convenience script from the backend root
npm run mcp:al-meezan --prefix backend
```

## Legal note

These scrapers fetch public legal records that the State of Qatar publishes for free public access. They respect each portal's `robots.txt`, throttle requests, and identify themselves with a `User-Agent` header containing a contact URL. Cache aggressively to minimize load on upstream portals.

If you operate one of the upstream portals and want to discuss a direct feed, the contact details are in the project README.
