// QICDRC (QFC Civil & Commercial Court + Regulatory Tribunal) data adapter.
//
// Discovery: the public site at qicdrc.gov.qa renders judgment listings via a
// JSON endpoint at /judgements/list (note British spelling) that returns 496+
// fully structured judgment records — case parties, neutral citation,
// judgement date, court type, judges, keywords, AI summary, and full bilingual
// body content. We use the JSON API directly instead of scraping HTML.
//
// JSON shape (one entry of `results`):
//   id, field_case_number, case.{case_number, claimant, defendant, case_court},
//   courtType.{name}, neutralCitation, judgementDate, status,
//   keywords[].{name}, judges[].{name},
//   summary, aiSummary, aiSummaryStatus,
//   judgementEnglish, judgementArabic, bodyContent, details, before
//
// Each judgment also has a public detail page at /judgments/<slug> linked from
// the JSON's case.case_number HTML, which we scrape for the canonical slug.
//
// Pagination: ?page=N&items_per_page=K. count and pages live under `pager`.

import * as cheerio from "cheerio";
import { HttpClient, MemoryCache } from "@maha/mcp-shared";
import type { SearchResult, FetchedDocument } from "@maha/mcp-shared/dist/types.js";

const BASE = "https://www.qicdrc.gov.qa";

type RawJudgement = {
    id: string;
    field_case_number?: string;
    case?: {
        case_number?: string;
        claimant?: string;
        defendant?: string;
        case_court?: string;
    };
    courtType?: { name?: string };
    neutralCitation?: string;
    judgementDate?: string;
    status?: string | null;
    keywords?: { name?: string }[];
    judges?: { name?: string }[];
    summary?: string;
    aiSummary?: string;
    aiSummaryStatus?: string;
    judgementEnglish?: string;
    judgementArabic?: string;
    bodyContent?: string;
    details?: string;
    before?: string;
};

type ListResponse = {
    results: RawJudgement[];
    pager: { count: string | number; pages: number; items_per_page: number | string; current_page: number };
};

export class QfcCourtScraper {
    private readonly http = new HttpClient();
    private readonly listCache = new MemoryCache<RawJudgement[]>(50);
    private readonly fetchCache = new MemoryCache<FetchedDocument>(200);

    private async fetchPage(page: number, perPage: number): Promise<RawJudgement[]> {
        const cacheKey = `page:${page}:${perPage}`;
        const cached = this.listCache.get(cacheKey);
        if (cached) return cached;

        const url = `${BASE}/judgements/list?page=${page}&items_per_page=${perPage}`;
        const { status, text } = await this.http.get(url, {
            headers: { Accept: "application/json,text/html;q=0.9" },
        });
        if (status !== 200) {
            throw new Error(`QICDRC list endpoint returned HTTP ${status}`);
        }
        let parsed: ListResponse;
        try {
            parsed = JSON.parse(text) as ListResponse;
        } catch {
            throw new Error("QICDRC list endpoint did not return JSON");
        }
        const results = parsed.results ?? [];
        this.listCache.set(cacheKey, results);
        return results;
    }

    async listRecent(limit = 20): Promise<SearchResult[]> {
        const perPage = Math.min(Math.max(limit, 10), 50);
        const raw = await this.fetchPage(0, perPage);
        return raw.slice(0, limit).map((r) => this.toSearchResult(r));
    }

    async search(
        query: string,
        opts: { lang?: "ar" | "en"; limit?: number } = {},
    ): Promise<SearchResult[]> {
        // The JSON list endpoint does not accept a query param. We page through
        // results and filter client-side. For a casebase of ~500 judgments this
        // is tolerable; if it grows the filter should move upstream via the
        // /search/contents endpoint. Cap at 5 pages (250 records) per call.
        const limit = opts.limit ?? 20;
        const q = query.toLowerCase().trim();
        if (!q) return this.listRecent(limit);

        const matches: RawJudgement[] = [];
        for (let page = 0; page < 5 && matches.length < limit; page++) {
            const batch = await this.fetchPage(page, 50);
            if (batch.length === 0) break;
            for (const r of batch) {
                if (this.recordMatches(r, q)) {
                    matches.push(r);
                    if (matches.length >= limit) break;
                }
            }
        }
        return matches.map((r) => this.toSearchResult(r));
    }

