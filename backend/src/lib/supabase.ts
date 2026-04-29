// Supabase replaced with direct Postgres + custom JWT auth.
// All route files import pool from ./db directly.
// This file is kept only so stale import paths resolve during migration.
export { pool } from "./db";
