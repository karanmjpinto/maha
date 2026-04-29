import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { pool } from "../lib/db";
import {
    buildDocContext,
    buildMessages,
    enrichWithPriorEvents,
    buildWorkflowStore,
    extractAnnotations,
    runLLMStream,
    type ChatMessage,
} from "../lib/chatTools";
import { completeText } from "../lib/llm";
import { getUserApiKeys, getUserModelSettings } from "../lib/userSettings";
import { checkProjectAccess } from "../lib/access";

export const chatRouter = Router();

// GET /chat
chatRouter.get("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;

    const { rows: ownProjectRows } = await pool.query<{ id: string }>(
        "SELECT id FROM projects WHERE user_id = $1",
        [userId],
    );
    const ownProjectIds = ownProjectRows.map((p) => p.id);

    const { rows } = await pool.query(
        `SELECT * FROM chats WHERE user_id = $1 OR project_id = ANY($2::uuid[]) ORDER BY created_at DESC`,
        [userId, ownProjectIds],
    );
    res.json(rows);
});

// POST /chat/create
chatRouter.post("/create", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const projectId: string | null = req.body.project_id ?? null;
    const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO chats (user_id, project_id) VALUES ($1,$2) RETURNING id",
        [userId, projectId],
    );
    res.json({ id: rows[0].id });
});

// GET /chat/:chatId
chatRouter.get("/:chatId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId } = req.params;

    const { rows: chatRows } = await pool.query("SELECT * FROM chats WHERE id = $1", [chatId]);
    const chat = chatRows[0];
    if (!chat) return void res.status(404).json({ detail: "Chat not found" });

    let canView = chat.user_id === userId;
    if (!canView && chat.project_id) {
        const access = await checkProjectAccess(chat.project_id, userId, userEmail);
        canView = access.ok;
    }
    if (!canView) return void res.status(404).json({ detail: "Chat not found" });

    const { rows: messages } = await pool.query(
        "SELECT * FROM chat_messages WHERE chat_id = $1 ORDER BY created_at ASC",
        [chatId],
    );
    const hydrated = await hydrateEditStatuses(messages);
    res.json({ chat, messages: hydrated });
});

async function hydrateEditStatuses(
    messages: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
    const editIds = new Set<string>();
    const versionIds = new Set<string>();
    const collectFromAnnList = (list: unknown) => {
        if (!Array.isArray(list)) return;
        for (const a of list as Record<string, unknown>[]) {
            if (typeof a?.edit_id === "string") editIds.add(a.edit_id);
            if (typeof a?.version_id === "string") versionIds.add(a.version_id);
        }
    };
    for (const m of messages) {
        collectFromAnnList(m.annotations);
        const content = m.content;
        if (Array.isArray(content)) {
            for (const ev of content as Record<string, unknown>[]) {
                if (ev?.type === "doc_edited") {
                    collectFromAnnList(ev.annotations);
                    if (typeof ev.version_id === "string") versionIds.add(ev.version_id);
                }
            }
        }
    }
    if (editIds.size === 0 && versionIds.size === 0) return messages;

    const statusById = new Map<string, "pending" | "accepted" | "rejected">();
    if (editIds.size > 0) {
        const { rows } = await pool.query<{ id: string; status: string }>(
            "SELECT id, status FROM document_edits WHERE id = ANY($1::uuid[])",
            [Array.from(editIds)],
        );
        for (const r of rows) {
            if (r.status === "pending" || r.status === "accepted" || r.status === "rejected") {
                statusById.set(r.id, r.status);
            }
        }
    }

    const versionNumberById = new Map<string, number | null>();
    if (versionIds.size > 0) {
        const { rows } = await pool.query<{ id: string; version_number: number | null }>(
            "SELECT id, version_number FROM document_versions WHERE id = ANY($1::uuid[])",
            [Array.from(versionIds)],
        );
        for (const r of rows) versionNumberById.set(r.id, r.version_number ?? null);
    }

    const patchAnnList = (list: unknown): unknown => {
        if (!Array.isArray(list)) return list;
        return (list as Record<string, unknown>[]).map((a) => {
            let next = a;
            if (typeof a?.edit_id === "string" && statusById.has(a.edit_id)) {
                next = { ...next, status: statusById.get(a.edit_id) };
            }
            if (typeof a?.version_id === "string" && versionNumberById.has(a.version_id)) {
                next = { ...next, version_number: versionNumberById.get(a.version_id) ?? null };
            }
            return next;
        });
    };
    return messages.map((m) => {
        const next: Record<string, unknown> = { ...m };
        next.annotations = patchAnnList(m.annotations);
        if (Array.isArray(m.content)) {
            next.content = (m.content as Record<string, unknown>[]).map((ev) => {
                if (ev?.type !== "doc_edited") return ev;
                let patched: Record<string, unknown> = { ...ev, annotations: patchAnnList(ev.annotations) };
                if (typeof ev.version_id === "string" && versionNumberById.has(ev.version_id)) {
                    patched = { ...patched, version_number: versionNumberById.get(ev.version_id) ?? null };
                }
                return patched;
            });
        }
        return next;
    });
}

