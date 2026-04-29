import { pool } from "./db";
import { resolveModel, DEFAULT_TITLE_MODEL, DEFAULT_TABULAR_MODEL, type UserApiKeys } from "./llm";

export type UserModelSettings = {
    title_model: string;
    tabular_model: string;
    api_keys: UserApiKeys;
};

function resolveTitleModel(apiKeys: UserApiKeys): string {
    if (apiKeys.gemini?.trim()) return DEFAULT_TITLE_MODEL;
    if (apiKeys.claude?.trim()) return "claude-haiku-4-5";
    return DEFAULT_TITLE_MODEL;
}

export async function getUserModelSettings(userId: string): Promise<UserModelSettings> {
    const { rows } = await pool.query<{
        tabular_model: string | null;
        claude_api_key: string | null;
        gemini_api_key: string | null;
    }>(
        "SELECT tabular_model, claude_api_key, gemini_api_key FROM user_profiles WHERE user_id = $1",
        [userId],
    );
    const data = rows[0] ?? null;
    const api_keys: UserApiKeys = {
        claude: data?.claude_api_key ?? null,
        gemini: data?.gemini_api_key ?? null,
    };
    return {
        title_model: resolveTitleModel(api_keys),
        tabular_model: resolveModel(data?.tabular_model, DEFAULT_TABULAR_MODEL),
        api_keys,
    };
}

export async function getUserApiKeys(userId: string): Promise<UserApiKeys> {
    const { rows } = await pool.query<{
        claude_api_key: string | null;
        gemini_api_key: string | null;
    }>(
        "SELECT claude_api_key, gemini_api_key FROM user_profiles WHERE user_id = $1",
        [userId],
    );
    const data = rows[0] ?? null;
    return {
        claude: data?.claude_api_key ?? null,
        gemini: data?.gemini_api_key ?? null,
    };
}
