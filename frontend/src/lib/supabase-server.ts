// Supabase replaced with custom JWT auth on the Express backend.
// These functions are no longer used — the Express backend handles all auth.
export function createServerSupabase(): never {
    throw new Error("createServerSupabase removed — use Express backend auth");
}

export async function getUserIdFromRequest(_req: Request): Promise<string> {
    throw new Error("getUserIdFromRequest removed — use Express backend auth");
}
