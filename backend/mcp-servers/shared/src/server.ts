// Bootstrap an MCP server over Streamable HTTP transport.
// Each Maha MCP server (al-meezan, qfc-court, qatar-gazette, adaalaty) calls
// startMcpServer with its own tool definitions and listens on its own port.

import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServerConfig } from "./types.js";

export async function startMcpServer(config: McpServerConfig): Promise<void> {
    const server = new Server(
        { name: config.name, version: config.version },
        { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: config.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
        })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const tool = config.tools.find((t) => t.name === req.params.name);
        if (!tool) {
            throw new Error(`Unknown tool: ${req.params.name}`);
        }
        const args = (req.params.arguments ?? {}) as Record<string, unknown>;
        const result = await tool.handler(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    });

    const app = express();
    app.use(express.json({ limit: "1mb" }));

    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
    });
    await server.connect(transport);

    app.post("/mcp", async (req, res) => {
        try {
            await transport.handleRequest(req, res, req.body);
        } catch (err) {
            console.error(`[${config.name}] /mcp error:`, err);
            if (!res.headersSent) {
                res.status(500).json({ error: String(err) });
            }
        }
    });

    app.get("/healthz", (_req, res) => {
        res.json({ name: config.name, version: config.version, status: "ok" });
    });

    app.listen(config.port, () => {
        console.log(
            `[${config.name}] MCP server listening on http://0.0.0.0:${config.port}/mcp`,
        );
        console.log(
            `[${config.name}] tools: ${config.tools.map((t) => t.name).join(", ")}`,
        );
    });
}
