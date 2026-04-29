import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { pool } from "../lib/db";
import {
  buildContentDisposition,
  downloadFile,
  deleteFile,
  getSignedUrl,
  storageKey,
  uploadFile,
  versionStorageKey,
} from "../lib/storage";
import { docxToPdf, convertedPdfKey } from "../lib/convert";
import {
  extractTrackedChangeIds,
  resolveTrackedChange,
} from "../lib/docxTrackedChanges";
import { buildDownloadUrl } from "../lib/downloadTokens";
import {
  attachActiveVersionPaths,
  attachLatestVersionNumbers,
  loadActiveVersion,
} from "../lib/documentVersions";
import { ensureDocAccess } from "../lib/access";
import { singleFileUpload } from "../lib/upload";

export const documentsRouter = Router();
const ALLOWED_TYPES = new Set(["pdf", "docx", "doc"]);

// GET /single-documents
documentsRouter.get("/", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { rows: docs } = await pool.query(
    "SELECT * FROM documents WHERE user_id = $1 AND project_id IS NULL ORDER BY created_at DESC",
    [userId]
  );
  const docList = docs as unknown as { id: string; current_version_id?: string | null }[];
  await attachLatestVersionNumbers(docList);
  await attachActiveVersionPaths(docList);
  res.json(docList);
});

// POST /single-documents
documentsRouter.post(
  "/",
  requireAuth,
  singleFileUpload("file"),
  async (req, res) => {
    const userId = res.locals.userId as string;
    await handleDocumentUpload(req, res, userId, null);
  },
);

// DELETE /single-documents/:documentId
documentsRouter.delete("/:documentId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { documentId } = req.params;

  const { rows: docRows } = await pool.query(
    "SELECT id FROM documents WHERE id = $1 AND user_id = $2",
    [documentId, userId]
  );
  if (!docRows[0])
    return void res.status(404).json({ detail: "Document not found" });

  const { rows: versions } = await pool.query<{ storage_path: string | null; pdf_storage_path: string | null }>(
    "SELECT storage_path, pdf_storage_path FROM document_versions WHERE document_id = $1",
    [documentId]
  );
  await Promise.all(
    versions.flatMap((v) =>
      [v.storage_path, v.pdf_storage_path]
        .filter((p): p is string => typeof p === "string" && p.length > 0)
        .map((p) => deleteFile(p).catch(() => {})),
    ),
  );
  await pool.query("DELETE FROM documents WHERE id = $1", [documentId]);
  res.status(204).send();
});

// GET /single-documents/:documentId/display
// Optional ?version_id= renders a historical version. Defaults to the
// document's current_version_id.
documentsRouter.get("/:documentId/display", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string;
  const { documentId } = req.params;
  const versionIdParam =
    typeof req.query.version_id === "string" ? req.query.version_id : null;

  const { rows: docRows } = await pool.query(
    "SELECT id, filename, file_type, user_id, project_id FROM documents WHERE id = $1",
    [documentId]
  );
  const doc = docRows[0];
  if (!doc)
    return void res.status(404).json({ detail: "Document not found" });
  const access = await ensureDocAccess(doc, userId, userEmail);
  if (!access.ok)
    return void res.status(404).json({ detail: "Document not found" });

  const active = await loadActiveVersion(documentId, versionIdParam);
  if (!active)
    return void res.status(404).json({ detail: "No file available" });

  const fileType = (doc.file_type as string) ?? "";
  const isDocx = fileType === "docx" || fileType === "doc";

  const servePath =
    isDocx && active.pdf_storage_path
      ? active.pdf_storage_path
      : active.storage_path;
  const raw = await downloadFile(servePath);
  if (!raw)
    return void res
      .status(404)
      .json({ detail: "Document not found in storage" });

  if (fileType === "pdf" || (isDocx && active.pdf_storage_path)) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      buildContentDisposition("inline", doc.filename as string),
    );
    res.send(Buffer.from(raw));
  } else {
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader(
      "Content-Disposition",
      buildContentDisposition("inline", doc.filename as string),
    );
    res.send(Buffer.from(raw));
  }
});

