// Al Meezan (almeezan.qa) data adapter — Qatari laws, decrees, ministerial
// decisions, treaties, and ministerial orders.
//
// IP-restricted: the portal blocks non-Qatar/datacenter IPs at the WAF level.
// This adapter is meant to be deployed on Qatar-resident infrastructure (MEEZA,
// Ooredoo Cloud) where it can reach the upstream.
//
// Selectors below are documented from the portal's published HTML structure as
// of May 2026. The portal is bilingual (ar/en) and exposes:
//
//   /LawPage.aspx?id=<lawId>&language=<ar|en>
//       — full law detail with articles in numbered <h2>/<div> sections
//   /search/?keys=<query>&language=<ar|en>
//       — full-text search across the corpus, results in
//         div.search-result > h3.title > a[href="/LawPage.aspx?id=…"]
//   /Recent.aspx?language=<ar|en>
//       — most recently issued laws and decrees
//
// Verification status: NOT YET VERIFIED from a Qatar IP. After deploying to
// a Qatar-resident host, run scripts/probe.ts to compare actual selectors
// against the assumptions here and tighten them.

import * as cheerio from "cheerio";
import { HttpClient, MemoryCache } from "@maha/mcp-shared";
import type { SearchResult, FetchedDocument } from "@maha/mcp-shared/dist/types.js";

const BASE = "https://www.almeezan.qa";

export class AlMeezanScraper {
    private readonly http = new HttpClient({ minIntervalMs: 2000 });
    private readonly cache = new MemoryCache<FetchedDocument>(200);

    async search(
        query: string,
        opts: { lang?: "ar" | "en"; limit?: number } = {},
    ): Promise<SearchResult[]> {
        const lang = opts.lang ?? "ar";
        const limit = opts.limit ?? 20;
        const url = `${BASE}/search/?keys=${encodeURIComponent(query)}&language=${lang}`;
        const { status, text } = await this.http.get(url);
        if (status !== 200) {
            throw new Error(`Al Meezan search returned HTTP ${status}`);
        }
        const $ = cheerio.load(text);
        const results: SearchResult[] = [];
        const seen = new Set<string>();

        const candidates = [
            "div.search-result",
            ".result-item",
            "li.search-result",
            ".search-results li",
            ".main-content .item",
        ];
        for (const sel of candidates) {
            if (results.length >= limit) break;
            $(sel).each((_, el) => {
                if (results.length >= limit) return false;
                const a = $(el).find("a[href*='LawPage'], a[href*='/law/'], a[href*='ArticleListPage']").first();
                const href = a.attr("href");
                if (!href) return;
                const absUrl = new URL(href, BASE).toString();
                if (seen.has(absUrl)) return;
                const title = a.text().trim() || $(el).find("h2, h3, .title").first().text().trim();
                const snippet = $(el).find(".snippet, .summary, p").first().text().trim().slice(0, 280) || undefined;
                if (!title) return;
                seen.add(absUrl);
                results.push({
                    id: this.idFromUrl(absUrl),
                    title: title.slice(0, 250),
                    snippet,
                    url: absUrl,
                    lang,
                    source: "al-meezan",
                });
            });
        }

        return results;
    }

    async listRecent(opts: { lang?: "ar" | "en"; limit?: number } = {}): Promise<SearchResult[]> {
        const lang = opts.lang ?? "ar";
        const limit = opts.limit ?? 20;
        const url = `${BASE}/Recent.aspx?language=${lang}`;
        const { status, text } = await this.http.get(url);
        if (status !== 200) {
            throw new Error(`Al Meezan recent returned HTTP ${status}`);
        }
        const $ = cheerio.load(text);
        const results: SearchResult[] = [];
        const seen = new Set<string>();

        $("a[href*='LawPage'], a[href*='ArticleListPage']").each((_, el) => {
            if (results.length >= limit) return false;
            const href = $(el).attr("href");
            if (!href) return;
            const absUrl = new URL(href, BASE).toString();
            if (seen.has(absUrl)) return;
            const title = $(el).text().trim();
            if (!title || title.length < 3) return;
            seen.add(absUrl);
            results.push({
                id: this.idFromUrl(absUrl),
                title: title.slice(0, 250),
                url: absUrl,
                lang,
                source: "al-meezan",
            });
        });

        return results;
    }

    async fetchLaw(
        id: string,
        opts: { lang?: "ar" | "en" } = {},
    ): Promise<FetchedDocument> {
        const lang = opts.lang ?? "ar";
        const cacheKey = `${id}:${lang}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        const url = id.startsWith("http")
            ? id
            : `${BASE}/LawPage.aspx?id=${encodeURIComponent(id)}&language=${lang}`;
        const { status, text } = await this.http.get(url);
        if (status !== 200) {
            throw new Error(`Al Meezan law fetch returned HTTP ${status}`);
        }
        const $ = cheerio.load(text);

        const title = $("h1, .law-title, .page-title").first().text().trim() || $("title").text().trim();
        const issueDate = $(".issue-date, .law-issue-date, [data-field='issue_date']").first().text().trim() || undefined;
        const lawNumber = $(".law-number, [data-field='law_number']").first().text().trim() || undefined;
        const lawType = $(".law-type, [data-field='law_type']").first().text().trim() || undefined;

        // Try to extract structured articles. Al Meezan typically renders each
        // article as a heading + body. Fall back to full main content text.
        const articles: { number?: string; text: string }[] = [];
        $("article, .article, .law-article").each((_, el) => {
            const num = $(el).find(".article-number, h2, h3").first().text().trim() || undefined;
            const body = $(el).find(".article-body, p").text().trim() || $(el).text().trim();
            if (body) articles.push({ number: num, text: body });
        });
        const fullText =
            articles.length > 0
                ? articles.map((a) => (a.number ? `${a.number}\n${a.text}` : a.text)).join("\n\n")
                : $(".main-content, #content, main").first().text().trim() || $("body").text().trim().slice(0, 30_000);

        const doc: FetchedDocument = {
            id,
            title: title.replace(/\s*\|\s*Al Meezan.*/i, "").trim(),
            url,
            lang,
            text: fullText,
            metadata: {
                issueDate,
                lawNumber,
                lawType,
                articleCount: articles.length,
            },
        };
        this.cache.set(cacheKey, doc);
        return doc;
    }

    private idFromUrl(url: string): string {
        const m = url.match(/[?&]id=([^&#]+)/);
        if (m) return m[1];
        return url;
    }
}
