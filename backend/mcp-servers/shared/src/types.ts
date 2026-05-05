export type ToolDef = {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
};

export type McpServerConfig = {
    name: string;
    version: string;
    description: string;
    port: number;
    tools: ToolDef[];
};

// Standard result shape for search operations across every Maha MCP server.
// Keep this stable so the LLM can reason about results uniformly.
export type SearchResult = {
    id: string;
    title: string;
    snippet?: string;
    url: string;
    lang?: "ar" | "en";
    date?: string;
    source: string;
};

export type FetchedDocument = {
    id: string;
    title: string;
    url: string;
    lang?: "ar" | "en";
    text: string;
    metadata: Record<string, unknown>;
    pdfUrls?: string[];
};