// POST /single-documents/download-zip
documentsRouter.post("/download-zip", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { document_ids } = req.body as { document_ids?: string[] };

  if (!Array.isArray(document_ids) || document_ids.length === 0)
    return void res.status(400).json({ detail: "document_ids is required" });

  const { rows: rawDocs } = await pool.query(
    "SELECT id, filename, file_type, current_version_id, user_id, project_id FROM documents WHERE id = ANY($1::uuid[])",
    [document_ids]
  );

  const accessChecks = await Promise.all(
    rawDocs.map(async (d) => ({
      doc: d,
      access: await ensureDocAccess(
        d as { user_id: string; project_id: string | null },
        userId,
        userEmail,
      ),
    })),
  );
  const docs = accessChecks
    .filter((x) => x.access.ok)
    .map((x) => x.doc as { id: string; filename: string });
  if (!docs || docs.length === 0)
    return void res.status(404).json({ detail: "No documents found" });

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  await Promise.all(
    docs.map(async (doc) => {
      const active = await loadActiveVersion(doc.id);
      if (!active) return;
      const raw = await downloadFile(active.storage_path);
      if (!raw) return;
      zip.file(doc.filename, Buffer.from(raw));
    }),
  );

  const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="documents.zip"');
  res.send(content);
});

// GET /single-documents/:documentId/url
// Optional ?version_id= selects a specific tracked-changes version.
documentsRouter.get("/:documentId/url", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { documentId } = req.params;
  const versionIdParam = typeof req.query.version_id === "string" ? req.query.version_id : null;

  const { rows: docRows } = await pool.query(
    "SELECT id, filename, user_id, project_id FROM documents WHERE id = $1",
    [documentId]
  );
  const doc = docRows[0];
  if (!doc)
    return void res.status(404).json({ detail: "Document not found" });
  const access = await ensureDocAccess(doc, userId, userEmail);
  if (!access.ok)
    return void res.status(404).json({ detail: "Document not found" });

  const active = await loadActiveVersion(documentId, versionIdParam);
  if (!active)
    return void res.status(404).json({ detail: "No file available" });

  const downloadFilename = resolveDownloadFilename(
    doc.filename as string,
    active.display_name,
    active.version_number,
  );
  const url = await getSignedUrl(
    active.storage_path,
    3600,
    downloadFilename,
  );
  if (!url)
    return void res.status(503).json({ detail: "Storage not configured" });

  res.json({
    url,
    document_id: documentId,
    filename: downloadFilename,
    version_id: active.id,
    has_pdf_rendition: !!active.pdf_storage_path,
  });
});

// GET /single-documents/:documentId/docx
// Streams the raw .docx bytes for the given document, optionally at a
// specific tracked-changes version.
documentsRouter.get("/:documentId/docx", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { documentId } = req.params;
  const versionIdParam = typeof req.query.version_id === "string" ? req.query.version_id : null;

  const { rows: docRows } = await pool.query(
    "SELECT id, filename, user_id, project_id FROM documents WHERE id = $1",
    [documentId]
  );
  const doc = docRows[0];
  if (!doc)
    return void res.status(404).json({ detail: "Document not found" });
  const access = await ensureDocAccess(doc, userId, userEmail);
  if (!access.ok)
    return void res.status(404).json({ detail: "Document not found" });

  const active = await loadActiveVersion(documentId, versionIdParam);
  if (!active)
    return void res.status(404).json({ detail: "No file available" });

  const raw = await downloadFile(active.storage_path);
  if (!raw)
    return void res.status(404).json({ detail: "Document bytes not available" });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  res.setHeader(
    "Content-Disposition",
    buildContentDisposition(
      "inline",
      resolveDownloadFilename(
        doc.filename as string,
        active.display_name,
        active.version_number,
      ),
    ),
  );
  res.send(Buffer.from(raw));
});

