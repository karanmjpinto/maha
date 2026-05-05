// AdaaLaty / Ministry of Justice (الأداة لتيسير العدالة) data adapter.
//
// Source: https://www.moj.gov.qa — Qatar Ministry of Justice. Publishes
// judicial circulars, ministerial decisions related to courts, court
// services, and administrative announcements. The MoJ does not publish
// individual mainland court judgments online (those are accessed in person
// or via licensed legal databases like Eastlaws and Lexis Middle East).
//
// Geofenced: blocks/times-out from non-Qatar IPs. Deploy on Qatar-resident
// infrastructure.
//
// Documented surfaces (Drupal site):
//   /<lang>/news, /<lang>/circulars, /<lang>/services
//   /<lang>/search?keys=…
// Selectors below are the standard Drupal theme defaults used across MoJ
// pages. Verification status: NOT VERIFIED from a Qatar IP.

import * as cheerio from "cheerio";
import { HttpClient, MemoryCache } from "@maha/mcp-shared";
import type { SearchResult, FetchedDocument } from "@maha/mcp-shared/dist/types.js";

const BASE = "https://www.moj.gov.qa";

export class AdaaLatyScraper {
    private readonly http = new HttpClient({ minIntervalMs: 2000 });
    private readonly cache = new MemoryCache<FetchedDocument>(200);

    async search(
        query: string,
        opts: { lang?: "ar" | "en"; limit?: number } = {},
    ): Promise<SearchResult[]> {
        const lang = opts.lang ?? "ar";
        const limit = opts.limit ?? 20;
        const url = `${BASE}/${lang}/search?keys=${encodeURIComponent(query)}`;
        const { status, text } = await this.http.get(url);
        if (status !== 200) {
            throw new Error(`MoJ search returned HTTP ${status}`);
        }
        const $ = cheerio.load(text);
        const results: SearchResult[] = [];
        const seen = new Set<string>();

        $("ol.search-results li, .search-result, .views-row, article").each((_, el) => {
            if (results.length >= limit) return false;
            const a = $(el).find("a").first();
            const href = a.attr("href");
            if (!href) return;
            const absUrl = new URL(href, BASE).toString();
            if (seen.has(absUrl)) return;
            const title = a.text().trim() || $(el).find("h2, h3").first().text().trim();
            const snippet = $(el).find("p, .field--name-body, .summary").first().text().trim().slice(0, 280) || undefined;
            if (!title || title.length < 3) return;
            seen.add(absUrl);
            results.push({
                id: absUrl,
                title: title.slice(0, 250),
                snippet,
                url: absUrl,
                lang,
                source: "adaalaty",
            });
        });

        return results;
    }

    async listCirculars(opts: { lang?: "ar" | "en"; limit?: number } = {}): Promise<SearchResult[]> {
        const lang = opts.lang ?? "ar";
        const limit = opts.limit ?? 30;
        const candidates = [
            `${BASE}/${lang}/circulars`,
            `${BASE}/${lang}/news/circulars`,
            `${BASE}/${lang}/judicial-circulars`,
        ];

        for (const url of candidates) {
            try {
                const { status, text } = await this.http.get(url);
                if (status !== 200) continue;
                const $ = cheerio.load(text);
                const results: SearchResult[] = [];
                $(".views-row, article, .news-item, .circular-item").each((_, el) => {
                    if (results.length >= limit) return false;
                    const a = $(el).find("a").first();
                    const href = a.attr("href");
                    if (!href) return;
                    const absUrl = new URL(href, BASE).toString();
                    const title = a.text().trim() || $(el).find("h2, h3").first().text().trim();
                    if (!title) return;
                    const date = $(el).find("time, .date").first().text().trim() || undefined;
                    results.push({
                        id: absUrl,
                        title: title.slice(0, 250),
                        url: absUrl,
                        lang,
                        date,
                        source: "adaalaty",
                    });
                });
                if (results.length > 0) return results;
            } catch {
                // try the next candidate path
            }
        }
        return [];
    }

    async listServices(opts: { lang?: "ar" | "en"; limit?: number } = {}): Promise<SearchResult[]> {
        const lang = opts.lang ?? "ar";
        const limit = opts.limit ?? 30;
        const url = `${BASE}/${lang}/services`;
        const { status, text } = await this.http.get(url);
        if (status !== 200) {
            throw new Error(`MoJ services list returned HTTP ${status}`);
        }
        const $ = cheerio.load(text);
        const results: SearchResult[] = [];
        $(".service-item, .views-row, .card a").each((_, el) => {
            if (results.length >= limit) return false;
            const a = $(el).find("a").first().length > 0 ? $(el).find("a").first() : $(el);
            const href = a.attr("href");
            if (!href) return;
            const absUrl = new URL(href, BASE).toString();
            const title = a.text().trim() || $(el).find("h3, h4").first().text().trim();
            if (!title) return;
            results.push({
                id: absUrl,
                title: title.slice(0, 200),
                url: absUrl,
                lang,
                source: "adaalaty",
            });
        });
        return results;
    }

    async fetchPage(id: string, opts: { lang?: "ar" | "en" } = {}): Promise<FetchedDocument> {
        const lang = opts.lang ?? "ar";
        const cacheKey = `${id}:${lang}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        const url = id.startsWith("http") ? id : `${BASE}/${lang}/${id.replace(/^\//, "")}`;
        const { status, text } = await this.http.get(url);
        if (status !== 200) {
            throw new Error(`MoJ page fetch returned HTTP ${status}`);
        }
        const $ = cheerio.load(text);

        const title = $("h1").first().text().trim() || $("title").text().trim();
        const date = $("time, .field--name-created, .post-date").first().text().trim() || undefined;
        const body = $(".field--name-body, .article-content, .page-content, main").first().text().trim();
        const pdfUrls: string[] = [];
        $("a[href$='.pdf']").each((_, el) => {
            const href = $(el).attr("href");
            if (href) pdfUrls.push(new URL(href, BASE).toString());
        });

        const doc: FetchedDocument = {
            id,
            title: title.replace(/\s*\|\s*MoJ.*/i, "").trim(),
            url,
            lang,
            text: body || $("body").text().trim().slice(0, 20_000),
            metadata: { date, pdfCount: pdfUrls.length },
            pdfUrls,
        };
        this.cache.set(cacheKey, doc);
        return doc;
    }
}