// PATCH /chat/:chatId
chatRouter.patch("/:chatId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { chatId } = req.params;
    const title = (req.body.title ?? "").trim();
    if (!title) return void res.status(400).json({ detail: "title is required" });

    const { rows } = await pool.query<{ id: string; title: string }>(
        "UPDATE chats SET title = $1 WHERE id = $2 AND user_id = $3 RETURNING id, title",
        [title, chatId, userId],
    );
    if (!rows[0]) return void res.status(404).json({ detail: "Chat not found" });
    res.json(rows[0]);
});

// DELETE /chat/:chatId
chatRouter.delete("/:chatId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { chatId } = req.params;
    await pool.query("DELETE FROM chats WHERE id = $1 AND user_id = $2", [chatId, userId]);
    res.status(204).send();
});

// POST /chat/:chatId/generate-title
chatRouter.post("/:chatId/generate-title", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { chatId } = req.params;
    const message: string = (req.body.message ?? "").trim();
    if (!message) return void res.status(400).json({ detail: "message is required" });

    const { rows: chatRows } = await pool.query<{ id: string; user_id: string; project_id: string | null; title: string | null }>(
        "SELECT id, user_id, project_id, title FROM chats WHERE id = $1",
        [chatId],
    );
    const chat = chatRows[0];
    if (!chat) return void res.status(404).json({ detail: "Chat not found" });

    let canTitle = chat.user_id === userId;
    if (!canTitle && chat.project_id) {
        const access = await checkProjectAccess(chat.project_id, userId, userEmail);
        canTitle = access.ok;
    }
    if (!canTitle) return void res.status(404).json({ detail: "Chat not found" });

    try {
        const { title_model, api_keys } = await getUserModelSettings(userId);
        const titleText = await completeText({
            model: title_model,
            user: `Generate a concise title (3–6 words) for a chat in an AI Legal Platform that starts with this message. The title should describe the topic or document — do NOT include words like "Legal Assistant", "AI", "Chat", or any similar prefix. Return only the title, no quotes or punctuation.\n\nMessage: ${message.slice(0, 500)}`,
            maxTokens: 64,
            apiKeys: api_keys,
        });
        const title = titleText.trim() || message.slice(0, 60);
        await pool.query("UPDATE chats SET title = $1 WHERE id = $2 AND user_id = $3", [title, chatId, userId]);
        res.json({ title });
    } catch (err) {
        console.error("[generate-title]", err);
        res.status(500).json({ detail: "Failed to generate title" });
    }
});