// Compose a download-friendly filename that carries the edit version
// marker: "Purchase Agreement.docx" → "Purchase Agreement [Edited V2].docx".
function versionedFilename(filename: string, version: number | null): string {
  if (!version || version < 1) return filename;
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : ".docx";
  return `${stem} [Edited V${version}]${ext}`;
}

// Produce the filename a download should present to the user for a given
// (document, version) pair.
function resolveDownloadFilename(
  originalFilename: string,
  displayName: string | null | undefined,
  versionNumber: number | null,
): string {
  const dot = originalFilename.lastIndexOf(".");
  const origExt = dot > 0 ? originalFilename.slice(dot) : "";
  if (displayName && displayName.trim()) {
    const trimmed = displayName.trim();
    const trimmedDot = trimmed.lastIndexOf(".");
    const hasExt =
      trimmedDot > 0 &&
      trimmed
        .slice(trimmedDot)
        .toLowerCase()
        .match(/^\.[a-z0-9]{1,6}$/);
    if (hasExt) return trimmed;
    return origExt ? `${trimmed}${origExt}` : trimmed;
  }
  return versionedFilename(originalFilename, versionNumber);
}

// GET /single-documents/:documentId/versions
documentsRouter.get("/:documentId/versions", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { documentId } = req.params;

  const { rows: docRows } = await pool.query(
    "SELECT id, current_version_id, user_id, project_id FROM documents WHERE id = $1",
    [documentId]
  );
  const doc = docRows[0];
  if (!doc)
    return void res.status(404).json({ detail: "Document not found" });
  const access = await ensureDocAccess(doc, userId, userEmail);
  if (!access.ok)
    return void res.status(404).json({ detail: "Document not found" });

  const { rows } = await pool.query(
    "SELECT id, version_number, source, created_at, display_name FROM document_versions WHERE document_id = $1 ORDER BY created_at ASC",
    [documentId]
  );

  res.json({
    current_version_id: doc.current_version_id,
    versions: rows,
  });
});

