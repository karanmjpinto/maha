import { Router } from "express";
import { pool } from "../lib/db";
import { hashPassword, verifyPassword } from "../lib/authPasswords";
import { signToken } from "../lib/authTokens";

export const authRouter = Router();

// POST /auth/signup
authRouter.post("/signup", async (req, res) => {
    const { email, password, name, organisation } = req.body as {
        email?: string;
        password?: string;
        name?: string;
        organisation?: string;
    };
    if (!email || !password) {
        return void res.status(400).json({ detail: "email and password are required" });
    }
    const normalizedEmail = email.toLowerCase().trim();
    if (password.length < 8) {
        return void res.status(400).json({ detail: "password must be at least 8 characters" });
    }

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
    if (existing.rows.length > 0) {
        return void res.status(409).json({ detail: "email already registered" });
    }

    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
        [normalizedEmail, passwordHash],
    );
    const userId: string = rows[0].id;

    const trimmedName = name?.trim() || null;
    const trimmedOrg = organisation?.trim() || null;
    await pool.query(
        `INSERT INTO user_profiles (user_id, display_name, organisation)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
         SET display_name = COALESCE(EXCLUDED.display_name, user_profiles.display_name),
             organisation = COALESCE(EXCLUDED.organisation, user_profiles.organisation)`,
        [userId, trimmedName, trimmedOrg],
    );

    const token = signToken({ sub: userId, email: normalizedEmail });
    res.status(201).json({ token, userId, email: normalizedEmail });
});

// POST /auth/login
authRouter.post("/login", async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
        return void res.status(400).json({ detail: "email and password are required" });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const { rows } = await pool.query(
        "SELECT id, password_hash FROM users WHERE email = $1",
        [normalizedEmail],
    );
    if (rows.length === 0) {
        return void res.status(401).json({ detail: "invalid credentials" });
    }

    const valid = await verifyPassword(password, rows[0].password_hash as string);
    if (!valid) {
        return void res.status(401).json({ detail: "invalid credentials" });
    }

    const userId: string = rows[0].id;
    const token = signToken({ sub: userId, email: normalizedEmail });
    res.json({ token, userId, email: normalizedEmail });
});
