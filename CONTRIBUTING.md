# Contributing to Maha

Maha is open source under AGPL-3.0. Issues and pull requests are welcome from anyone, regardless of where you are or what you bill for. This document tells you the highest-leverage places to help, the standards a PR has to clear, and the etiquette around the upstream forks Maha depends on.

## Where help compounds

The code is mostly there. The gaps that would meaningfully improve Maha for real Qatari users are concentrated in a few places:

### Qatari-licensed lawyers

You don't need to write code. Reading the system prompt at [`backend/src/lib/chatTools.ts`](./backend/src/lib/chatTools.ts) and telling us where the model is glib, where it elides nuance, or where it would mislead a junior associate is the single most valuable contribution we can receive.

Specifically useful:

- Workflow templates (`backend/src/lib/builtinWorkflows.ts`) for common Qatari matters: kafala documents, QFC commercial contracts, employment files, family law, end-of-service computations.
- Disambiguation rules between mainland civil law and the QFC. Where does the model assume one when the other applies?
- Flagging cases where the model should refuse and signpost a lawyer instead of answering.

Open an issue tagged `prompt-review` or `workflow-template` and quote the prompt or workflow you're correcting.

### Arabic-fluent front-end engineers

The locale scaffold ships in [`frontend/src/app/lib/locales.ts`](./frontend/src/app/lib/locales.ts) with RTL flags and language metadata. The actual RTL polish — typography, input direction, mirrored layouts, the small pixel decisions — is the gap.

Specifically useful:

- A working language switcher and `dir="rtl"` propagation through the Next.js app.
- Arabic-appropriate typography (Cairo, IBM Plex Sans Arabic, or similar) and font fallbacks.
- Audit of every input, button, and icon that visually leaks LTR-only assumptions.
- Same audit for Urdu and Persian (also RTL).

Open an issue tagged `i18n` or `rtl`.

### Migrant-rights organisations

If you work with Qatari migrant workers — labour court advocacy, end-of-service disputes, kafala transfers, wage protection complaints — Maha needs you to tell us what the actual workflow looks like before we build for it.

Specifically useful:

- Anonymised real cases (Urdu, Tagalog, Bengali, Nepali) that we can use to evaluate end-to-end performance.
- The ten or twenty questions you wish a worker could ask in their own language and get a correct, citation-grounded answer to.
- Feedback on whether Maha's tone in non-English languages is appropriate (formal, plain-spoken, neither condescending nor evasive).

Open an issue tagged `pilot-interest` or `field-feedback`.

### Sovereign infrastructure operators

If you operate the stack Maha is designed for — MEEZA, Ooredoo Cloud, Microsoft Qatar Region, the QCRI Fanar team — the most valuable thing you can do is tell us how to be a good citizen of your platform.

Specifically useful:

- Reference deployment configurations and Terraform / Pulumi scaffolding.
- Guidance on Qatar data-residency and audit-trail requirements.
- A list of where the documentation in this repo is out of step with current platform capabilities.

Open an issue tagged `infra` or `deployment`.

## Pull request standards

The base bar:

1. **Code compiles.** `npm run build --prefix backend`, `npm run build --prefix frontend`, `npm run mcp:build --prefix backend` should all succeed.
2. **Lints pass.** `npm run lint --prefix frontend`.
3. **Type checks pass.** Both backend and frontend are TypeScript strict.
4. **No new third-party tracking.** Maha is sovereign by design; analytics, error trackers, and SaaS telemetry don't get a free pass.

If you're touching the system prompt or a workflow template, include in the PR description either: (a) a concrete example of input/output that improves with your change, or (b) the rule-based reasoning a Qatari lawyer would apply to evaluate the change.

If you're touching an MCP scraper, include either: (a) a verification log against the live upstream portal, or (b) a clear note of which assumptions remain unverified.

## Upstream relationships

Maha is a fork of [Emilie](https://github.com/veronica-builds/emilie), which is a fork of [Mike](https://github.com/willchen96/mike). Both are AGPL-3.0.

- Improvements to the **document chat core**, **MCP client**, **JWT auth**, or **document storage layer** that aren't Qatar-specific should be considered for upstream contribution. Open the PR here first; we'll help port it.
- Improvements that are explicitly Qatar-specific (system prompt, workflow library, MCP servers wrapping Qatari portals, Arabic-language polish) live downstream in this repo.
- AGPL-3.0 license headers must be preserved on any file inherited from the parents.

## Code of conduct

Be the colleague you would want. Disagreement is welcome; condescension is not. We do not accept harassment of contributors on grounds of nationality, gender, language, religion, immigration status, or anything else. Migrant workers and the lawyers and NGOs who work with them are first-class participants here, not outside observers.

## How to start

1. Fork the repo.
2. Read [README.md](./README.md) and run the local setup.
3. Pick an issue or open one describing what you'd like to work on.
4. Send a PR referencing that issue.

If you're not sure where to start, open an issue describing what kind of work you'd like to do and someone will point you at a good first task. There's no question too small.
