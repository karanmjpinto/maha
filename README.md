# Maha

A fork of [Emilie](https://github.com/veronica-builds/emilie) (which itself forks [Mike](https://github.com/willchen96/mike)), extended for Qatar sovereign legal AI.

Named after **Sheikha Maha bint Mansour bin Salman bin Jassim Al Thani** — the first female Qatari judge, appointed to the Court of Cassation in 2010 in a country whose courts had until then been entirely male. She belongs in the stack.

---

## What it does

Maha is a document assistant for legal work in Qatar. You upload legal documents (DOCX, PDF) — Arabic or English — and work with them through a chat interface powered by a local or managed LLM. Core capabilities:

- **Bilingual document chat (Arabic + English)**: ask questions, extract clauses, summarize, compare versions, in either national working language
- **Dual-system aware**: handles both Qatari civil law (mainland) and Qatar Financial Centre (QFC) common law in the same workspace
- **Projects**: organize documents into matters or workspaces, share with colleagues by email
- **Tabular review**: run structured clause extraction across a set of documents simultaneously
- **Workflows**: define reusable AI workflows that run against documents automatically
- **Version tracking**: upload revised documents and track changes across versions
- **Qatar case law and legislation search**: query Al Meezan, QFC Court judgments, Qatari Official Gazette, and AdaaLaty mid-conversation via MCP
- **Migrant worker accessibility**: respond in Urdu, Hindi, Tagalog, Bengali, Nepali, Malayalam, French and Persian alongside Arabic and English — the working languages of Qatar's 2M+ migrant workforce

All processing runs on infrastructure you control. No document content leaves Qatar unless you explicitly configure a non-Qatar cloud model as fallback.

---

## What is different from Emilie

Maha keeps Emilie's sovereign architecture (custom JWT + bcrypt, MCP client, OpenAI-compatible local LLM routing) and replaces the Swiss-specific layers with Qatar-specific ones:

### Qatar legal data sources

The following Qatar legal data sources are public records, made MCP-accessible by Maha. None have public APIs upstream — Maha's MCP servers wrap the public portals.

| Source | Coverage | Language | Auth |
|---|---|---|---|
| [Al Meezan](https://www.almeezan.qa) | Qatari laws, decrees, ministerial decisions, treaties | ar/en | None |
| [QFC Court & QICDRC judgments](https://www.qicdrc.gov.qa) | Qatar Financial Centre court decisions and arbitration awards | en | None |
| [Qatar Official Gazette](https://www.gco.gov.qa) | Government communications, official publications | ar | None |
| [AdaaLaty (Ministry of Justice)](https://www.moj.gov.qa) | Qatari court services, judicial circulars | ar/en | None |

The MCP servers in `backend/mcp-servers/` are wrappers around these public portals. They are part of this repository — fork them, run them on your own infrastructure, and configure `MCP_SERVERS` to point at your instances.

### Local model support — Fanar

Maha routes to any OpenAI-compatible inference endpoint. Point `VLLM_BASE_URL` at a local or managed server and select "Local Model" in the UI.

Recommended model: **[Fanar](https://fanar.qa)**, the Arabic-first open-weights LLM developed by the Qatar Computing Research Institute (QCRI) at Hamad Bin Khalifa University. Built specifically for Modern Standard Arabic and Qatari/Gulf dialect, with strong English bilingual capability.

Three deployment paths:

| Path | How | Data stays |
|---|---|---|
| Self-hosted | Run Fanar via [vLLM](https://github.com/vllm-project/vllm) on your own hardware | Your infrastructure |
| Managed Qatar | Fanar API hosted by QCRI / HBKU | Qatar |
| Sovereign cloud | Deploy via [MEEZA](https://www.meeza.qa) Tier IV data centers | Qatar |

---

## Sovereign stack

| Layer | Option |
|---|---|
| Auth | Custom JWT + bcrypt — no third-party service |
| Database | Postgres (self-hosted or on a Qatar provider — MEEZA, Ooredoo Cloud, Microsoft Qatar Region) |
| LLM | Fanar (self-hosted via vLLM, or QCRI managed API) |
| Case law and legislation | Al Meezan, QFC Court, Qatar Official Gazette, AdaaLaty — public records, MCP wrappers in this repo |
| Object storage | MEEZA Object Storage, Ooredoo Cloud, or any S3-compatible store |
| App | Maha, self-hosted |

Cloud providers (Anthropic, Google) remain available as fallback but are not required and route through non-Qatar regions.

---

## Languages

UI strings: English (default). Localization scaffold lives in `frontend/src/locales/`.

AI conversational responses: Arabic and English are first-class. The model also responds in the user's input language across:

| Code | Language | Why |
|---|---|---|
| `ar` | Arabic | Official language; mainland Qatari courts |
| `en` | English | Working language; QFC courts; international contracts |
| `ur` | Urdu | Largest single migrant nationality (Pakistani workforce) |
| `hi` | Hindi | Indian workforce |
| `tl` | Tagalog (Filipino) | Filipino workforce — domestic, hospitality |
| `bn` | Bengali | Bangladeshi workforce — construction, services |
| `ne` | Nepali | Nepali workforce — construction |
| `ml` | Malayalam | Kerala workforce |
| `fr` | French | Maghrebi expatriate community |
| `fa` | Persian (Farsi) | Iranian community |

Migrant labour rights are an under-served legal access problem in Qatar. Maha is built so a worker's lawyer, NGO, or labour-court translator can interact in the worker's first language end-to-end.

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

- **Postgres**: any Postgres database. Auth handled by Maha directly (JWT + bcrypt). For sovereign deployment in Qatar, run Postgres on MEEZA, Ooredoo Cloud, or a self-managed VM.
- **Object storage**: any S3-compatible store. MEEZA Object Storage is the recommended Qatar-resident option.
- **Model**: a local inference endpoint via `VLLM_BASE_URL` (Fanar via vLLM, or QCRI managed API). Anthropic and Gemini API keys are supported as fallback but route documents through non-Qatar cloud servers.
- **LibreOffice**: required for DOC/DOCX to PDF conversion. Runs entirely locally — no data leaves your machine.

---

## Local model configuration

Add to `backend/.env`:

```env
# Option A: self-hosted Fanar via vLLM
VLLM_BASE_URL=http://localhost:8000/v1
VLLM_MAIN_MODEL=fanar

# Option B: QCRI managed Fanar API
VLLM_BASE_URL=https://api.fanar.qa/v1
VLLM_API_KEY=<qcri-api-key>
VLLM_MAIN_MODEL=fanar
```

Select "Local Model" in the chat model picker once `VLLM_BASE_URL` is set.

---

## MCP configuration

Add to `backend/.env`:

```env
MCP_SERVERS=[
  {"name":"al-meezan","url":"http://localhost:7010/mcp"},
  {"name":"qfc-court","url":"http://localhost:7011/mcp"},
  {"name":"qatar-gazette","url":"http://localhost:7012/mcp"},
  {"name":"adaalaty","url":"http://localhost:7013/mcp"}
]
```

The MCP server implementations live under `backend/mcp-servers/`. They scrape the public Qatar legal portals listed above. Each can be run independently with `npm run mcp:<name>`.

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

This project is a fork of [Emilie](https://github.com/veronica-builds/emilie) by Veronica, which is a fork of [Mike](https://github.com/willchen96/mike) by Will Chen, both used under AGPL-3.0.