// POST /single-documents/:documentId/versions
// Upload a brand-new version of an existing document.
documentsRouter.post(
  "/:documentId/versions",
  requireAuth,
  singleFileUpload("file"),
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId } = req.params;

    const file = req.file;
    if (!file)
      return void res.status(400).json({ detail: "file is required" });

    const { rows: docRows } = await pool.query(
      "SELECT id, filename, file_type, user_id, project_id FROM documents WHERE id = $1",
      [documentId]
    );
    const doc = docRows[0];
    if (!doc)
      return void res.status(404).json({ detail: "Document not found" });
    const access = await ensureDocAccess(doc, userId, userEmail);
    if (!access.ok)
      return void res.status(404).json({ detail: "Document not found" });

    const suffix = file.originalname.includes(".")
      ? file.originalname.split(".").pop()!.toLowerCase()
      : "";
    if (doc.file_type && suffix && doc.file_type !== suffix) {
      return void res.status(400).json({
        detail: `Uploaded file type (${suffix}) does not match document type (${doc.file_type}).`,
      });
    }

    const versionSlug = crypto.randomUUID().replace(/-/g, "");
    const key = versionStorageKey(
      userId,
      documentId,
      versionSlug,
      file.originalname,
    );
    const contentType =
      suffix === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    try {
      await uploadFile(
        key,
        file.buffer.buffer.slice(
          file.buffer.byteOffset,
          file.buffer.byteOffset + file.buffer.byteLength,
        ) as ArrayBuffer,
        contentType,
      );
    } catch (e) {
      console.error("[versions/upload] storage write failed", e);
      return void res
        .status(500)
        .json({ detail: "Failed to upload new version." });
    }

    let pdfStoragePath: string | null = null;
    if (suffix === "docx" || suffix === "doc") {
      try {
        const pdfBuf = await docxToPdf(file.buffer);
        const pdfKey = `converted-pdfs/${userId}/${documentId}/${versionSlug}.pdf`;
        await uploadFile(
          pdfKey,
          pdfBuf.buffer.slice(
            pdfBuf.byteOffset,
            pdfBuf.byteOffset + pdfBuf.byteLength,
          ) as ArrayBuffer,
          "application/pdf",
        );
        pdfStoragePath = pdfKey;
      } catch (err) {
        console.error(
          `[versions/upload] DOCX→PDF conversion failed for ${file.originalname}:`,
          err,
        );
      }
    } else if (suffix === "pdf") {
      pdfStoragePath = key;
    }

    const { rows: maxRows } = await pool.query<{ version_number: number | null }>(
      "SELECT version_number FROM document_versions WHERE document_id = $1 AND source = ANY(ARRAY['upload','user_upload','assistant_edit']::text[]) AND version_number IS NOT NULL ORDER BY version_number DESC NULLS LAST LIMIT 1",
      [documentId]
    );
    const nextVersionNumber =
      ((maxRows[0]?.version_number) ?? 1) + 1;

    const defaultDisplayName =
      typeof req.body?.display_name === "string" &&
      req.body.display_name.trim()
        ? req.body.display_name.trim().slice(0, 200)
        : file.originalname;

    const { rows: versionRows } = await pool.query(
      "INSERT INTO document_versions (document_id, storage_path, pdf_storage_path, source, version_number, display_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, version_number, source, created_at, display_name",
      [documentId, key, pdfStoragePath, "user_upload", nextVersionNumber, defaultDisplayName]
    );
    const versionRow = versionRows[0];
    if (!versionRow) {
      console.error("[versions/upload] insert failed");
      return void res
        .status(500)
        .json({ detail: "Failed to record new version." });
    }

    const documentsUpdate: Record<string, unknown> = {
      current_version_id: versionRow.id,
    };
    const providedDisplayName =
      typeof req.body?.display_name === "string" &&
      req.body.display_name.trim()
        ? req.body.display_name.trim().slice(0, 200)
        : null;
    if (providedDisplayName) {
      const hasExt = /\.[a-z0-9]{1,6}$/i.test(providedDisplayName);
      const existingExt = (doc.filename as string | null)?.match(
        /\.[a-z0-9]{1,6}$/i,
      )?.[0];
      const uploadedExt = suffix ? `.${suffix}` : "";
      const ext = hasExt ? "" : uploadedExt || existingExt || "";
      documentsUpdate.filename = `${providedDisplayName}${ext}`;
    }

    const setClauses = Object.keys(documentsUpdate)
      .map((k, i) => `${k} = $${i + 2}`)
      .join(", ");
    await pool.query(
      `UPDATE documents SET ${setClauses} WHERE id = $1`,
      [documentId, ...Object.values(documentsUpdate)]
    );

    res.status(201).json(versionRow);
  },
);

// PATCH /single-documents/:documentId/versions/:versionId
// Rename a version's display_name.
documentsRouter.patch(
  "/:documentId/versions/:versionId",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId, versionId } = req.params;

    const { rows: docRows } = await pool.query(
      "SELECT id, user_id, project_id FROM documents WHERE id = $1",
      [documentId]
    );
    const doc = docRows[0];
    if (!doc)
      return void res.status(404).json({ detail: "Document not found" });
    const access = await ensureDocAccess(doc, userId, userEmail);
    if (!access.ok)
      return void res.status(404).json({ detail: "Document not found" });

    const raw = req.body?.display_name;
    const displayName =
      typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 200) : null;

    const { rows: updatedRows } = await pool.query(
      "UPDATE document_versions SET display_name = $1 WHERE id = $2 AND document_id = $3 RETURNING id, version_number, source, created_at, display_name",
      [displayName, versionId, documentId]
    );
    const updated = updatedRows[0];
    if (!updated) {
      return void res.status(404).json({ detail: "Version not found" });
    }
    res.json(updated);
  },
);

