import { MODELS, type ModelOption } from "../components/assistant/ModelToggle";

export type ModelProvider = "claude" | "gemini" | "local";

export function getModelProvider(modelId: string): ModelProvider | null {
    const model = MODELS.find((m) => m.id === modelId);
    if (!model) return null;
    if (model.group === "Anthropic") return "claude";
    if (model.group === "Local") return "local";
    return "gemini";
}

export function isModelAvailable(
    modelId: string,
    apiKeys: { claudeApiKey: string | null; geminiApiKey: string | null },
): boolean {
    const provider = getModelProvider(modelId);
    if (!provider) return false;
    // Local models are always available — the backend enforces VLLM_BASE_URL.
    if (provider === "local") return true;
    return provider === "claude"
        ? !!apiKeys.claudeApiKey?.trim()
        : !!apiKeys.geminiApiKey?.trim();
}

export function isProviderAvailable(
    provider: ModelProvider,
    apiKeys: { claudeApiKey: string | null; geminiApiKey: string | null },
): boolean {
    if (provider === "local") return true;
    return provider === "claude"
        ? !!apiKeys.claudeApiKey?.trim()
        : !!apiKeys.geminiApiKey?.trim();
}

export function providerLabel(provider: ModelProvider): string {
    if (provider === "claude") return "Anthropic (Claude)";
    if (provider === "local") return "Local (Apertus / vLLM)";
    return "Google (Gemini)";
}

export function modelGroupToProvider(
    group: ModelOption["group"],
): ModelProvider {
    if (group === "Anthropic") return "claude";
    if (group === "Local") return "local";
    return "gemini";
}
