import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { pool } from "../lib/db";

export const workflowsRouter = Router();

type WorkflowRecord = {
    id: string;
    user_id: string | null;
    is_system: boolean;
    [key: string]: unknown;
};

type WorkflowAccess =
    | { workflow: WorkflowRecord; allowEdit: boolean; isOwner: boolean }
    | null;

function withWorkflowAccess<T extends Record<string, unknown>>(
    workflow: T,
    access: { allowEdit: boolean; isOwner: boolean; sharedByName?: string | null },
) {
    return {
        ...workflow,
        allow_edit: access.allowEdit,
        is_owner: access.isOwner,
        shared_by_name: access.sharedByName ?? null,
    };
}

async function resolveWorkflowAccess(
    workflowId: string,
    userId: string,
    userEmail: string | null | undefined,
): Promise<WorkflowAccess> {
    const { rows } = await pool.query<WorkflowRecord>(
        "SELECT * FROM workflows WHERE id = $1",
        [workflowId],
    );
    const workflow = rows[0];
    if (!workflow) return null;
    if (workflow.user_id === userId) {
        return { workflow, allowEdit: true, isOwner: true };
    }

    const normalizedUserEmail = (userEmail ?? "").trim().toLowerCase();
    if (!normalizedUserEmail) return null;

    const { rows: shareRows } = await pool.query<{ allow_edit: boolean }>(
        "SELECT allow_edit FROM workflow_shares WHERE workflow_id = $1 AND shared_with_email = $2 LIMIT 1",
        [workflowId, normalizedUserEmail],
    );
    const share = shareRows[0];
    if (!share) return null;

    return { workflow, allowEdit: !!share.allow_edit, isOwner: false };
}

// GET /workflows
workflowsRouter.get("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string;
    const { type } = req.query as { type?: string };

    const typeFilter = type ? " AND type = $2" : "";
    const ownParams: unknown[] = type ? [userId, type] : [userId];
    const { rows: own } = await pool.query(
        `SELECT * FROM workflows WHERE user_id = $1 AND is_system = false${typeFilter} ORDER BY created_at DESC`,
        ownParams,
    );

    const normalizedUserEmail = userEmail.trim().toLowerCase();
    const { rows: shares } = await pool.query<{ workflow_id: string; shared_by_user_id: string; allow_edit: boolean }>(
        "SELECT workflow_id, shared_by_user_id, allow_edit FROM workflow_shares WHERE shared_with_email = $1",
        [normalizedUserEmail],
    );

    let sharedWorkflows: Record<string, unknown>[] = [];
    if (shares.length > 0) {
        const sharedIds = shares.map((s) => s.workflow_id);
        const typeFilterShared = type ? " AND type = $2" : "";
        const sharedParams: unknown[] = type ? [sharedIds, type] : [sharedIds];
        const { rows: wfs } = await pool.query(
            `SELECT * FROM workflows WHERE id = ANY($1::uuid[])${typeFilterShared}`,
            sharedParams,
        );

        if (wfs.length > 0) {
            const sharerIds = [...new Set(shares.map((s) => s.shared_by_user_id).filter(Boolean))];
            const profileMap = new Map<string, string | null>();
            const emailMap = new Map<string, string>();

            if (sharerIds.length > 0) {
                const { rows: profiles } = await pool.query<{ user_id: string; display_name: string | null }>(
                    "SELECT user_id, display_name FROM user_profiles WHERE user_id = ANY($1::uuid[])",
                    [sharerIds],
                );
                for (const p of profiles) profileMap.set(p.user_id, p.display_name ?? null);

                const { rows: users } = await pool.query<{ id: string; email: string }>(
                    "SELECT id, email FROM users WHERE id = ANY($1::uuid[])",
                    [sharerIds],
                );
                for (const u of users) emailMap.set(u.id, u.email);
            }

            sharedWorkflows = wfs.map((wf) => {
                const share = shares.find((s) => s.workflow_id === wf.id);
                const sharerId = share?.shared_by_user_id;
                const shared_by_name = (sharerId ? profileMap.get(sharerId) : null)
                    || (sharerId ? emailMap.get(sharerId) : null)
                    || null;
                return withWorkflowAccess(wf as Record<string, unknown>, {
                    allowEdit: !!share?.allow_edit,
                    isOwner: false,
                    sharedByName: shared_by_name,
                });
            });
        }
    }

    const ownWithFlag = own.map((wf) =>
        withWorkflowAccess(wf as Record<string, unknown>, { allowEdit: true, isOwner: true }),
    );
    res.json([...ownWithFlag, ...sharedWorkflows]);
});

// POST /workflows
workflowsRouter.post("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { title, type, prompt_md, columns_config, practice } = req.body as {
        title: string; type: string; prompt_md?: string;
        columns_config?: unknown; practice?: string | null;
    };
    if (!title?.trim()) return void res.status(400).json({ detail: "title is required" });
    if (!["assistant", "tabular"].includes(type))
        return void res.status(400).json({ detail: "type must be 'assistant' or 'tabular'" });

    const { rows } = await pool.query(
        `INSERT INTO workflows (user_id, title, type, prompt_md, columns_config, practice, is_system)
         VALUES ($1,$2,$3,$4,$5,$6,false) RETURNING *`,
        [userId, title.trim(), type, prompt_md ?? null, columns_config ? JSON.stringify(columns_config) : null, practice ?? null],
    );
    res.status(201).json(rows[0]);
});

