# Roadmap

A live document. We will keep this honest. If something slips, the date moves; the milestone does not silently disappear.

The landing page at [karanmjpinto.github.io/maha](https://karanmjpinto.github.io/maha/#roadmap) renders the same milestones in a friendlier format.

---

## Q2 2026 — Foundations · shipped

The minimum scaffolding needed to call this a Qatar legal AI rather than a generic legal chat.

- [x] Fork from [Emilie](https://github.com/veronica-builds/emilie). Rebrand. Lineage preserved (Mike → Emilie → Maha, all AGPL-3.0).
- [x] Sovereign stack chosen and documented: Fanar for the model layer, MEEZA / Ooredoo Cloud for hosting, Postgres + JWT + bcrypt for auth.
- [x] System prompt teaches the model Qatar's dual jurisdiction (mainland civil law and the Qatar Financial Centre common law system) and forces disambiguation before system-specific advice.
- [x] Migrant-language responses in ar, en, ur, hi, tl, bn, ne, ml, fr, fa wired into the system prompt.
- [x] Locale scaffold (`frontend/src/app/lib/locales.ts`) with native names, RTL flags, and use-case framing per language.
- [x] Four MCP servers built (`backend/mcp-servers/{al-meezan,qfc-court,qatar-gazette,adaalaty}`).
- [x] `qfc-court` verified live against the QICDRC portal — 496+ judgments accessible end-to-end. Discovered an undocumented JSON listing endpoint that avoids HTML scraping entirely.
- [x] Public landing page at `karanmjpinto.github.io/maha`.

## Q3 2026 — Inside-Qatar deploy · in progress

Move from a working artefact to a real deployment in jurisdiction.

- [ ] First deploy on MEEZA. Verify all four MCP scrapers against the live Qatar portals (Al Meezan, GCO Gazette, MoJ are geofenced and need an in-Qatar host to test against).
- [ ] Tighten selectors in `al-meezan`, `qatar-gazette`, and `adaalaty` based on the real upstream HTML.
- [ ] Fanar integration tested end to end — both self-hosted via vLLM and the QCRI managed API.
- [ ] UI internationalisation shipped for all ten languages. RTL polish for Arabic, Urdu, Persian.
- [ ] First design partner private beta. Two flows: bilingual document review for a law firm, and migrant-rights flow for an NGO.
- [ ] Telemetry and observability inside the Qatar perimeter — no third-party SaaS pings.

## Q4 2026 — Public beta

Open the door without breaking the trust foundation.

- [ ] Public beta open to law firms and in-house teams.
- [ ] Workflow library shipped for common Qatari matters: kafala documents, QFC commercial contracts, employment files, family law.
- [ ] Voice input for migrant-rights flows where literacy is a barrier.
- [ ] First NGO production pilot for migrant worker labour access in Urdu and Tagalog.
- [ ] Audit logs and document retention policies for regulated firms.
- [ ] Cost/performance benchmarks for the recommended Fanar deployment shapes published openly.

## Q1 2027 — General availability

Sand off the rough edges so this is a real product, not a fork.

- [ ] Native Arabic UI polish — typography, RTL nuance, mirrored controls, the small pixel decisions that make a product feel local instead of translated.
- [ ] Court e-filing integrations where Qatari courts permit direct submissions.
- [ ] Multi-tenant deployment guide for legal aid organisations.
- [ ] Conformance documentation for any Qatar data-protection requirements.
- [ ] First non-Qatar partner deployment in a similar dual-system jurisdiction (Bahrain, UAE, Saudi Arabia).

---

## How to influence this roadmap

- **Open an issue** at [github.com/karanmjpinto/maha/issues](https://github.com/karanmjpinto/maha/issues) — feature requests, bug reports, and disagreements with the roadmap are equally welcome.
- **Pull requests** are welcome under AGPL-3.0. See [CONTRIBUTING.md](./CONTRIBUTING.md).
- **Pilot partners** — if you're a law firm, NGO, or government body in Qatar willing to be a first user, an issue tagged `pilot-interest` is the right starting point.

## Items intentionally not on this roadmap

To stay honest about scope:

- **Mainland Qatari court judgment search.** Mainland court judgments are not published online by default; they are accessed in person or via licensed databases (Eastlaws, Lexis Middle East). Maha will integrate licensed sources only if a paying user brings the licence, and will never scrape sources behind a paywall.
- **Replacing a lawyer.** Maha is decision-support for licensed lawyers and an access layer for unrepresented people. It is not a substitute for legal advice and the UI is built to remind you of that.
- **Cloud-hosted SaaS.** There may eventually be a managed Maha service for firms that don't want to operate their own deployment, but the open-source self-hosted project will always be the primary distribution.
