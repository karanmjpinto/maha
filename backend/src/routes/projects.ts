import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { pool } from "../lib/db";
import {
    attachActiveVersionPaths,
    attachLatestVersionNumbers,
} from "../lib/documentVersions";
import { downloadFile, uploadFile, storageKey } from "../lib/storage";
import { docxToPdf, convertedPdfKey } from "../lib/convert";
import { checkProjectAccess } from "../lib/access";
import { singleFileUpload } from "../lib/upload";

export const projectsRouter = Router();
const ALLOWED_TYPES = new Set(["pdf", "docx", "doc"]);

// GET /projects
projectsRouter.get("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string;

    const emailParam = (userEmail ?? "").toLowerCase();
    const { rows: projects } = await pool.query(
        `SELECT DISTINCT * FROM projects
         WHERE user_id = $1
            OR ($2 <> '' AND shared_with @> $3::jsonb)
         ORDER BY created_at DESC`,
        [userId, emailParam, JSON.stringify([emailParam])],
    );

    const result = await Promise.all(
        projects.map(async (p: Record<string, unknown>) => {
            const [docCount, chatCount, reviewCount] = await Promise.all([
                pool.query<{ count: string }>("SELECT COUNT(*) FROM documents WHERE project_id = $1", [p.id]),
                pool.query<{ count: string }>("SELECT COUNT(*) FROM chats WHERE project_id = $1", [p.id]),
                pool.query<{ count: string }>("SELECT COUNT(*) FROM tabular_reviews WHERE project_id = $1", [p.id]),
            ]);
            return {
                ...p,
                is_owner: p.user_id === userId,
                document_count: parseInt(docCount.rows[0]?.count ?? "0", 10),
                chat_count: parseInt(chatCount.rows[0]?.count ?? "0", 10),
                review_count: parseInt(reviewCount.rows[0]?.count ?? "0", 10),
            };
        }),
    );
    res.json(result);
});

