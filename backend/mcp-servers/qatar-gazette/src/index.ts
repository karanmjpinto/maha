import { startMcpServer } from "@maha/mcp-shared";
import { QatarGazetteScraper } from "./scraper.js";

const scraper = new QatarGazetteScraper();
const port = Number(process.env.PORT ?? 7012);

await startMcpServer({
    name: "qatar-gazette",
    version: "0.1.0",
    description:
        "Qatar Official Gazette (الجريدة الرسمية) — laws, decrees, government communications. Wraps gco.gov.qa. Must be deployed on Qatar-resident infrastructure (the upstream Cloudflare-blocks foreign IPs).",
    port,
    tools: [
        {
            name: "search",
            description:
                "Full-text search across the Qatar Official Gazette. Returns id, title, snippet, url. Defaults to Arabic.",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string" },
                    lang: { type: "string", enum: ["ar", "en"] },
                    limit: { type: "number" },
                },
                required: ["query"],
            },
            handler: async (args) =>
                scraper.search(String(args.query), {
                    lang: args.lang as "ar" | "en" | undefined,
                    limit: args.limit as number | undefined,
                }),
        },
        {
            name: "list_issues",
            description:
                "List gazette issues, optionally filtered by year. Returns id (year/issue), title, url.",
            inputSchema: {
                type: "object",
                properties: {
                    year: { type: "number", description: "Optional year filter (e.g. 2025)." },
                    lang: { type: "string", enum: ["ar", "en"] },
                    limit: { type: "number" },
                },
            },
            handler: async (args) =>
                scraper.listIssues({
                    year: args.year as number | undefined,
                    lang: args.lang as "ar" | "en" | undefined,
                    limit: args.limit as number | undefined,
                }),
        },
        {
            name: "fetch",
            description:
                "Fetch a single gazette issue by id. Id format is `<year>/<issue_number>` (e.g. `2025/14`) or a full URL. Returns title, issue date, summary, and PDF URLs.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    lang: { type: "string", enum: ["ar", "en"] },
                },
                required: ["id"],
            },
            handler: async (args) =>
                scraper.fetchIssue(String(args.id), {
                    lang: args.lang as "ar" | "en" | undefined,
                }),
        },
    ],
});
