import { startMcpServer } from "@maha/mcp-shared";
import { AdaaLatyScraper } from "./scraper.js";

const scraper = new AdaaLatyScraper();
const port = Number(process.env.PORT ?? 7013);

await startMcpServer({
    name: "adaalaty",
    version: "0.1.0",
    description:
        "Qatar Ministry of Justice (AdaaLaty) — judicial circulars, court services, ministerial decisions for the courts. Wraps moj.gov.qa. Must be deployed on Qatar-resident infrastructure.",
    port,
    tools: [
        {
            name: "search",
            description:
                "Full-text search across the Ministry of Justice site (circulars, decisions, services, news).",
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
            name: "list_circulars",
            description: "List recent judicial circulars and ministerial decisions affecting the courts.",
            inputSchema: {
                type: "object",
                properties: {
                    lang: { type: "string", enum: ["ar", "en"] },
                    limit: { type: "number" },
                },
            },
            handler: async (args) =>
                scraper.listCirculars({
                    lang: args.lang as "ar" | "en" | undefined,
                    limit: args.limit as number | undefined,
                }),
        },
        {
            name: "list_services",
            description: "List the public court services published by the Ministry of Justice (e.g. case lookup, certificate requests).",
            inputSchema: {
                type: "object",
                properties: {
                    lang: { type: "string", enum: ["ar", "en"] },
                    limit: { type: "number" },
                },
            },
            handler: async (args) =>
                scraper.listServices({
                    lang: args.lang as "ar" | "en" | undefined,
                    limit: args.limit as number | undefined,
                }),
        },
        {
            name: "fetch",
            description: "Fetch a single MoJ page (circular, decision, service description) by id (URL or path).",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    lang: { type: "string", enum: ["ar", "en"] },
                },
                required: ["id"],
            },
            handler: async (args) =>
                scraper.fetchPage(String(args.id), {
                    lang: args.lang as "ar" | "en" | undefined,
                }),
        },
    ],
});