// POST /projects
projectsRouter.post("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { name, cm_number, shared_with } = req.body as {
        name: string; cm_number?: string; shared_with?: string[];
    };
    if (!name?.trim()) return void res.status(400).json({ detail: "name is required" });

    const { rows } = await pool.query(
        `INSERT INTO projects (user_id, name, cm_number, shared_with)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [userId, name.trim(), cm_number ?? null, JSON.stringify(shared_with ?? [])],
    );
    res.status(201).json({ ...rows[0], documents: [] });
});

// GET /projects/:projectId
projectsRouter.get("/:projectId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string;
    const { projectId } = req.params;

    const { rows } = await pool.query("SELECT * FROM projects WHERE id = $1", [projectId]);
    const project = rows[0];
    if (!project) return void res.status(404).json({ detail: "Project not found" });

    const canAccess =
        project.user_id === userId ||
        (userEmail &&
            Array.isArray(project.shared_with) &&
            project.shared_with.includes(userEmail));
    if (!canAccess) return void res.status(404).json({ detail: "Project not found" });

    const [{ rows: docs }, { rows: folderData }] = await Promise.all([
        pool.query("SELECT * FROM documents WHERE project_id = $1 ORDER BY created_at ASC", [projectId]),
        pool.query("SELECT * FROM project_subfolders WHERE project_id = $1 ORDER BY created_at ASC", [projectId]),
    ]);
    await attachLatestVersionNumbers(docs as never[]);
    await attachActiveVersionPaths(docs as never[]);
    res.json({
        ...project,
        is_owner: project.user_id === userId,
        documents: docs,
        folders: folderData,
    });
});

// GET /projects/:projectId/people
projectsRouter.get("/:projectId/people", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId } = req.params;

    const { rows } = await pool.query<{ id: string; user_id: string; shared_with: string[] | null }>(
        "SELECT id, user_id, shared_with FROM projects WHERE id = $1",
        [projectId],
    );
    const project = rows[0];
    if (!project) return void res.status(404).json({ detail: "Project not found" });

    const isOwner = project.user_id === userId;
    const sharedWith = (Array.isArray(project.shared_with) ? project.shared_with as string[] : []).map(
        (e) => e.toLowerCase(),
    );
    const isShared = !!userEmail && sharedWith.includes(userEmail.toLowerCase());
    if (!isOwner && !isShared) return void res.status(404).json({ detail: "Project not found" });

    const memberEmails = sharedWith;
    const { rows: memberUsers } = memberEmails.length > 0
        ? await pool.query<{ id: string; email: string }>(
            "SELECT id, email FROM users WHERE email = ANY($1::text[])",
            [memberEmails],
        )
        : { rows: [] as { id: string; email: string }[] };

    const userByEmail = new Map(memberUsers.map((u) => [u.email.toLowerCase(), u]));
    const memberUserIds = memberUsers.map((u) => u.id);
    const profileIds = [project.user_id, ...memberUserIds].filter((x, i, arr) => arr.indexOf(x) === i);

    const { rows: ownerUserRows } = await pool.query<{ id: string; email: string }>(
        "SELECT id, email FROM users WHERE id = $1",
        [project.user_id],
    );
    const ownerUser = ownerUserRows[0];

    const profileByUserId = new Map<string, { display_name: string | null }>();
    if (profileIds.length > 0) {
        const { rows: profiles } = await pool.query<{ user_id: string; display_name: string | null }>(
            "SELECT user_id, display_name FROM user_profiles WHERE user_id = ANY($1::uuid[])",
            [profileIds],
        );
        for (const p of profiles) profileByUserId.set(p.user_id, { display_name: p.display_name ?? null });
    }

    const owner = {
        user_id: project.user_id,
        email: ownerUser?.email ?? null,
        display_name: profileByUserId.get(project.user_id)?.display_name ?? null,
    };
    const members = sharedWith.map((email) => {
        const u = userByEmail.get(email);
        const display_name = u ? profileByUserId.get(u.id)?.display_name ?? null : null;
        return { email, display_name };
    });

    res.json({ owner, members });
});

// PATCH /projects/:projectId
projectsRouter.patch("/:projectId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { projectId } = req.params;

    const setClauses: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => { params.push(val); setClauses.push(`${col} = $${params.length}`); };

    if (req.body.name != null) push("name", req.body.name);
    if (req.body.cm_number != null) push("cm_number", req.body.cm_number);
    if (Array.isArray(req.body.shared_with)) {
        const seen = new Set<string>();
        const cleaned: string[] = [];
        for (const raw of req.body.shared_with) {
            if (typeof raw !== "string") continue;
            const e = raw.trim().toLowerCase();
            if (!e || seen.has(e)) continue;
            seen.add(e);
            cleaned.push(e);
        }
        push("shared_with", JSON.stringify(cleaned));
    }

    params.push(projectId, userId);
    const { rows } = await pool.query(
        `UPDATE projects SET ${setClauses.join(", ")} WHERE id = $${params.length - 1} AND user_id = $${params.length} RETURNING *`,
        params,
    );
    if (!rows[0]) return void res.status(404).json({ detail: "Project not found" });

    const [{ rows: docs }, { rows: folderData }] = await Promise.all([
        pool.query("SELECT * FROM documents WHERE project_id = $1 ORDER BY created_at ASC", [projectId]),
        pool.query("SELECT * FROM project_subfolders WHERE project_id = $1 ORDER BY created_at ASC", [projectId]),
    ]);
    await attachActiveVersionPaths(docs as never[]);
    res.json({ ...rows[0], documents: docs, folders: folderData });
});

// DELETE /projects/:projectId
projectsRouter.delete("/:projectId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { projectId } = req.params;
    await pool.query("DELETE FROM projects WHERE id = $1 AND user_id = $2", [projectId, userId]);
    res.status(204).send();
});

// GET /projects/:projectId/documents
projectsRouter.get("/:projectId/documents", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId } = req.params;

    const access = await checkProjectAccess(projectId, userId, userEmail);
    if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

    const { rows: docs } = await pool.query(
        "SELECT * FROM documents WHERE project_id = $1 ORDER BY created_at ASC",
        [projectId],
    );
    await attachActiveVersionPaths(docs as never[]);
    res.json(docs);
});

// POST /projects/:projectId/documents/:documentId — assign or copy existing doc into project
projectsRouter.post("/:projectId/documents/:documentId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId, documentId } = req.params;

    const access = await checkProjectAccess(projectId, userId, userEmail);
    if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

    const { rows: docRows } = await pool.query(
        "SELECT * FROM documents WHERE id = $1 AND user_id = $2",
        [documentId, userId],
    );
    const doc = docRows[0];
    if (!doc) return void res.status(404).json({ detail: "Document not found" });

    if (doc.project_id === projectId) return void res.json(doc);

    if (doc.project_id === null) {
        const { rows } = await pool.query(
            "UPDATE documents SET project_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
            [projectId, documentId],
        );
        return void res.json(rows[0]);
    }

    // Belongs to another project — duplicate record + copy storage objects
    const { rows: copyRows } = await pool.query(
        `INSERT INTO documents (project_id, user_id, filename, file_type, size_bytes, page_count, structure_tree, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [projectId, userId, doc.filename, doc.file_type, doc.size_bytes, doc.page_count, doc.structure_tree ? JSON.stringify(doc.structure_tree) : null, doc.status],
    );
    const copy = copyRows[0];
    if (!copy) return void res.status(500).json({ detail: "Failed to copy document" });

    let copyVersionRowId: string | null = null;
    if (doc.current_version_id) {
        const { rows: srcVRows } = await pool.query(
            "SELECT storage_path, pdf_storage_path, version_number, display_name, source FROM document_versions WHERE id = $1",
            [doc.current_version_id],
        );
        const srcV = srcVRows[0];
        if (srcV?.storage_path) {
            const srcBytes = await downloadFile(srcV.storage_path);
            if (!srcBytes) return void res.status(500).json({ detail: "Failed to read source document bytes" });

            const newKey = storageKey(userId, copy.id as string, doc.filename);
            const contentType = doc.file_type === "pdf"
                ? "application/pdf"
                : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            await uploadFile(newKey, srcBytes, contentType);

            let newPdfPath: string | null = null;
            if (srcV.pdf_storage_path) {
                if (srcV.pdf_storage_path === srcV.storage_path) {
                    newPdfPath = newKey;
                } else {
                    const pdfBytes = await downloadFile(srcV.pdf_storage_path);
                    if (pdfBytes) {
                        const newPdfKey = convertedPdfKey(userId, copy.id as string);
                        await uploadFile(newPdfKey, pdfBytes, "application/pdf");
                        newPdfPath = newPdfKey;
                    }
                }
            }

            const { rows: newVRows } = await pool.query<{ id: string }>(
                `INSERT INTO document_versions (document_id, storage_path, pdf_storage_path, source, version_number, display_name)
                 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
                [copy.id, newKey, newPdfPath, srcV.source ?? "upload", srcV.version_number ?? 1, srcV.display_name ?? doc.filename],
            );
            copyVersionRowId = newVRows[0]?.id ?? null;
            if (copyVersionRowId) {
                await pool.query("UPDATE documents SET current_version_id = $1 WHERE id = $2", [copyVersionRowId, copy.id]);
            }
        }
    }
    return void res.status(201).json(copy);
});

// POST /projects/:projectId/documents — file upload
projectsRouter.post(
    "/:projectId/documents",
    requireAuth,
    singleFileUpload("file"),
    async (req, res) => {
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const { projectId } = req.params;

        const access = await checkProjectAccess(projectId, userId, userEmail);
        if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

        await handleDocumentUpload(req, res, userId, projectId);
    },
);

// GET /projects/:projectId/chats
projectsRouter.get("/:projectId/chats", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId } = req.params;

    const access = await checkProjectAccess(projectId, userId, userEmail);
    if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

    const { rows } = await pool.query(
        "SELECT * FROM chats WHERE project_id = $1 ORDER BY created_at DESC",
        [projectId],
    );
    res.json(rows);
});

// POST /projects/:projectId/folders
projectsRouter.post("/:projectId/folders", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId } = req.params;
    const { name, parent_folder_id } = req.body as { name: string; parent_folder_id?: string | null };
    if (!name?.trim()) return void res.status(400).json({ detail: "name is required" });

    const access = await checkProjectAccess(projectId, userId, userEmail);
    if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

    if (parent_folder_id) {
        const { rows: parentRows } = await pool.query(
            "SELECT id FROM project_subfolders WHERE id = $1 AND project_id = $2",
            [parent_folder_id, projectId],
        );
        if (!parentRows[0]) return void res.status(404).json({ detail: "Parent folder not found" });
    }

    const { rows } = await pool.query(
        "INSERT INTO project_subfolders (project_id, user_id, name, parent_folder_id) VALUES ($1,$2,$3,$4) RETURNING *",
        [projectId, userId, name.trim(), parent_folder_id ?? null],
    );
    res.status(201).json(rows[0]);
});

// PATCH /projects/:projectId/folders/:folderId
projectsRouter.patch("/:projectId/folders/:folderId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId, folderId } = req.params;
    const body = req.body as { name?: string; parent_folder_id?: string | null };

    const access = await checkProjectAccess(projectId, userId, userEmail);
    if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

    const setClauses: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => { params.push(val); setClauses.push(`${col} = $${params.length}`); };

    if (body.name != null) push("name", body.name.trim());
    if ("parent_folder_id" in body) {
        if (body.parent_folder_id) {
            let cur: string | null = body.parent_folder_id;
            while (cur) {
                if (cur === folderId) return void res.status(400).json({ detail: "Cannot move a folder into itself or a descendant" });
                const pRows = (await pool.query(
                    "SELECT parent_folder_id FROM project_subfolders WHERE id = $1",
                    [cur],
                )).rows as Array<{ parent_folder_id: string | null }>;
                cur = pRows[0]?.parent_folder_id ?? null;
            }
        }
        push("parent_folder_id", body.parent_folder_id ?? null);
    }

    params.push(folderId, projectId);
    const { rows } = await pool.query(
        `UPDATE project_subfolders SET ${setClauses.join(", ")} WHERE id = $${params.length - 1} AND project_id = $${params.length} RETURNING *`,
        params,
    );
    if (!rows[0]) return void res.status(404).json({ detail: "Folder not found" });
    res.json(rows[0]);
});

// DELETE /projects/:projectId/folders/:folderId
projectsRouter.delete("/:projectId/folders/:folderId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId, folderId } = req.params;

    const access = await checkProjectAccess(projectId, userId, userEmail);
    if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

    await pool.query("UPDATE documents SET folder_id = NULL WHERE folder_id = $1", [folderId]);
    await pool.query("DELETE FROM project_subfolders WHERE id = $1 AND project_id = $2", [folderId, projectId]);
    res.status(204).send();
});

// PATCH /projects/:projectId/documents/:documentId/folder
projectsRouter.patch("/:projectId/documents/:documentId/folder", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId, documentId } = req.params;
    const { folder_id } = req.body as { folder_id: string | null };

    const access = await checkProjectAccess(projectId, userId, userEmail);
    if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

    const { rows } = await pool.query(
        "UPDATE documents SET folder_id = $1, updated_at = NOW() WHERE id = $2 AND project_id = $3 RETURNING *",
        [folder_id ?? null, documentId, projectId],
    );
    if (!rows[0]) return void res.status(404).json({ detail: "Document not found" });
    res.json(rows[0]);
});

export async function handleDocumentUpload(
    req: import("express").Request,
    res: import("express").Response,
    userId: string,
    projectId: string | null,
) {
    const file = req.file;
    if (!file) return void res.status(400).json({ detail: "file is required" });

    const filename = file.originalname;
    const suffix = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
    if (!ALLOWED_TYPES.has(suffix))
        return void res.status(400).json({ detail: `Unsupported file type: ${suffix}. Allowed: pdf, docx, doc` });

    const content = file.buffer;
    const { rows: docRows } = await pool.query(
        `INSERT INTO documents (project_id, user_id, filename, file_type, size_bytes, status)
         VALUES ($1,$2,$3,$4,$5,'processing') RETURNING *`,
        [projectId, userId, filename, suffix, content.byteLength],
    );
    const doc = docRows[0];
    if (!doc) return void res.status(500).json({ detail: "Failed to create document record" });

    try {
        const docId = doc.id as string;
        const key = storageKey(userId, docId, filename);
        const contentType = suffix === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        await uploadFile(
            key,
            content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer,
            contentType,
        );

        const rawBuf = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
        const tree = await extractStructureTree(rawBuf, suffix, filename);
        const pageCount = suffix === "pdf" ? await countPdfPages(rawBuf) : null;

        let pdfStoragePath: string | null = null;
        if (suffix === "docx" || suffix === "doc") {
            try {
                const pdfBuf = await docxToPdf(content);
                const pdfKey = convertedPdfKey(userId, docId);
                await uploadFile(
                    pdfKey,
                    pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength) as ArrayBuffer,
                    "application/pdf",
                );
                pdfStoragePath = pdfKey;
            } catch (err) {
                console.error(`[upload] DOCX→PDF conversion failed for ${filename}:`, err);
            }
        } else if (suffix === "pdf") {
            pdfStoragePath = key;
        }

        const { rows: versionRows } = await pool.query<{ id: string }>(
            `INSERT INTO document_versions (document_id, storage_path, pdf_storage_path, source, version_number, display_name)
             VALUES ($1,$2,$3,'upload',1,$4) RETURNING id`,
            [docId, key, pdfStoragePath, filename],
        );
        const versionRow = versionRows[0];
        if (!versionRow) throw new Error("Failed to record upload version");

        await pool.query(
            `UPDATE documents SET current_version_id = $1, size_bytes = $2, page_count = $3,
             structure_tree = $4, status = 'ready', updated_at = NOW() WHERE id = $5`,
            [versionRow.id, content.byteLength, pageCount, tree ? JSON.stringify(tree) : null, docId],
        );

        const { rows: updatedRows } = await pool.query("SELECT * FROM documents WHERE id = $1", [docId]);
        const updated = updatedRows[0];
        return void res.status(201).json(updated ? { ...updated, storage_path: key, pdf_storage_path: pdfStoragePath } : updated);
    } catch (e) {
        await pool.query("UPDATE documents SET status = 'error' WHERE id = $1", [doc.id]);
        return void res.status(500).json({ detail: `Document processing failed: ${String(e)}` });
    }
}

async function countPdfPages(buf: ArrayBuffer): Promise<number | null> {
    try {
        const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
        const pdf = await (
            pdfjsLib as unknown as {
                getDocument: (opts: unknown) => { promise: Promise<{ numPages: number }> };
            }
        ).getDocument({ data: new Uint8Array(buf) }).promise;
        return pdf.numPages;
    } catch {
        return null;
    }
}

async function extractStructureTree(content: ArrayBuffer, fileType: string, filename: string): Promise<unknown[] | null> {
    try {
        if (fileType === "pdf") {
            const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
            const pdf = await (
                pdfjsLib as unknown as {
                    getDocument: (opts: unknown) => {
                        promise: Promise<{
                            numPages: number;
                            getOutline: () => Promise<{ title?: string }[]>;
                        }>;
                    };
                }
            ).getDocument({ data: new Uint8Array(content) }).promise;
            if (pdf.numPages <= 5) return null;
            const outline = await pdf.getOutline();
            if (outline?.length) {
                return outline.map((item, i) => ({
                    id: `h1-${i}`, title: item.title ?? `Item ${i + 1}`, level: 1, page_number: null, children: [],
                }));
            }
            return Array.from({ length: pdf.numPages }, (_, i) => ({
                id: `page-${i + 1}`, title: `Page ${i + 1}`, level: 1, page_number: i + 1, children: [],
            }));
        } else {
            const mammoth = await import("mammoth");
            const result = await mammoth.extractRawText({ buffer: Buffer.from(content) });
            const lines = result.value.split("\n").filter((l) => l.trim());
            const nodes = lines.slice(0, 30).map((line, i) => ({
                id: `h1-${i}`, title: line.slice(0, 100), level: 1, page_number: null, children: [],
            }));
            return nodes.length ? nodes : null;
        }
    } catch {
        return null;
    }
}