// GET /single-documents/:documentId/tracked-change-ids
documentsRouter.get(
  "/:documentId/tracked-change-ids",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId } = req.params;
    const versionIdParam =
      typeof req.query.version_id === "string" ? req.query.version_id : null;

    const { rows: docRows } = await pool.query(
      "SELECT id, user_id, project_id FROM documents WHERE id = $1",
      [documentId]
    );
    const doc = docRows[0];
    if (!doc)
      return void res.status(404).json({ detail: "Document not found" });
    const access = await ensureDocAccess(doc, userId, userEmail);
    if (!access.ok)
      return void res.status(404).json({ detail: "Document not found" });

    const active = await loadActiveVersion(documentId, versionIdParam);
    if (!active)
      return void res.status(404).json({ detail: "No file available" });

    const raw = await downloadFile(active.storage_path);
    if (!raw)
      return void res
        .status(404)
        .json({ detail: "Document bytes not available" });

    const ids = await extractTrackedChangeIds(Buffer.from(raw));
    res.json({ ids });
  },
);

// POST /single-documents/:documentId/edits/:editId/accept
// POST /single-documents/:documentId/edits/:editId/reject
async function handleEditResolution(
  req: import("express").Request,
  res: import("express").Response,
  mode: "accept" | "reject",
) {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { documentId, editId } = req.params;

  console.log(`[edit-resolution] incoming ${mode}`, {
    userId,
    documentId,
    editId,
  });

  const { rows: editRows } = await pool.query(
    "SELECT id, document_id, change_id, del_w_id, ins_w_id, status FROM document_edits WHERE id = $1 AND document_id = $2",
    [editId, documentId]
  );
  const edit = editRows[0];
  console.log(`[edit-resolution] fetched edit row`, { edit });
  if (!edit) {
    console.log(`[edit-resolution] edit not found, returning 404`);
    return void res.status(404).json({ detail: "Edit not found" });
  }
  if (edit.status !== "pending") {
    console.log(`[edit-resolution] edit already resolved`, {
      editId,
      status: edit.status,
    });
    const { rows: docRows } = await pool.query(
      "SELECT current_version_id, filename, user_id, project_id FROM documents WHERE id = $1",
      [documentId]
    );
    const doc = docRows[0];
    if (!doc) {
      console.log(`[edit-resolution] doc not found for resolved edit`);
      return void res.status(404).json({ detail: "Document not found" });
    }
    const accessResolved = await ensureDocAccess(doc, userId, userEmail);
    if (!accessResolved.ok) {
      console.log(`[edit-resolution] doc access denied for resolved edit`);
      return void res.status(404).json({ detail: "Document not found" });
    }
    const activeForResolved = await loadActiveVersion(documentId);
    const payload = {
      ok: true,
      already_resolved: true,
      status: edit.status,
      version_id: doc.current_version_id ?? null,
      download_url: activeForResolved
        ? buildDownloadUrl(
            activeForResolved.storage_path,
            (doc.filename as string) ?? "document.docx",
          )
        : null,
      remaining_pending: 0,
    };
    console.log(`[edit-resolution] returning already-resolved payload`, payload);
    return void res.status(200).json(payload);
  }

  const { rows: docRows } = await pool.query(
    "SELECT id, current_version_id, user_id, project_id FROM documents WHERE id = $1",
    [documentId]
  );
  const doc = docRows[0];
  console.log(`[edit-resolution] fetched doc`, { doc });
  if (!doc)
    return void res.status(404).json({ detail: "Document not found" });
  const access = await ensureDocAccess(doc, userId, userEmail);
  if (!access.ok)
    return void res.status(404).json({ detail: "Document not found" });

  const active = await loadActiveVersion(documentId);
  const latestPath = active?.storage_path ?? null;
  console.log(`[edit-resolution] resolved latestPath`, {
    latestPath,
    current_version_id: doc.current_version_id,
  });
  if (!latestPath)
    return void res.status(404).json({ detail: "No file to edit" });

  const raw = await downloadFile(latestPath);
  console.log(`[edit-resolution] downloaded bytes`, {
    byteLength: raw?.byteLength ?? 0,
  });
  if (!raw)
    return void res.status(404).json({ detail: "Document bytes not available" });

  const wIds = [edit.del_w_id, edit.ins_w_id].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const { bytes: resolvedBytes, found } = await resolveTrackedChange(
    Buffer.from(raw),
    wIds,
    mode,
  );
  console.log(`[edit-resolution] resolveTrackedChange result`, {
    mode,
    change_id: edit.change_id,
    wIds,
    found,
    resolvedByteLength: resolvedBytes?.byteLength ?? 0,
  });
  if (!found) {
    console.log(
      `[edit-resolution] change_id not found in docx — updating status only`,
    );
    await pool.query(
      "UPDATE document_edits SET status = $1, resolved_at = $2 WHERE id = $3",
      [mode === "accept" ? "accepted" : "rejected", new Date().toISOString(), editId]
    );
    console.log(`[edit-resolution] status-only update done`);
    const { rows: filenameRows } = await pool.query(
      "SELECT filename FROM documents WHERE id = $1",
      [documentId]
    );
    const payload = {
      ok: true,
      version_id: doc.current_version_id,
      download_url: buildDownloadUrl(
        latestPath,
        (filenameRows[0]?.filename as string) ?? "document.docx",
      ),
      remaining_pending: 0,
    };
    console.log(`[edit-resolution] returning not-found payload`, payload);
    return void res.status(200).json(payload);
  }

  const ab = resolvedBytes.buffer.slice(
    resolvedBytes.byteOffset,
    resolvedBytes.byteOffset + resolvedBytes.byteLength,
  ) as ArrayBuffer;
  console.log(`[edit-resolution] overwriting bytes in place`, {
    latestPath,
    byteLength: ab.byteLength,
  });
  await uploadFile(
    latestPath,
    ab,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );

  await pool.query(
    "UPDATE document_edits SET status = $1, resolved_at = $2 WHERE id = $3",
    [mode === "accept" ? "accepted" : "rejected", new Date().toISOString(), editId]
  );
  console.log(`[edit-resolution] updated document_edits status`, {
    editId,
    newStatus: mode === "accept" ? "accepted" : "rejected",
  });

  const { rows: countRows } = await pool.query<{ count: string }>(
    "SELECT COUNT(*) FROM document_edits WHERE document_id = $1 AND status = 'pending'",
    [documentId]
  );
  const remainingPending = parseInt(countRows[0]?.count ?? "0", 10);
  console.log(`[edit-resolution] remaining pending count`, { remainingPending });

  const { rows: filenameRows } = await pool.query(
    "SELECT filename FROM documents WHERE id = $1",
    [documentId]
  );
  const payload = {
    ok: true,
    version_id: doc.current_version_id,
    download_url: buildDownloadUrl(
      latestPath,
      (filenameRows[0]?.filename as string) ?? "document.docx",
    ),
    remaining_pending: remainingPending,
  };
  console.log(`[edit-resolution] returning success payload`, payload);
  res.json(payload);
}

