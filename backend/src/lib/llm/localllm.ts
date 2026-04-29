import type { StreamChatParams, StreamChatResult, NormalizedToolCall, OpenAIToolSchema } from "./types";

interface ChatMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_calls?: ToolCallWire[];
    tool_call_id?: string;
}

interface ToolCallWire {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
}

interface StreamChunk {
    choices: Array<{
        delta: {
            content?: string;
            tool_calls?: Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
            }>;
        };
    }>;
}

interface CompletionResponse {
    choices: Array<{ message: { content: string | null } }>;
}

function resolveModel(model: string): string {
    if (model === "localllm-light") return process.env.VLLM_LIGHT_MODEL ?? model;
    return process.env.VLLM_MAIN_MODEL ?? model;
}

function endpoint(baseURL: string, path: string): string {
    return `${baseURL.replace(/\/$/, "")}${path}`;
}

function authHeaders(apiKey: string): Record<string, string> {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey || "local"}`,
    };
}

// Build tool payload directly from the OpenAIToolSchema input — no round-trip
// through toClaudeTools, which would mutate schemas unnecessarily.
function buildTools(tools: OpenAIToolSchema[] | undefined) {
    if (!tools?.length) return undefined;
    return tools.map((t) => ({
        type: "function" as const,
        function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
        },
    }));
}

async function* parseSSE(response: Response): AsyncGenerator<StreamChunk> {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const tryYield = function* (line: string): Generator<StreamChunk> {
        if (!line.startsWith("data: ")) return;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") return;
        try {
            yield JSON.parse(data) as StreamChunk;
        } catch {
            // skip malformed chunks
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            // Flush any remaining partial line before exiting
            if (buffer.trim()) yield* tryYield(buffer.trim());
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            yield* tryYield(line);
        }
    }
}

export async function streamLocalLLM(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const { model, systemPrompt, tools = [], callbacks = {}, runTools } = params;
    const maxIter = params.maxIterations ?? 10;
    const baseURL = process.env.VLLM_BASE_URL ?? "";
    const apiKey = process.env.VLLM_API_KEY ?? "";
    if (!baseURL) throw new Error("VLLM_BASE_URL is not set — cannot use local model");

    const resolvedModel = resolveModel(model);
    const builtTools = buildTools(tools);

    const messages: ChatMessage[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    for (const m of params.messages) messages.push({ role: m.role, content: m.content });

    // Track only the final assistant turn's text, not intermediate tool-loop turns
    let finalText = "";

    for (let iter = 0; iter < maxIter; iter++) {
        const response = await fetch(endpoint(baseURL, "/chat/completions"), {
            method: "POST",
            headers: authHeaders(apiKey),
            body: JSON.stringify({
                model: resolvedModel,
                messages,
                tools: builtTools,
                stream: true,
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Local LLM error: ${response.status} ${err}`);
        }

        const toolCallAccumulators: Record<
            number,
            { id: string; name: string; args: string }
        > = {};
        const textParts: string[] = [];

        for await (const chunk of parseSSE(response)) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
                textParts.push(delta.content);
                callbacks.onContentDelta?.(delta.content);
            }

            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index;
                    if (!toolCallAccumulators[idx]) {
                        // Set id only once from the first delta that provides it
                        toolCallAccumulators[idx] = {
                            id: tc.id ?? `tool-${idx}`,
                            name: tc.function?.name ?? "",
                            args: "",
                        };
                    }
                    if (tc.function?.name) toolCallAccumulators[idx].name = tc.function.name;
                    if (tc.function?.arguments) toolCallAccumulators[idx].args += tc.function.arguments;
                }
            }
        }

        const iterText = textParts.join("");
        const toolCalls: NormalizedToolCall[] = Object.values(toolCallAccumulators).map(
            (acc) => {
                let input: Record<string, unknown> = {};
                try {
                    input = JSON.parse(acc.args || "{}");
                } catch {
                    // ignore malformed args
                }
                const call: NormalizedToolCall = { id: acc.id, name: acc.name, input };
                callbacks.onToolCallStart?.(call);
                return call;
            },
        );

        if (!toolCalls.length || !runTools) {
            // This is the final turn — capture its text as the result
            finalText = iterText;
            break;
        }

        const results = await runTools(toolCalls);

        messages.push({
            role: "assistant",
            content: iterText || null,
            tool_calls: Object.values(toolCallAccumulators).map((acc) => ({
                id: acc.id,
                type: "function" as const,
                function: { name: acc.name, arguments: acc.args },
            })),
        });

        for (const r of results) {
            messages.push({ role: "tool", tool_call_id: r.tool_use_id, content: r.content });
        }
    }

    return { fullText: finalText };
}

export async function completeLocalLLMText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
}): Promise<string> {
    const baseURL = process.env.VLLM_BASE_URL ?? "";
    const apiKey = process.env.VLLM_API_KEY ?? "";
    if (!baseURL) throw new Error("VLLM_BASE_URL is not set");

    const resolvedModel = resolveModel(params.model);
    const messages: ChatMessage[] = [
        ...(params.systemPrompt ? [{ role: "system" as const, content: params.systemPrompt }] : []),
        { role: "user" as const, content: params.user },
    ];

    const response = await fetch(endpoint(baseURL, "/chat/completions"), {
        method: "POST",
        headers: authHeaders(apiKey),
        body: JSON.stringify({
            model: resolvedModel,
            max_tokens: params.maxTokens ?? 512,
            messages,
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Local LLM error: ${response.status} ${err}`);
    }

    const data = (await response.json()) as CompletionResponse;
    return data.choices[0]?.message?.content ?? "";
}
