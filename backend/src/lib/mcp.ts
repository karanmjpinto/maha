import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { OpenAIToolSchema } from "./llm/types";

type MCPServerConfig = {
    name: string;
    url: string;
    apiKey?: string;
};

type MCPClientEntry = {
    config: MCPServerConfig;
    client: Client | null;
    connecting: Promise<Client | null> | null; // in-flight lock prevents concurrent connect races
    toolNames: Set<string>;
};

function parseServersConfig(): MCPServerConfig[] {
    const raw = process.env.MCP_SERVERS;
    if (!raw) return [];
    try {
        return JSON.parse(raw) as MCPServerConfig[];
    } catch {
        console.error("[mcp] Invalid MCP_SERVERS env var — must be a JSON array");
        return [];
    }
}

const entries: MCPClientEntry[] = parseServersConfig().map((config) => ({
    config,
    client: null,
    connecting: null,
    toolNames: new Set(),
}));

async function getClient(entry: MCPClientEntry): Promise<Client | null> {
    if (entry.client) return entry.client;
    // If a connect is already in flight, wait for it instead of racing
    if (entry.connecting) return entry.connecting;
    entry.connecting = (async () => {
        try {
            const headers: Record<string, string> = {};
            if (entry.config.apiKey) {
                headers["Authorization"] = `Bearer ${entry.config.apiKey}`;
            }
            const transport = new SSEClientTransport(new URL(entry.config.url), {
                requestInit: { headers },
            });
            const client = new Client({ name: "emilie", version: "1.0.0" });
            await client.connect(transport);
            entry.client = client;
            return client;
        } catch (err) {
            console.error(`[mcp] Failed to connect to ${entry.config.name}:`, err);
            return null;
        } finally {
            entry.connecting = null;
        }
    })();
    return entry.connecting;
}

export async function getMCPTools(): Promise<OpenAIToolSchema[]> {
    const tools: OpenAIToolSchema[] = [];
    for (const entry of entries) {
        const client = await getClient(entry);
        if (!client) continue;
        try {
            const result = await client.listTools();
            // Atomic swap: only update toolNames after a successful listTools,
            // so isMCPTool() never sees an empty set from a transient failure
            const freshNames = new Set<string>();
            for (const tool of result.tools) {
                freshNames.add(tool.name);
                tools.push({
                    type: "function",
                    function: {
                        name: tool.name,
                        description: tool.description ?? "",
                        parameters:
                            (tool.inputSchema as Record<string, unknown>) ?? {
                                type: "object",
                                properties: {},
                            },
                    },
                });
            }
            entry.toolNames = freshNames;
        } catch (err) {
            console.error(`[mcp] Failed to list tools from ${entry.config.name}:`, err);
            entry.client = null;
        }
    }
    return tools;
}

export function isMCPTool(name: string): boolean {
    return entries.some((e) => e.toolNames.has(name));
}

export async function callMCPTool(
    name: string,
    input: Record<string, unknown>,
): Promise<string> {
    for (const entry of entries) {
        if (!entry.toolNames.has(name)) continue;
        const client = await getClient(entry);
        if (!client) {
            return JSON.stringify({ error: `MCP server ${entry.config.name} unavailable` });
        }
        try {
            const result = await client.callTool({ name, arguments: input });
            const content = result.content;
            if (Array.isArray(content)) {
                return content
                    .map((c) =>
                        typeof c === "object" && c !== null && "text" in c
                            ? (c as { text: string }).text
                            : JSON.stringify(c),
                    )
                    .join("\n");
            }
            return JSON.stringify(content);
        } catch (err) {
            entry.client = null;
            return JSON.stringify({ error: String(err) });
        }
    }
    return JSON.stringify({ error: `No MCP server handles tool: ${name}` });
}