documentsRouter.post(
  "/:documentId/edits/:editId/accept",
  requireAuth,
  (req, res) => void handleEditResolution(req, res, "accept"),
);

documentsRouter.post(
  "/:documentId/edits/:editId/reject",
  requireAuth,
  (req, res) => void handleEditResolution(req, res, "reject"),
);

export async function handleDocumentUpload(
  req: import("express").Request,
  res: import("express").Response,
  userId: string,
  projectId: string | null,
) {
  const file = req.file;
  if (!file) return void res.status(400).json({ detail: "file is required" });

  const filename = file.originalname;
  const suffix = filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : "";
  if (!ALLOWED_TYPES.has(suffix))
    return void res
      .status(400)
      .json({
        detail: `Unsupported file type: ${suffix}. Allowed: pdf, docx, doc`,
      });

  const content = file.buffer;
  const { rows: insertRows } = await pool.query(
    "INSERT INTO documents (project_id, user_id, filename, file_type, size_bytes, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [projectId, userId, filename, suffix, content.byteLength, "processing"]
  );
  const doc = insertRows[0];
  if (!doc)
    return void res
      .status(500)
      .json({ detail: "Failed to create document record" });

  try {
    const docId = doc.id as string;
    const key = storageKey(userId, docId, filename);
    const contentType =
      suffix === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    await uploadFile(
      key,
      content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength,
      ) as ArrayBuffer,
      contentType,
    );

    const rawBuf = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;
    const tree = await extractStructureTree(rawBuf, suffix, filename);
    const pageCount = suffix === "pdf" ? await countPdfPages(rawBuf) : null;

    let pdfStoragePath: string | null = null;
    if (suffix === "docx" || suffix === "doc") {
      try {
        const pdfBuf = await docxToPdf(content);
        const pdfKey = convertedPdfKey(userId, docId);
        await uploadFile(
          pdfKey,
          pdfBuf.buffer.slice(
            pdfBuf.byteOffset,
            pdfBuf.byteOffset + pdfBuf.byteLength,
          ) as ArrayBuffer,
          "application/pdf",
        );
        pdfStoragePath = pdfKey;
      } catch (err) {
        console.error(
          `[upload] DOCX→PDF conversion failed for ${filename}:`,
          err,
        );
      }
    } else if (suffix === "pdf") {
      pdfStoragePath = key;
    }

    const { rows: versionInsertRows } = await pool.query(
      "INSERT INTO document_versions (document_id, storage_path, pdf_storage_path, source, version_number, display_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [docId, key, pdfStoragePath, "upload", 1, filename]
    );
    const versionRow = versionInsertRows[0];
    if (!versionRow) {
      throw new Error("Failed to record upload version.");
    }

    await pool.query(
      "UPDATE documents SET current_version_id = $1, size_bytes = $2, page_count = $3, structure_tree = $4, status = $5, updated_at = $6 WHERE id = $7",
      [versionRow.id, content.byteLength, pageCount, tree ?? null, "ready", new Date().toISOString(), docId]
    );

    const { rows: updatedRows } = await pool.query(
      "SELECT * FROM documents WHERE id = $1",
      [docId]
    );
    const updated = updatedRows[0];
    const responseDoc = updated
      ? { ...updated, storage_path: key, pdf_storage_path: pdfStoragePath }
      : updated;
    return void res.status(201).json(responseDoc);
  } catch (e) {
    await pool.query("UPDATE documents SET status = 'error' WHERE id = $1", [doc.id]);
    return void res
      .status(500)
      .json({ detail: `Document processing failed: ${String(e)}` });
  }
}

