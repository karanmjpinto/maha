// Qatar Official Gazette (الجريدة الرسمية) data adapter.
//
// Source: Government Communications Office (GCO), https://www.gco.gov.qa/ and
// the Cabinet General Secretariat, which publishes the official PDF gazette.
// The gazette is the authoritative publication for laws, decrees, and
// official government communications.
//
// Cloudflare-protected: the upstream returns a 403 challenge to non-Qatar IPs
// and to many datacenter ranges. Deploy on Qatar-resident infrastructure.
//
// Documented surfaces:
//   /en/gazette/issues — list of all issues (year + issue number)
//   /en/gazette/issues/<year> — issues filtered by year
//   /en/gazette/issues/<year>/<issue_number> — single issue page with PDF link
//   PDFs are hosted at /sites/default/files/Gazette/<year>/<file>.pdf
//
// The portal does not expose a JSON API; we scrape HTML. Selectors are based
// on the published Drupal theme. Verification status: NOT VERIFIED from a
// Qatar IP; tighten after first deploy.

import * as cheerio from "cheerio";
import { HttpClient, MemoryCache } from "@maha/mcp-shared";
import type { SearchResult, FetchedDocument } from "@maha/mcp-shared/dist/types.js";

const BASE = "https://www.gco.gov.qa";

export class QatarGazetteScraper {
    private readonly http = new HttpClient({ minIntervalMs: 2000 });
    private readonly cache = new MemoryCache<FetchedDocument>(200);

    async listIssues(opts: { year?: number; limit?: number; lang?: "ar" | "en" } = {}): Promise<SearchResult[]> {
        const lang = opts.lang ?? "ar";
        const limit = opts.limit ?? 30;
        const year = opts.year;
        const path = year ? `/${lang}/gazette/issues/${year}` : `/${lang}/gazette/issues`;
        const { status, text } = await this.http.get(`${BASE}${path}`);
        if (status !== 200) {
            throw new Error(`Qatar Gazette returned HTTP ${status}`);
        }
        const $ = cheerio.load(text);
        const results: SearchResult[] = [];
        const seen = new Set<string>();

        const selectors = [
            "a[href*='/gazette/issues/']",
            ".gazette-list a",
            ".views-row a",
            ".issue-card a",
        ];
        for (const sel of selectors) {
            if (results.length >= limit) break;
            $(sel).each((_, el) => {
                if (results.length >= limit) return false;
                const href = $(el).attr("href");
                if (!href || !href.match(/\/gazette\/issues\/\d{4}\//)) return;
                const absUrl = new URL(href, BASE).toString();
                if (seen.has(absUrl)) return;
                const title = $(el).text().trim();
                if (!title) return;
                seen.add(absUrl);
                results.push({
                    id: this.idFromUrl(absUrl),
                    title: title.slice(0, 250),
                    url: absUrl,
                    lang,
                    source: "qatar-gazette",
                });
            });
        }

        return results;
    }

    async search(
        query: string,
        opts: { lang?: "ar" | "en"; limit?: number } = {},
    ): Promise<SearchResult[]> {
        const lang = opts.lang ?? "ar";
        const limit = opts.limit ?? 20;
        const url = `${BASE}/${lang}/search?keys=${encodeURIComponent(query)}`;
        const { status, text } = await this.http.get(url);
        if (status !== 200) {
            throw new Error(`Qatar Gazette search returned HTTP ${status}`);
        }
        const $ = cheerio.load(text);
        const results: SearchResult[] = [];
        const seen = new Set<string>();

        $("ol.search-results li, .search-result, .views-row").each((_, el) => {
            if (results.length >= limit) return false;
            const a = $(el).find("a[href*='/gazette/']").first();
            const href = a.attr("href");
            if (!href) return;
            const absUrl = new URL(href, BASE).toString();
            if (seen.has(absUrl)) return;
            const title = a.text().trim() || $(el).find("h3, h4").first().text().trim();
            const snippet = $(el).find("p, .snippet").first().text().trim().slice(0, 280) || undefined;
            if (!title) return;
            seen.add(absUrl);
            results.push({
                id: this.idFromUrl(absUrl),
                title: title.slice(0, 250),
                snippet,
                url: absUrl,
                lang,
                source: "qatar-gazette",
            });
        });

        return results;
    }

    async fetchIssue(id: string, opts: { lang?: "ar" | "en" } = {}): Promise<FetchedDocument> {
        const lang = opts.lang ?? "ar";
        const cacheKey = `${id}:${lang}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        const url = id.startsWith("http")
            ? id
            : `${BASE}/${lang}/gazette/issues/${id}`;
        const { status, text } = await this.http.get(url);
        if (status !== 200) {
            throw new Error(`Qatar Gazette issue fetch returned HTTP ${status}`);
        }
        const $ = cheerio.load(text);

        const title = $("h1").first().text().trim() || $("title").text().trim();
        const issueDate = $(".issue-date, [class*='date']").first().text().trim() || undefined;
        const issueNumber = $(".issue-number, [class*='number']").first().text().trim() || undefined;
        const pdfUrls: string[] = [];
        $("a[href$='.pdf']").each((_, el) => {
            const href = $(el).attr("href");
            if (href) pdfUrls.push(new URL(href, BASE).toString());
        });
        const summary = $(".issue-summary, .field--name-body, main p").first().text().trim();

        const doc: FetchedDocument = {
            id,
            title: title.replace(/\s*\|\s*GCO.*/i, "").trim(),
            url,
            lang,
            text: summary || $("main").text().trim().slice(0, 20_000),
            metadata: { issueDate, issueNumber, pdfCount: pdfUrls.length },
            pdfUrls,
        };
        this.cache.set(cacheKey, doc);
        return doc;
    }

    private idFromUrl(url: string): string {
        const m = url.match(/\/gazette\/issues\/(\d{4})\/([^/?#]+)/);
        if (m) return `${m[1]}/${m[2]}`;
        const ym = url.match(/\/gazette\/issues\/(\d{4})/);
        if (ym) return ym[1];
        return url;
    }
}