// POST /chat — streaming
chatRouter.post("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { messages, chat_id, project_id, model } = req.body as {
        messages: ChatMessage[];
        chat_id?: string;
        project_id?: string;
        model?: string;
    };

    console.log("[chat/stream] incoming request", { userId, chat_id, project_id, model, messageCount: messages?.length });

    const userEmail = res.locals.userEmail as string | undefined;
    let chatId = chat_id ?? null;
    let chatTitle: string | null = null;

    if (chatId) {
        const { rows } = await pool.query(
            "SELECT id, title, user_id, project_id FROM chats WHERE id = $1",
            [chatId],
        );
        const existing = rows[0];
        let canUse = !!existing && existing.user_id === userId;
        if (!canUse && existing?.project_id) {
            const access = await checkProjectAccess(existing.project_id, userId, userEmail);
            canUse = access.ok;
        }
        if (!canUse || !existing) chatId = null;
        else chatTitle = existing.title;
    }

    if (!chatId) {
        if (project_id) {
            const access = await checkProjectAccess(project_id, userId, userEmail);
            if (!access.ok) return void res.status(404).json({ detail: "Project not found" });
        }
        const { rows } = await pool.query(
            "INSERT INTO chats (user_id, project_id) VALUES ($1,$2) RETURNING id, title",
            [userId, project_id ?? null],
        );
        if (!rows[0]) return void res.status(500).json({ detail: "Failed to create chat" });
        chatId = rows[0].id as string;
        chatTitle = rows[0].title;
    }

    console.log("[chat/stream] resolved chatId", chatId);

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
        await pool.query(
            "INSERT INTO chat_messages (chat_id, role, content, files) VALUES ($1,$2,$3,$4)",
            [chatId, "user", lastUser.content !== null ? JSON.stringify(lastUser.content) : null, lastUser.files ? JSON.stringify(lastUser.files) : null],
        );
    }

    const { docIndex, docStore } = await buildDocContext(messages, userId, chatId);
    const docAvailability = Object.entries(docIndex).map(([doc_id, info]) => ({ doc_id, filename: info.filename }));
    const enrichedMessages = await enrichWithPriorEvents(messages, chatId, docIndex);
    const apiMessages = buildMessages(enrichedMessages, docAvailability);
    const workflowStore = await buildWorkflowStore(userId, userEmail);

    console.log("[chat/stream] starting LLM stream", {
        apiMessageCount: apiMessages.length,
        docCount: Object.keys(docIndex).length,
        workflowCount: Object.keys(workflowStore).length,
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const write = (line: string) => res.write(line);
    const apiKeys = await getUserApiKeys(userId);

    try {
        write(`data: ${JSON.stringify({ type: "chat_id", chatId })}\n\n`);

        const { fullText, events } = await runLLMStream({
            apiMessages,
            docStore,
            docIndex,
            userId,
            write,
            workflowStore,
            model,
            apiKeys,
            projectId: project_id ?? null,
        });

        console.log("[chat/stream] LLM stream finished", { fullTextLen: fullText?.length ?? 0, eventCount: events?.length ?? 0 });

        const annotations = extractAnnotations(fullText, docIndex, events);
        await pool.query(
            "INSERT INTO chat_messages (chat_id, role, content, annotations) VALUES ($1,$2,$3,$4)",
            [chatId, "assistant", events.length ? JSON.stringify(events) : null, annotations.length ? JSON.stringify(annotations) : null],
        );

        if (!chatTitle && lastUser?.content) {
            await pool.query("UPDATE chats SET title = $1 WHERE id = $2", [
                typeof lastUser.content === "string" ? lastUser.content.slice(0, 120) : null,
                chatId,
            ]);
        }
    } catch (err) {
        console.error("[chat/stream] error:", err);
        try {
            write(`data: ${JSON.stringify({ type: "error", message: "Stream error" })}\n\n`);
            write("data: [DONE]\n\n");
        } catch { /* ignore */ }
    } finally {
        res.end();
    }
});
