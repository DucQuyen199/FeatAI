import express from "express";
import multer from "multer";
import {
  asyncHandler,
  correlationMiddleware,
  errorHandler,
  healthRouter,
  HttpError,
  internalOnly,
} from "@aicount/backend-common";
import {
  extractDocument,
  readAccountFile,
  removeAccountFile,
  storeAccountFile,
} from "./service.js";
const app = express(),
  upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: Number(process.env.MAX_UPLOAD_BYTES ?? 20 * 1024 * 1024) + 1,
    },
  });
app.use(correlationMiddleware, healthRouter("document-service"));
app.post(
  "/v1/documents/extract",
  internalOnly,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file)
      throw new HttpError(422, "file is required", "VALIDATION_ERROR");
    const tenantId = String(req.body.tenant_id ?? ""),
      correlationId = String(req.body.correlation_id ?? req.correlationId);
    if (!tenantId)
      throw new HttpError(422, "tenant_id is required", "VALIDATION_ERROR");
    res.json(await extractDocument(req.file, tenantId, correlationId));
  }),
);
app.post(
  "/v1/account-files",
  internalOnly,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file)
      throw new HttpError(422, "file is required", "VALIDATION_ERROR");
    const tenantId = String(req.body.tenant_id ?? ""),
      userId = String(req.body.user_id ?? "");
    if (!tenantId || !userId)
      throw new HttpError(
        422,
        "tenant_id and user_id are required",
        "VALIDATION_ERROR",
      );
    res.status(201).json(await storeAccountFile(req.file, tenantId, userId));
  }),
);
app.get(
  "/v1/account-files/content",
  internalOnly,
  asyncHandler(async (req, res) => {
    const tenantId = String(req.query.tenant_id ?? ""),
      userId = String(req.query.user_id ?? ""),
      storageKey = String(req.query.storage_key ?? "");
    if (!tenantId || !userId || !storageKey)
      throw new HttpError(422, "file identity is required", "VALIDATION_ERROR");
    const file = await readAccountFile(storageKey, tenantId, userId);
    res.type(file.contentType).send(file.body);
  }),
);
app.delete(
  "/v1/account-files",
  internalOnly,
  asyncHandler(async (req, res) => {
    const tenantId = String(req.query.tenant_id ?? ""),
      userId = String(req.query.user_id ?? ""),
      storageKey = String(req.query.storage_key ?? "");
    if (!tenantId || !userId || !storageKey)
      throw new HttpError(422, "file identity is required", "VALIDATION_ERROR");
    await removeAccountFile(storageKey, tenantId, userId);
    res.status(204).end();
  }),
);
app.use(errorHandler);
app.listen(Number(process.env.PORT ?? 8000), "0.0.0.0", () =>
  console.log(
    JSON.stringify({ service: "document-service", event: "started" }),
  ),
);
