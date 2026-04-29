import { pool } from "./db";

export type ProjectAccess =
    | {
          ok: true;
          isOwner: boolean;
          project: {
              id: string;
              user_id: string;
              shared_with: string[] | null;
          };
      }
    | { ok: false };

export async function checkProjectAccess(
    projectId: string,
    userId: string,
    userEmail: string | null | undefined,
): Promise<ProjectAccess> {
    const { rows } = await pool.query<{ id: string; user_id: string; shared_with: string[] | null }>(
        "SELECT id, user_id, shared_with FROM projects WHERE id = $1",
        [projectId],
    );
    const project = rows[0];
    if (!project) return { ok: false };
    if (project.user_id === userId) {
        return { ok: true, isOwner: true, project };
    }
    const sharedWith = Array.isArray(project.shared_with) ? project.shared_with : [];
    const email = (userEmail ?? "").toLowerCase();
    if (email && sharedWith.some((e) => (e ?? "").toLowerCase() === email)) {
        return { ok: true, isOwner: false, project };
    }
    return { ok: false };
}

export async function ensureDocAccess(
    doc: { user_id: string; project_id: string | null },
    userId: string,
    userEmail: string | null | undefined,
): Promise<{ ok: true; isOwner: boolean } | { ok: false }> {
    if (doc.user_id === userId) return { ok: true, isOwner: true };
    if (!doc.project_id) return { ok: false };
    const access = await checkProjectAccess(doc.project_id, userId, userEmail);
    if (access.ok) return { ok: true, isOwner: false };
    return { ok: false };
}

export async function ensureReviewAccess(
    review: {
        user_id: string;
        project_id: string | null;
        shared_with?: string[] | null;
    },
    userId: string,
    userEmail: string | null | undefined,
): Promise<{ ok: true; isOwner: boolean } | { ok: false }> {
    if (review.user_id === userId) return { ok: true, isOwner: true };
    const email = (userEmail ?? "").toLowerCase();
    if (email && Array.isArray(review.shared_with)) {
        if (review.shared_with.some((e) => (e ?? "").toLowerCase() === email)) {
            return { ok: true, isOwner: false };
        }
    }
    if (!review.project_id) return { ok: false };
    const access = await checkProjectAccess(review.project_id, userId, userEmail);
    if (access.ok) return { ok: true, isOwner: false };
    return { ok: false };
}

export async function listAccessibleProjectIds(
    userId: string,
    userEmail: string | null | undefined,
): Promise<string[]> {
    const emailParam = (userEmail ?? "").toLowerCase();
    const { rows } = await pool.query<{ id: string }>(
        `SELECT DISTINCT id FROM projects
         WHERE user_id = $1
            OR ($2 <> '' AND shared_with @> $3::jsonb)`,
        [userId, emailParam, JSON.stringify([emailParam])],
    );
    return rows.map((r) => r.id);
}
