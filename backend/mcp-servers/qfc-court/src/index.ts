import { startMcpServer } from "@maha/mcp-shared";
import { QfcCourtScraper } from "./scraper.js";

const scraper = new QfcCourtScraper();
const port = Number(process.env.PORT ?? 7011);

await startMcpServer({
    name: "qfc-court",
    version: "0.1.0",
    description:
        "Qatar Financial Centre (QFC) Civil & Commercial Court and Regulatory Tribunal judgments. Wraps qicdrc.gov.qa.",
    port,
    tools: [
        {
            name: "search",
            description:
                "Full-text search over QFC Court judgments and arbitration awards. Returns id, title, snippet, url. Use the id with fetch() to retrieve the full document.",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query in English or Arabic." },
                    lang: { type: "string", enum: ["en", "ar"], description: "Language version of the portal to search. Defaults to en." },
                    limit: { type: "number", description: "Max results (default 20)." },
                },
                required: ["query"],
            },
            handler: async (args) =>
                scraper.search(String(args.query), {
                    lang: args.lang as "en" | "ar" | undefined,
                    limit: args.limit as number | undefined,
                }),
        },
        {
            name: "list_recent",
            description: "List the most recently published QFC Court judgments.",
            inputSchema: {
                type: "object",
                properties: {
                    limit: { type: "number", description: "Max results (default 20)." },
                },
            },
            handler: async (args) => scraper.listRecent(args.limit as number | undefined),
        },
        {
            name: "fetch",
            description:
                "Fetch the full text and metadata of a single judgment. Pass the id returned by search() or list_recent(). Returns title, case number, date, judges, keywords, body text, and PDF URLs.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "Judgment id (e.g. ctfic00092026) or full URL." },
                },
                required: ["id"],
            },
            handler: async (args) => scraper.fetchDocument(String(args.id)),
        },
    ],
});
