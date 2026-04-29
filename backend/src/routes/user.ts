import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { pool } from "../lib/db";

export const userRouter = Router();

// POST /user/profile — ensure profile row exists for authenticated user
userRouter.post("/profile", requireAuth, async (_req, res) => {
    const userId = res.locals.userId as string;
    try {
        await pool.query(
            "INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
            [userId],
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ detail: String(err) });
    }
});

// GET /user/profile — return the authenticated user's profile
userRouter.get("/profile", requireAuth, async (_req, res) => {
    const userId = res.locals.userId as string;
    try {
        const { rows } = await pool.query(
            `SELECT display_name, organisation, message_credits_used, credits_reset_date,
                    tier, tabular_model, claude_api_key, gemini_api_key
             FROM user_profiles WHERE user_id = $1`,
            [userId],
        );
        if (!rows[0]) return void res.status(404).json({ detail: "Profile not found" });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ detail: String(err) });
    }
});

// PATCH /user/profile — update settable profile fields
userRouter.patch("/profile", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;

    const ALLOWED: Record<string, string> = {
        display_name: "display_name",
        organisation: "organisation",
        tabular_model: "tabular_model",
        claude_api_key: "claude_api_key",
        gemini_api_key: "gemini_api_key",
        message_credits_used: "message_credits_used",
        credits_reset_date: "credits_reset_date",
    };

    const updates: { col: string; val: unknown }[] = [];
    for (const [key, col] of Object.entries(ALLOWED)) {
        if (key in req.body) updates.push({ col, val: req.body[key] });
    }

    if (updates.length === 0) {
        return void res.status(400).json({ detail: "No valid fields provided" });
    }

    const setClauses = updates.map((u, i) => `${u.col} = $${i + 1}`).join(", ");
    const values = [...updates.map((u) => u.val), userId];

    try {
        await pool.query(
            `UPDATE user_profiles SET ${setClauses}, updated_at = now() WHERE user_id = $${values.length}`,
            values,
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ detail: String(err) });
    }
});

// DELETE /user/account — permanently delete user (cascades to all user data)
userRouter.delete("/account", requireAuth, async (_req, res) => {
    const userId = res.locals.userId as string;
    try {
        await pool.query("DELETE FROM users WHERE id = $1", [userId]);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ detail: String(err) });
    }
});
