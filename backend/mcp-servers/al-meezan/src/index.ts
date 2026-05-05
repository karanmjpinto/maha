import { startMcpServer } from "@maha/mcp-shared";
import { AlMeezanScraper } from "./scraper.js";

const scraper = new AlMeezanScraper();
const port = Number(process.env.PORT ?? 7010);

await startMcpServer({
    name: "al-meezan",
    version: "0.1.0",
    description:
        "Al Meezan portal — Qatari laws, decrees, ministerial decisions, treaties. Bilingual (ar/en). Wraps almeezan.qa. Must be deployed on Qatar-resident infrastructure (the upstream blocks foreign IPs).",
    port,
    tools: [
        {
            name: "search",
            description:
                "Full-text search across Qatari laws and decrees. Returns id, title, snippet, url. Defaults to Arabic; pass lang='en' for the English mirror.",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query in Arabic or English." },
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
            name: "list_recent",
            description: "List most recently issued Qatari laws and decrees.",
            inputSchema: {
                type: "object",
                properties: {
                    lang: { type: "string", enum: ["ar", "en"] },
                    limit: { type: "number" },
                },
            },
            handler: async (args) =>
                scraper.listRecent({
                    lang: args.lang as "ar" | "en" | undefined,
                    limit: args.limit as number | undefined,
                }),
        },
        {
            name: "fetch",
            description:
                "Fetch the full text of a single law, decree, or ministerial decision by id. The id is the numeric portal id returned by search() or list_recent(). Returns title, issue date, law number, and full body (article-by-article when the upstream renders structure).",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    lang: { type: "string", enum: ["ar", "en"] },
                },
                required: ["id"],
            },
            handler: async (args) =>
                scraper.fetchLaw(String(args.id), {
                    lang: args.lang as "ar" | "en" | undefined,
                }),
        },
    ],
});