    async fetchDocument(id: string): Promise<FetchedDocument> {
        const cached = this.fetchCache.get(id);
        if (cached) return cached;

        // First try to find the record in any cached list page; otherwise scan.
        let record: RawJudgement | undefined;
        for (let page = 0; page < 50 && !record; page++) {
            const batch = await this.fetchPage(page, 50);
            if (batch.length === 0) break;
            record = batch.find(
                (r) =>
                    r.id === id ||
                    r.field_case_number === id ||
                    this.slugFromRecord(r) === id ||
                    (r.neutralCitation ?? "").replace(/\s+/g, "").toLowerCase() ===
                        id.replace(/\s+/g, "").toLowerCase(),
            );
        }
        if (!record) {
            // Fallback: scrape the public detail page directly.
            return this.scrapeDetailPage(id);
        }

        const slug = this.slugFromRecord(record);
        const detailUrl = slug ? `${BASE}/judgments/${slug}` : BASE;
        const pdfUrls = await this.findPdfsForJudgment(detailUrl);

        const englishText = stripHtml(record.judgementEnglish ?? record.bodyContent ?? "");
        const arabicText = stripHtml(record.judgementArabic ?? "");
        const summary = stripHtml(record.aiSummary ?? record.summary ?? "");

        const doc: FetchedDocument = {
            id,
            title:
                record.case?.case_number ??
                record.field_case_number ??
                record.neutralCitation ??
                `QFC Court judgment ${record.id}`,
            url: detailUrl,
            lang: "en",
            text: [summary, englishText, arabicText].filter(Boolean).join("\n\n---\n\n"),
            metadata: {
                neutralCitation: record.neutralCitation,
                judgementDate: record.judgementDate,
                courtType: record.courtType?.name,
                claimant: record.case?.claimant,
                defendant: record.case?.defendant,
                caseNumber: record.field_case_number ?? record.case?.case_number,
                judges: (record.judges ?? []).map((j) => j.name).filter(Boolean),
                keywords: (record.keywords ?? []).map((k) => k.name).filter(Boolean),
                aiSummaryStatus: record.aiSummaryStatus,
                hasArabic: Boolean(arabicText),
            },
            pdfUrls,
        };
        this.fetchCache.set(id, doc);
        return doc;
    }

    private async scrapeDetailPage(idOrSlug: string): Promise<FetchedDocument> {
        const url = idOrSlug.startsWith("http") ? idOrSlug : `${BASE}/judgments/${idOrSlug}`;
        const { status, text } = await this.http.get(url);
        if (status !== 200) {
            throw new Error(`QICDRC ${url} returned HTTP ${status}`);
        }
        const $ = cheerio.load(text);
        const title = $("h1").first().text().trim() || $("title").text().trim();
        const body = $(".field--name-body").map((_, el) => $(el).text().trim()).get().join("\n\n");
        const pdfUrls: string[] = [];
        $("a[href$='.pdf']").each((_, el) => {
            const href = $(el).attr("href");
            if (href) pdfUrls.push(new URL(href, BASE).toString());
        });
        return {
            id: idOrSlug,
            title: title.replace(/\s*\|\s*QICDRC$/i, "").trim(),
            url,
            lang: "en",
            text: body || $("main").text().trim().slice(0, 20_000),
            metadata: { source: "scrape-fallback" },
            pdfUrls,
        };
    }

    private async findPdfsForJudgment(detailUrl: string): Promise<string[]> {
        try {
            const { status, text } = await this.http.get(detailUrl);
            if (status !== 200) return [];
            const $ = cheerio.load(text);
            const urls: string[] = [];
            $("a[href$='.pdf']").each((_, el) => {
                const href = $(el).attr("href");
                if (href) urls.push(new URL(href, BASE).toString());
            });
            return urls;
        } catch {
            return [];
        }
    }

    private toSearchResult(r: RawJudgement): SearchResult {
        const slug = this.slugFromRecord(r);
        const url = slug ? `${BASE}/judgments/${slug}` : `${BASE}/judgments`;
        const claimant = r.case?.claimant ?? "";
        const defendant = r.case?.defendant ?? "";
        const parties = claimant && defendant ? `${claimant} v ${defendant}` : "";
        const title = parties || r.case?.case_number || r.field_case_number || r.neutralCitation || `Judgment ${r.id}`;
        const snippetParts = [
            r.neutralCitation,
            r.judgementDate,
            r.courtType?.name,
            stripHtml(r.aiSummary ?? r.summary ?? "").slice(0, 220),
        ].filter(Boolean);
        return {
            id: r.field_case_number ?? r.id,
            title,
            snippet: snippetParts.join(" — "),
            url,
            lang: "en",
            date: r.judgementDate,
            source: "qfc-court",
        };
    }

    private slugFromRecord(r: RawJudgement): string {
        const fcn = (r.field_case_number ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
        return fcn;
    }

    private recordMatches(r: RawJudgement, q: string): boolean {
        const haystack = [
            r.case?.case_number,
            r.case?.claimant,
            r.case?.defendant,
            r.field_case_number,
            r.neutralCitation,
            r.judgementDate,
            r.courtType?.name,
            stripHtml(r.aiSummary ?? r.summary ?? ""),
            (r.keywords ?? []).map((k) => k.name).join(" "),
            (r.judges ?? []).map((j) => j.name).join(" "),
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        return haystack.includes(q);
    }
}

function stripHtml(s: string): string {
    if (!s) return "";
    return s
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
}
