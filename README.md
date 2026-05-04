# Emilie

A fork of [Mike](https://github.com/willchen96/mike), extended for Swiss sovereign legal AI.

Named after **Emilie Kempin-Spyri** (1853–1901) — the first woman in Europe to earn a law degree, who was then denied the right to practice it in Switzerland. She deserves to be in the stack.

---

## What it does

Emilie is a document assistant for legal work. You upload legal documents (DOCX, PDF) and work with them through a chat interface powered by a local or managed LLM. Core capabilities:

- **Document chat**: ask questions, extract clauses, summarize, compare versions
- **Projects**: organize documents into matters or workspaces, share with colleagues by email
- **Tabular review**: run structured clause extraction across a set of documents simultaneously
- **Workflows**: define reusable AI workflows that run against documents automatically
- **Version tracking**: upload revised documents and track changes across versions
- **Swiss case law search**: query federal and cantonal court decisions mid-conversation via MCP

All processing runs on infrastructure you control. No document content leaves your environment unless you configure a cloud model as fallback.

---

## What is different from Mike

Emilie adds three capabilities on top of Mike's core document assistant:

### Sovereign auth

Mike relies on Supabase for user authentication. Emilie replaces this with custom JWT + bcrypt directly against Postgres — no third-party auth service, no data leaving your infrastructure. Users and sessions are stored in your own database.

### MCP client

Emilie connects to any [Model Context Protocol](https://modelcontextprotocol.io) server and exposes its tools directly to the LLM. Configure servers in `MCP_SERVERS` and they are available in every conversation without code changes.

The following Swiss legal data sources are open, free, and MCP-ready:

| Source | Coverage | Auth |
|---|---|---|
| [Entscheidsuche](https://entscheidsuche.ch) | Federal + 22 cantonal courts, de/fr/it | None |
| [OpenCaseLaw.ch](https://opencaselaw.ch) | 971K+ decisions (1875–present), all 26 cantons, citation graph, legislation | None |
| [Online Kommentar](https://onlinekommentar.ch) | Swiss legal commentaries, article-level, multilingual | None |
| [Fedlex](https://fedlex.data.admin.ch) | Complete Swiss federal legislation, all 3 national languages | None |

### Local model support

Emilie routes to any OpenAI-compatible inference endpoint — no OpenAI dependency. Point `VLLM_BASE_URL` at a local or managed server and select "Local Model" in the UI.

Recommended model: **[Apertus](https://www.swiss-ai.org/apertus)**, the open-weights LLM developed by ETH Zurich, EPFL, and the Swiss National Supercomputing Centre. Apache 2.0 licensed. Trained across 1,000+ languages with strong coverage of Swiss national languages.

Two deployment paths:

| Path | How | Data stays |
|---|---|---|
| Self-hosted | Run Apertus via [vLLM](https://github.com/vllm-project/vllm) on your own hardware | Your infrastructure |
| Managed Swiss | [Infomaniak AI Tools](https://www.infomaniak.com/en/hosting/ai-services) — hosts Apertus in Swiss data centers | Switzerland |

---

## Sovereign stack

| Layer | Option |
|---|---|
| Auth | Custom JWT + bcrypt — no third-party service |
| Database | Postgres (self-hosted, Infomaniak VPS, or any provider) |
| LLM | Apertus (self-hosted via vLLM) or Infomaniak AI Tools |
| Case law | Entscheidsuche, OpenCaseLaw.ch, Fedlex, Online Kommentar — all free and open |
| Object storage | [Infomaniak Object Storage](https://www.infomaniak.com/en/hosting/cloud-object-storage) (S3-compatible, Switzerland) |
| App | Emilie, self-hosted |

Cloud providers (Anthropic, Google) remain available as fallback but are not required.

---

## Setup

Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend
```

Create and fill in env files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Generate a JWT secret and add it to `backend/.env`:

```bash
openssl rand -base64 48
# → paste result as JWT_SECRET=<output>
```

Run the schema migration against your Postgres database:

```bash
psql "$DATABASE_URL" -f backend/migrations/000_one_shot_schema.sql
```

Start backend:

```bash
npm run dev --prefix backend
```

Start frontend:

```bash
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

---

## Required services

- **Postgres**: Any Postgres database. Auth is handled by Emilie directly using JWT + bcrypt — no third-party auth service required. For a sovereign deployment, run Postgres on your own infrastructure or an Infomaniak VPS.
- **Object storage**: Any S3-compatible store. Infomaniak Object Storage (Switzerland) is the recommended option.
- **Model**: A local inference endpoint via `VLLM_BASE_URL` (Apertus via vLLM, or Infomaniak AI Tools). Anthropic and Gemini API keys are supported as a fallback but route documents through US cloud servers.
- **LibreOffice**: Required for DOC/DOCX to PDF conversion. Runs entirely locally — no data leaves your machine. Maintained by The Document Foundation (German non-profit, open-source).

---

## Local model configuration

Add to `backend/.env`:

```env
# Option A: self-hosted Apertus via vLLM
VLLM_BASE_URL=http://localhost:8000/v1
VLLM_MAIN_MODEL=<apertus-model-id>

# Option B: Infomaniak AI Tools (Swiss managed, includes Apertus)
VLLM_BASE_URL=https://api.infomaniak.com/2/ai/<product_id>/openai/v1
VLLM_API_KEY=<infomaniak-api-key>
VLLM_MAIN_MODEL=apertus
```

Select "Local Model" in the chat model picker once `VLLM_BASE_URL` is set.

---

## MCP configuration

Add to `backend/.env`:

```env
MCP_SERVERS=[
  {"name":"entscheidsuche","url":"https://mcp.entscheidsuche.ch/mcp"},
  {"name":"opencaselaw","url":"https://mcp.opencaselaw.ch/mcp"},
  {"name":"fedlex","url":"https://fedlex-connector.ch/mcp"}
]
```

Multiple servers are supported. Each server's tools appear automatically in every conversation. API keys are optional — omit the `apiKey` field for servers that require no authentication.

---

## Checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

---

## License

AGPL-3.0-only. See `LICENSE`.

This project is a fork of [Mike](https://github.com/willchen96/mike) by Will Chen, used under AGPL-3.0.