async function handleWorkflowUpdate(req: import("express").Request, res: import("express").Response) {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { workflowId } = req.params;

    const updates: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => { params.push(val); updates.push(`${col} = $${params.length}`); };

    if (req.body.title != null) push("title", req.body.title);
    if (req.body.prompt_md != null) push("prompt_md", req.body.prompt_md);
    if (req.body.columns_config != null) push("columns_config", JSON.stringify(req.body.columns_config));
    if ("practice" in req.body) push("practice", req.body.practice ?? null);

    const access = await resolveWorkflowAccess(workflowId, userId, userEmail);
    if (!access || access.workflow.is_system || !access.allowEdit) {
        return void res.status(404).json({ detail: "Workflow not found or not editable" });
    }
    if (updates.length === 0) return void res.json(withWorkflowAccess(access.workflow, access));

    params.push(workflowId);
    const { rows } = await pool.query(
        `UPDATE workflows SET ${updates.join(", ")} WHERE id = $${params.length} AND is_system = false RETURNING *`,
        params,
    );
    if (!rows[0]) return void res.status(404).json({ detail: "Workflow not found or not editable" });
    res.json(withWorkflowAccess(rows[0] as Record<string, unknown>, { allowEdit: access.allowEdit, isOwner: access.isOwner }));
}

workflowsRouter.put("/:workflowId", requireAuth, handleWorkflowUpdate);
workflowsRouter.patch("/:workflowId", requireAuth, handleWorkflowUpdate);

// DELETE /workflows/:workflowId
workflowsRouter.delete("/:workflowId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { workflowId } = req.params;
    await pool.query(
        "DELETE FROM workflows WHERE id = $1 AND user_id = $2 AND is_system = false",
        [workflowId, userId],
    );
    res.status(204).send();
});

// GET /workflows/hidden
workflowsRouter.get("/hidden", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { rows } = await pool.query<{ workflow_id: string }>(
        "SELECT workflow_id FROM hidden_workflows WHERE user_id = $1",
        [userId],
    );
    res.json(rows.map((r) => r.workflow_id));
});

// POST /workflows/hidden
workflowsRouter.post("/hidden", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { workflow_id } = req.body as { workflow_id: string };
    if (!workflow_id?.trim()) return void res.status(400).json({ detail: "workflow_id is required" });
    await pool.query(
        "INSERT INTO hidden_workflows (user_id, workflow_id) VALUES ($1,$2) ON CONFLICT (user_id, workflow_id) DO NOTHING",
        [userId, workflow_id],
    );
    res.status(204).send();
});

// DELETE /workflows/hidden/:workflowId
workflowsRouter.delete("/hidden/:workflowId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { workflowId } = req.params;
    await pool.query(
        "DELETE FROM hidden_workflows WHERE user_id = $1 AND workflow_id = $2",
        [userId, workflowId],
    );
    res.status(204).send();
});

// GET /workflows/:workflowId
workflowsRouter.get("/:workflowId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { workflowId } = req.params;
    const access = await resolveWorkflowAccess(workflowId, userId, userEmail);
    if (!access) return void res.status(404).json({ detail: "Workflow not found" });
    res.json(withWorkflowAccess(access.workflow, { allowEdit: access.allowEdit, isOwner: access.isOwner }));
});

// GET /workflows/:workflowId/shares
workflowsRouter.get("/:workflowId/shares", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { workflowId } = req.params;

    const { rows: wfRows } = await pool.query<{ id: string }>(
        "SELECT id FROM workflows WHERE id = $1 AND user_id = $2 AND is_system = false",
        [workflowId, userId],
    );
    if (!wfRows[0]) return void res.status(404).json({ detail: "Workflow not found or not editable" });

    const { rows } = await pool.query(
        "SELECT id, shared_with_email, allow_edit, created_at FROM workflow_shares WHERE workflow_id = $1 ORDER BY created_at ASC",
        [workflowId],
    );
    res.json(rows);
});

// DELETE /workflows/:workflowId/shares/:shareId
workflowsRouter.delete("/:workflowId/shares/:shareId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { workflowId, shareId } = req.params;

    const { rows: wfRows } = await pool.query<{ id: string }>(
        "SELECT id FROM workflows WHERE id = $1 AND user_id = $2",
        [workflowId, userId],
    );
    if (!wfRows[0]) return void res.status(404).json({ detail: "Workflow not found" });

    await pool.query(
        "DELETE FROM workflow_shares WHERE id = $1 AND workflow_id = $2",
        [shareId, workflowId],
    );
    res.status(204).send();
});

// POST /workflows/:workflowId/share
workflowsRouter.post("/:workflowId/share", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { workflowId } = req.params;
    const { emails, allow_edit } = req.body as { emails: string[]; allow_edit: boolean };
    if (!emails?.length) return void res.status(400).json({ detail: "emails is required" });

    const { rows: wfRows } = await pool.query<{ id: string }>(
        "SELECT id FROM workflows WHERE id = $1 AND user_id = $2 AND is_system = false",
        [workflowId, userId],
    );
    if (!wfRows[0]) return void res.status(404).json({ detail: "Workflow not found or not editable" });

    const placeholders = emails.map((_, i) => `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4})`).join(",");
    const params = emails.flatMap((email) => [
        workflowId,
        userId,
        email.trim().toLowerCase(),
        allow_edit ?? false,
    ]);
    await pool.query(
        `INSERT INTO workflow_shares (workflow_id, shared_by_user_id, shared_with_email, allow_edit)
         VALUES ${placeholders}
         ON CONFLICT (workflow_id, shared_with_email) DO UPDATE SET allow_edit = EXCLUDED.allow_edit`,
        params,
    );
    res.status(204).send();
});
