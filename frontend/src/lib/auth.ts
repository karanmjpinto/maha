import { NextRequest } from "next/server";

// Supabase replaced with custom JWT auth on the Express backend.
// This function is no longer used — the Express backend handles all auth.
export async function getUserFromRequest(
    _request: NextRequest,
): Promise<{ email: string; id: string } | null> {
    throw new Error("getUserFromRequest removed — use Express backend auth");
}