async function countPdfPages(buf: ArrayBuffer): Promise<number | null> {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
    const pdf = await (
      pdfjsLib as unknown as {
        getDocument: (opts: unknown) => {
          promise: Promise<{ numPages: number }>;
        };
      }
    ).getDocument({ data: new Uint8Array(buf) }).promise;
    return pdf.numPages;
  } catch {
    return null;
  }
}

async function extractStructureTree(
  content: ArrayBuffer,
  fileType: string,
  _filename: string,
): Promise<unknown[] | null> {
  try {
    if (fileType === "pdf") {
      const pdfjsLib = await import(
        "pdfjs-dist/legacy/build/pdf.mjs" as string
      );
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
      if (outline?.length)
        return outline.map((item, i) => ({
          id: `h1-${i}`,
          title: item.title ?? `Item ${i + 1}`,
          level: 1,
          page_number: null,
          children: [],
        }));
      return Array.from({ length: pdf.numPages }, (_, i) => ({
        id: `page-${i + 1}`,
        title: `Page ${i + 1}`,
        level: 1,
        page_number: i + 1,
        children: [],
      }));
    } else {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({
        buffer: Buffer.from(content),
      });
      const lines = result.value.split("\n").filter((l) => l.trim());
      const nodes = lines
        .slice(0, 30)
        .map((line, i) => ({
          id: `h1-${i}`,
          title: line.slice(0, 100),
          level: 1,
          page_number: null,
          children: [],
        }));
      return nodes.length ? nodes : null;
    }
  } catch {
    return null;
  }
}
