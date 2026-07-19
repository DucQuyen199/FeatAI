import { createHash, randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import swaggerUi from "swagger-ui-express";
import { z } from "zod";
import {
  asyncHandler,
  correlationMiddleware,
  errorHandler,
  healthRouter,
  HttpError,
  stableStringify,
} from "@aicount/backend-common";
import { invoiceDataSchema, type Principal } from "@aicount/contracts";
import { appendAudit } from "./audit.js";
import { pool, transaction, type DbClient } from "./database.js";
import {
  authenticate,
  hashPassword,
  requireRoles,
  rolesFor,
  signToken,
  verifyPassword,
} from "./security.js";
import { openapi } from "./openapi.js";
const services = {
  document: process.env.DOCUMENT_SERVICE_URL ?? "http://localhost:8001",
  rule: process.env.RULE_SERVICE_URL ?? "http://localhost:8002",
  reconciliation:
    process.env.RECONCILIATION_SERVICE_URL ?? "http://localhost:8003",
  anomaly: process.env.ANOMALY_SERVICE_URL ?? "http://localhost:8004",
  legal: process.env.LEGAL_SERVICE_URL ?? "http://localhost:8005",
};
type Service = keyof typeof services;
type Row = Record<string, any>;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize:
        Math.max(
          Number(process.env.MAX_UPLOAD_BYTES ?? 20 * 1024 * 1024),
          Number(process.env.ACCOUNT_FILE_MAX_BYTES ?? 25 * 1024 * 1024),
        ) + 1,
    },
  }),
  roles = [
    "accountant",
    "accountant_lead",
    "auditor",
    "system_admin",
    "ai_admin",
  ];
async function serviceRequest(
  service: Service,
  path: string,
  correlationId: string,
  options: RequestInit = {},
) {
  const headers = new Headers(options.headers);
  headers.set("x-internal-key", process.env.INTERNAL_API_KEY ?? "");
  headers.set("x-correlation-id", correlationId);
  if (options.body && !(options.body instanceof FormData))
    headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${services[service]}${path}`, {
      ...options,
      headers,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new HttpError(
      503,
      `${service} service unavailable`,
      "DEPENDENCY_UNAVAILABLE",
    );
  }
  const text = await response.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text || `HTTP ${response.status}` };
  }
  if (!response.ok)
    throw new HttpError(
      response.status >= 500 ? 503 : response.status,
      `${service}: ${body.detail ?? body.message ?? text}`,
      response.status >= 500 ? "DEPENDENCY_UNAVAILABLE" : "DEPENDENCY_ERROR",
    );
  return body;
}
async function serviceBinaryRequest(
  service: Service,
  path: string,
  correlationId: string,
) {
  let response: Response;
  try {
    response = await fetch(`${services[service]}${path}`, {
      headers: {
        "x-internal-key": process.env.INTERNAL_API_KEY ?? "",
        "x-correlation-id": correlationId,
      },
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new HttpError(
      503,
      `${service} service unavailable`,
      "DEPENDENCY_UNAVAILABLE",
    );
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new HttpError(
      response.status >= 500 ? 503 : response.status,
      `${service}: ${detail || `HTTP ${response.status}`}`,
      response.status >= 500 ? "DEPENDENCY_UNAVAILABLE" : "DEPENDENCY_ERROR",
    );
  }
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/pdf",
    disposition:
      response.headers.get("content-disposition") ??
      "inline; filename=document.pdf",
    sha256: response.headers.get("x-content-sha256") ?? "",
  };
}
function principal(req: express.Request): Principal {
  if (!req.principal)
    throw new HttpError(401, "Not authenticated", "UNAUTHORIZED");
  return req.principal;
}
function view(row: Row) {
  return {
    id: row.id,
    status: row.status,
    invoice_number: row.invoice_number,
    invoice_symbol: row.invoice_symbol,
    seller_tax_code: row.seller_tax_code,
    document: row.document,
    normalized_data: row.normalized_data,
    validation_result: row.validation_result,
    reconciliation_result: row.reconciliation_result,
    anomaly_result: row.anomaly_result,
    risk_result: row.risk_result,
    source_version: row.source_version,
    correlation_id: row.correlation_id,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}
function accountFileView(row: Row) {
  return {
    id: row.id,
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: Number(row.size_bytes),
    category: row.category,
    description: row.description,
    tags: row.tags ?? [],
    sha256: row.sha256,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}
async function tenantInvoice(c: DbClient, id: string, p: Principal) {
  const r = await c.query(
    "SELECT * FROM invoices WHERE id=$1 AND tenant_id=$2",
    [id, p.tenantId],
  );
  if (!r.rowCount) throw new HttpError(404, "Invoice not found", "NOT_FOUND");
  return r.rows[0];
}
async function ensureReview(
  c: DbClient,
  invoice: Row,
  p: Principal,
  correlationId: string,
) {
  let task = (
    await c.query(
      "SELECT * FROM review_tasks WHERE invoice_id=$1 AND tenant_id=$2 AND status='PENDING' LIMIT 1",
      [invoice.id, p.tenantId],
    )
  ).rows[0];
  if (!task) {
    task = (
      await c.query(
        "INSERT INTO review_tasks(id,tenant_id,invoice_id,correlation_id,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [randomUUID(), p.tenantId, invoice.id, correlationId, p.user.id],
      )
    ).rows[0];
    await appendAudit(
      c,
      p,
      "review.created",
      "review_task",
      task.id,
      { invoice_id: invoice.id },
      correlationId,
    );
  }
  return task;
}
export function createApp() {
  const app = express();
  app.use(
    correlationMiddleware,
    helmet({ contentSecurityPolicy: false }),
    cors({
      origin: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(","),
      credentials: true,
    }),
    healthRouter("api-gateway"),
  );
  app.get("/openapi.json", (_req, res) => res.json(openapi));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi));
  app.use(express.json({ limit: "2mb" }));
  app.post(
    "/api/v1/auth/login",
    asyncHandler(async (req, res) => {
      const input = z
          .object({ email: z.email(), password: z.string().min(8).max(200) })
          .parse(req.body),
        result = await pool.query(
          `SELECT users.*,tenants.name AS tenant_name
           FROM users JOIN tenants ON tenants.id=users.tenant_id
           WHERE lower(users.email)=lower($1)`,
          [input.email],
        ),
        user = result.rows[0];
      if (
        !user ||
        !user.is_active ||
        !(await verifyPassword(user.password_hash, input.password))
      )
        throw new HttpError(401, "Invalid email or password", "UNAUTHORIZED");
      const userRoles = await rolesFor(user.id);
      res.json({
        access_token: signToken(user, userRoles),
        token_type: "bearer",
        expires_in: Number(process.env.ACCESS_TOKEN_MINUTES ?? 30) * 60,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          roles: userRoles,
          tenant_id: user.tenant_id,
          tenant_name: user.tenant_name,
        },
      });
    }),
  );
  app.use("/api/v1", authenticate);
  app.get("/api/v1/auth/me", (req, res) => {
    const p = principal(req);
    res.json({
      id: p.user.id,
      email: p.user.email,
      full_name: p.user.full_name,
      roles: p.roles,
      tenant_id: p.tenantId,
      tenant_name: p.user.tenant_name,
    });
  });
  app.get(
    "/api/v1/files",
    asyncHandler(async (req, res) => {
      const p = principal(req),
        limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100))),
        offset = Math.max(0, Number(req.query.offset ?? 0)),
        search = String(req.query.q ?? "").trim(),
        category = String(req.query.category ?? "").trim(),
        params: any[] = [p.tenantId, p.user.id],
        clauses = ["tenant_id=$1", "owner_id=$2"];
      if (search) {
        params.push(`%${search}%`);
        clauses.push(
          `(filename ILIKE $${params.length} OR description ILIKE $${params.length})`,
        );
      }
      if (category && category !== "all") {
        params.push(category);
        clauses.push(`category=$${params.length}`);
      }
      const where = clauses.join(" AND ");
      params.push(offset, limit);
      const [files, usage] = await Promise.all([
        pool.query(
          `SELECT * FROM account_files WHERE ${where} ORDER BY created_at DESC OFFSET $${params.length - 1} LIMIT $${params.length}`,
          params,
        ),
        pool.query(
          "SELECT count(*)::int total,COALESCE(sum(size_bytes),0)::bigint used_bytes FROM account_files WHERE tenant_id=$1 AND owner_id=$2",
          [p.tenantId, p.user.id],
        ),
      ]);
      res.json({
        items: files.rows.map(accountFileView),
        total: usage.rows[0].total,
        used_bytes: Number(usage.rows[0].used_bytes),
        quota_bytes: Number(
          process.env.ACCOUNT_STORAGE_QUOTA_BYTES ?? 500 * 1024 * 1024,
        ),
        limit,
        offset,
      });
    }),
  );
  app.post(
    "/api/v1/files",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const p = principal(req);
      if (!req.file)
        throw new HttpError(422, "file is required", "VALIDATION_ERROR");
      const quota = Number(
          process.env.ACCOUNT_STORAGE_QUOTA_BYTES ?? 500 * 1024 * 1024,
        ),
        used = Number(
          (
            await pool.query(
              "SELECT COALESCE(sum(size_bytes),0)::bigint used FROM account_files WHERE tenant_id=$1 AND owner_id=$2",
              [p.tenantId, p.user.id],
            )
          ).rows[0].used,
        );
      if (used + req.file.size > quota)
        throw new HttpError(
          413,
          "Account storage quota exceeded",
          "STORAGE_QUOTA_EXCEEDED",
        );
      const description = String(req.body.description ?? "")
          .trim()
          .slice(0, 2000),
        tags = String(req.body.tags ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 20),
        form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(req.file.buffer)], {
          type: req.file.mimetype,
        }),
        req.file.originalname,
      );
      form.append("tenant_id", p.tenantId);
      form.append("user_id", p.user.id);
      const stored = await serviceRequest(
        "document",
        "/v1/account-files",
        req.correlationId,
        { method: "POST", body: form },
      );
      try {
        const row = (
          await pool.query(
            "INSERT INTO account_files(id,tenant_id,owner_id,filename,storage_key,sha256,content_type,size_bytes,category,description,tags,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
            [
              stored.id,
              p.tenantId,
              p.user.id,
              stored.filename,
              stored.storage_key,
              stored.sha256,
              stored.content_type,
              stored.size_bytes,
              stored.category,
              description,
              JSON.stringify(tags),
              req.correlationId,
            ],
          )
        ).rows[0];
        await transaction(async (c) =>
          appendAudit(
            c,
            p,
            "account_file.uploaded",
            "account_file",
            row.id,
            {
              filename: row.filename,
              size_bytes: row.size_bytes,
              sha256: row.sha256,
            },
            req.correlationId,
          ),
        );
        res.status(201).json(accountFileView(row));
      } catch (error) {
        await serviceRequest(
          "document",
          `/v1/account-files?${new URLSearchParams({ tenant_id: p.tenantId, user_id: p.user.id, storage_key: stored.storage_key })}`,
          req.correlationId,
          { method: "DELETE" },
        ).catch(() => undefined);
        throw error;
      }
    }),
  );
  app.get(
    "/api/v1/files/:id/download",
    asyncHandler(async (req, res) => {
      const p = principal(req),
        row = (
          await pool.query(
            "SELECT * FROM account_files WHERE id=$1 AND tenant_id=$2 AND owner_id=$3",
            [req.params.id, p.tenantId, p.user.id],
          )
        ).rows[0];
      if (!row) throw new HttpError(404, "File not found", "NOT_FOUND");
      const params = new URLSearchParams({
          tenant_id: p.tenantId,
          user_id: p.user.id,
          storage_key: row.storage_key,
        }),
        response = await fetch(
          `${services.document}/v1/account-files/content?${params}`,
          {
            headers: {
              "x-internal-key": process.env.INTERNAL_API_KEY ?? "",
              "x-correlation-id": req.correlationId,
            },
          },
        );
      if (!response.ok)
        throw new HttpError(
          response.status >= 500 ? 503 : response.status,
          "Unable to read stored file",
          "FILE_READ_ERROR",
        );
      res.setHeader("content-type", row.content_type);
      res.setHeader("content-length", String(row.size_bytes));
      res.setHeader(
        "content-disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      );
      res.send(Buffer.from(await response.arrayBuffer()));
    }),
  );
  app.patch(
    "/api/v1/files/:id",
    asyncHandler(async (req, res) => {
      const p = principal(req),
        input = z
          .object({
            description: z.string().max(2000).optional(),
            tags: z.array(z.string().min(1).max(50)).max(20).optional(),
          })
          .parse(req.body),
        row = (
          await pool.query(
            "UPDATE account_files SET description=COALESCE($1,description),tags=COALESCE($2,tags),updated_at=now() WHERE id=$3 AND tenant_id=$4 AND owner_id=$5 RETURNING *",
            [
              input.description,
              input.tags ? JSON.stringify(input.tags) : null,
              req.params.id,
              p.tenantId,
              p.user.id,
            ],
          )
        ).rows[0];
      if (!row) throw new HttpError(404, "File not found", "NOT_FOUND");
      await transaction(async (c) =>
        appendAudit(
          c,
          p,
          "account_file.updated",
          "account_file",
          row.id,
          { description: row.description, tags: row.tags },
          req.correlationId,
        ),
      );
      res.json(accountFileView(row));
    }),
  );
  app.delete(
    "/api/v1/files/:id",
    asyncHandler(async (req, res) => {
      const p = principal(req),
        row = (
          await pool.query(
            "SELECT * FROM account_files WHERE id=$1 AND tenant_id=$2 AND owner_id=$3",
            [req.params.id, p.tenantId, p.user.id],
          )
        ).rows[0];
      if (!row) throw new HttpError(404, "File not found", "NOT_FOUND");
      const params = new URLSearchParams({
        tenant_id: p.tenantId,
        user_id: p.user.id,
        storage_key: row.storage_key,
      });
      await serviceRequest(
        "document",
        `/v1/account-files?${params}`,
        req.correlationId,
        { method: "DELETE" },
      );
      await transaction(async (c) => {
        await c.query(
          "DELETE FROM account_files WHERE id=$1 AND tenant_id=$2 AND owner_id=$3",
          [row.id, p.tenantId, p.user.id],
        );
        await appendAudit(
          c,
          p,
          "account_file.deleted",
          "account_file",
          row.id,
          { filename: row.filename, sha256: row.sha256 },
          req.correlationId,
        );
      });
      res.status(204).end();
    }),
  );
  app.post(
    "/api/v1/users",
    requireRoles("system_admin"),
    asyncHandler(async (req, res) => {
      const p = principal(req),
        input = z
          .object({
            email: z.email(),
            full_name: z.string().min(2).max(200),
            password: z.string().min(12).max(200),
            roles: z.array(z.string()).default(["accountant"]),
          })
          .parse(req.body),
        invalid = input.roles.filter((x) => !roles.includes(x));
      if (invalid.length)
        throw new HttpError(
          422,
          `Unknown roles: ${invalid.join(", ")}`,
          "VALIDATION_ERROR",
        );
      const output = await transaction(async (c) => {
        if (
          (
            await c.query("SELECT 1 FROM users WHERE lower(email)=lower($1)", [
              input.email,
            ])
          ).rowCount
        )
          throw new HttpError(409, "Email already exists", "CONFLICT");
        const id = randomUUID();
        await c.query(
          "INSERT INTO users(id,tenant_id,email,full_name,password_hash) VALUES($1,$2,$3,$4,$5)",
          [
            id,
            p.tenantId,
            input.email.toLowerCase(),
            input.full_name,
            await hashPassword(input.password),
          ],
        );
        for (const role of input.roles)
          await c.query(
            "INSERT INTO user_roles(id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE name=$3",
            [randomUUID(), id, role],
          );
        await appendAudit(
          c,
          p,
          "user.created",
          "user",
          id,
          { email: input.email.toLowerCase(), roles: input.roles },
          req.correlationId,
        );
        return { id, email: input.email.toLowerCase(), roles: input.roles };
      });
      res.status(201).json(output);
    }),
  );
  app.get(
    "/api/v1/invoices",
    asyncHandler(async (req, res) => {
      const p = principal(req),
        limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50))),
        offset = Math.max(0, Number(req.query.offset ?? 0)),
        [items, total] = await Promise.all([
          pool.query(
            "SELECT * FROM invoices WHERE tenant_id=$1 ORDER BY created_at DESC OFFSET $2 LIMIT $3",
            [p.tenantId, offset, limit],
          ),
          pool.query(
            "SELECT count(*)::int total FROM invoices WHERE tenant_id=$1",
            [p.tenantId],
          ),
        ]);
      res.json({
        items: items.rows.map(view),
        total: total.rows[0].total,
        limit,
        offset,
      });
    }),
  );
  app.post(
    "/api/v1/invoices",
    requireRoles("accountant", "accountant_lead", "system_admin"),
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const p = principal(req);
      if (!req.file)
        throw new HttpError(422, "file is required", "VALIDATION_ERROR");
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(req.file.buffer)], {
          type: req.file.mimetype,
        }),
        req.file.originalname,
      );
      form.append("tenant_id", p.tenantId);
      form.append("correlation_id", req.correlationId);
      const result = await serviceRequest(
          "document",
          "/v1/documents/extract",
          req.correlationId,
          { method: "POST", body: form },
        ),
        normalized = invoiceDataSchema.parse(result.invoice);
      const row = await transaction(async (c) => {
        const id = randomUUID(),
          document = Object.fromEntries(
            Object.entries(result).filter(([key]) => key !== "invoice"),
          );
        const invoice = (
          await c.query(
            "INSERT INTO invoices(id,tenant_id,created_by,correlation_id,invoice_number,invoice_symbol,seller_tax_code,document,normalized_data,source_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
            [
              id,
              p.tenantId,
              p.user.id,
              req.correlationId,
              normalized.invoice_number,
              normalized.invoice_symbol,
              normalized.seller_tax_code,
              JSON.stringify(document),
              JSON.stringify(normalized),
              result.parser_version,
            ],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO invoice_files(id,tenant_id,invoice_id,storage_key,sha256,content_type,size_bytes,created_by,source_version,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            randomUUID(),
            p.tenantId,
            id,
            result.storage_key,
            result.sha256,
            result.content_type,
            result.size_bytes,
            p.user.id,
            result.parser_version,
            req.correlationId,
          ],
        );
        const runId = randomUUID();
        await c.query(
          "INSERT INTO extraction_runs(id,tenant_id,invoice_id,status,result,created_by,source_version,correlation_id) VALUES($1,$2,$3,'COMPLETED',$4,$5,$6,$7)",
          [
            runId,
            p.tenantId,
            id,
            JSON.stringify(normalized),
            p.user.id,
            result.parser_version,
            req.correlationId,
          ],
        );
        for (const field of [
          "invoice_number",
          "invoice_date",
          "seller_tax_code",
          "subtotal",
          "tax_amount",
          "total_amount",
        ] as const)
          await c.query(
            "INSERT INTO extracted_fields(id,tenant_id,extraction_run_id,field_name,value,confidence,created_by,source_version,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              randomUUID(),
              p.tenantId,
              runId,
              field,
              JSON.stringify({ value: normalized[field] }),
              String(normalized.extraction_confidence),
              p.user.id,
              result.parser_version,
              req.correlationId,
            ],
          );
        for (let i = 0; i < normalized.lines.length; i++)
          await c.query(
            "INSERT INTO invoice_lines(id,tenant_id,invoice_id,line_number,data,created_by,source_version,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              randomUUID(),
              p.tenantId,
              id,
              i + 1,
              JSON.stringify(normalized.lines[i]),
              p.user.id,
              result.parser_version,
              req.correlationId,
            ],
          );
        await appendAudit(
          c,
          p,
          "invoice.uploaded",
          "invoice",
          id,
          { sha256: result.sha256, parser_version: result.parser_version },
          req.correlationId,
        );
        return invoice;
      });
      res.status(201).json(view(row));
    }),
  );
  app.get(
    "/api/v1/invoices/:id",
    asyncHandler(async (req, res) => {
      const c = await pool.connect();
      try {
        res.json(
          view(await tenantInvoice(c, String(req.params.id), principal(req))),
        );
      } finally {
        c.release();
      }
    }),
  );
  app.post(
    "/api/v1/invoices/:id/extract",
    asyncHandler(async (req, res) => {
      const c = await pool.connect();
      try {
        const i = await tenantInvoice(c, String(req.params.id), principal(req));
        res.json({
          invoice_id: i.id,
          document: i.document,
          invoice: i.normalized_data,
          immutable_original: true,
        });
      } finally {
        c.release();
      }
    }),
  );
  app.patch(
    "/api/v1/invoices/:id/fields",
    requireRoles("accountant", "accountant_lead", "system_admin"),
    asyncHandler(async (req, res) => {
      const p = principal(req),
        input = z
          .object({
            field_name: z.string().min(1).max(100),
            value: z.unknown(),
            reason: z.string().min(5).max(2000),
          })
          .parse(req.body),
        forbidden = new Set(["raw_fields", "lines"]),
        allowed = new Set(Object.keys(invoiceDataSchema.shape));
      if (!allowed.has(input.field_name) || forbidden.has(input.field_name))
        throw new HttpError(
          422,
          "Field cannot be corrected through this endpoint",
          "VALIDATION_ERROR",
        );
      const output = await transaction(async (c) => {
        const invoice = await tenantInvoice(c, String(req.params.id), p),
          old = invoice.normalized_data[input.field_name],
          normalized = invoiceDataSchema.parse({
            ...invoice.normalized_data,
            [input.field_name]: input.value,
          });
        await c.query(
          "INSERT INTO field_corrections(id,tenant_id,invoice_id,field_name,old_value,new_value,reason,created_by,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            randomUUID(),
            p.tenantId,
            invoice.id,
            input.field_name,
            JSON.stringify({ value: old }),
            JSON.stringify({ value: (normalized as any)[input.field_name] }),
            input.reason,
            p.user.id,
            req.correlationId,
          ],
        );
        await c.query(
          "UPDATE invoices SET normalized_data=$1,invoice_number=$2,invoice_symbol=$3,seller_tax_code=$4,status='NEEDS_REVIEW',updated_at=now() WHERE id=$5",
          [
            JSON.stringify(normalized),
            normalized.invoice_number,
            normalized.invoice_symbol,
            normalized.seller_tax_code,
            invoice.id,
          ],
        );
        const task = await ensureReview(c, invoice, p, req.correlationId);
        await appendAudit(
          c,
          p,
          "invoice.field_corrected",
          "invoice",
          invoice.id,
          {
            field: input.field_name,
            old_value: old,
            new_value: (normalized as any)[input.field_name],
            reason: input.reason,
            review_id: task.id,
          },
          req.correlationId,
        );
        return {
          invoice_id: invoice.id,
          field_name: input.field_name,
          old_value: old,
          new_value: (normalized as any)[input.field_name],
          status: "NEEDS_REVIEW",
          review_id: task.id,
        };
      });
      res.json(output);
    }),
  );
  app.post(
    "/api/v1/invoices/:id/validate",
    requireRoles("accountant", "accountant_lead", "auditor", "system_admin"),
    asyncHandler(async (req, res) => {
      const p = principal(req),
        c = await pool.connect();
      let invoice: Row,
        duplicate = false;
      try {
        invoice = await tenantInvoice(c, String(req.params.id), p);
        duplicate = Boolean(
          (
            await c.query(
              "SELECT 1 FROM invoices WHERE tenant_id=$1 AND id<>$2 AND seller_tax_code=$3 AND invoice_symbol=$4 AND invoice_number=$5 LIMIT 1",
              [
                p.tenantId,
                invoice.id,
                invoice.seller_tax_code,
                invoice.invoice_symbol,
                invoice.invoice_number,
              ],
            )
          ).rowCount,
        );
      } finally {
        c.release();
      }
      const result = await serviceRequest(
        "rule",
        "/v1/rules/validate",
        req.correlationId,
        {
          method: "POST",
          body: JSON.stringify({
            invoice: invoice!.normalized_data,
            duplicate,
            correlation_id: req.correlationId,
            legal_rate_supported: null,
          }),
        },
      );
      const output = await transaction(async (db) => {
        const current = await tenantInvoice(db, String(req.params.id), p),
          status =
            result.decision?.status === "PASS_TECHNICAL_CHECKS"
              ? "VALIDATED"
              : "NEEDS_REVIEW";
        await db.query(
          "UPDATE invoices SET validation_result=$1,status=$2,updated_at=now() WHERE id=$3",
          [JSON.stringify(result), status, current.id],
        );
        await db.query(
          "INSERT INTO rule_results(id,tenant_id,invoice_id,result,created_by,source_version,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            p.tenantId,
            current.id,
            JSON.stringify(result),
            p.user.id,
            result.ruleset,
            req.correlationId,
          ],
        );
        const task = await ensureReview(db, current, p, req.correlationId);
        await appendAudit(
          db,
          p,
          "invoice.validated",
          "invoice",
          current.id,
          {
            ruleset: result.ruleset,
            decision_status: result.decision?.status,
            decision_reason: result.decision?.reason_code,
            alert_codes: result.alerts.map((x: Row) => x.code),
            review_id: task.id,
          },
          req.correlationId,
        );
        return {
          ...result,
          invoice_id: current.id,
          review_id: task.id,
          status,
        };
      });
      res.json(output);
    }),
  );
  app.post(
    "/api/v1/invoices/:id/reconcile",
    requireRoles("accountant", "accountant_lead", "auditor", "system_admin"),
    asyncHandler(async (req, res) => {
      const p = principal(req),
        c = await pool.connect();
      let invoice;
      try {
        invoice = await tenantInvoice(c, String(req.params.id), p);
      } finally {
        c.release();
      }
      const result = await serviceRequest(
        "reconciliation",
        "/v1/reconciliation/run",
        req.correlationId,
        {
          method: "POST",
          body: JSON.stringify({
            invoice: invoice.normalized_data,
            ...req.body,
            correlation_id: req.correlationId,
          }),
        },
      );
      await transaction(async (db) => {
        const current = await tenantInvoice(db, String(req.params.id), p);
        await db.query(
          "UPDATE invoices SET reconciliation_result=$1,updated_at=now() WHERE id=$2",
          [JSON.stringify(result), current.id],
        );
        await db.query(
          "INSERT INTO reconciliation_runs(id,tenant_id,invoice_id,result,created_by,correlation_id) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            p.tenantId,
            current.id,
            JSON.stringify(result),
            p.user.id,
            req.correlationId,
          ],
        );
        await ensureReview(db, current, p, req.correlationId);
        await appendAudit(
          db,
          p,
          "invoice.reconciled",
          "invoice",
          current.id,
          {
            status: result.status,
            alert_codes: result.alerts.map((x: Row) => x.code),
          },
          req.correlationId,
        );
      });
      res.json(result);
    }),
  );
  app.post(
    "/api/v1/invoices/:id/score",
    requireRoles(
      "accountant",
      "accountant_lead",
      "auditor",
      "ai_admin",
      "system_admin",
    ),
    asyncHandler(async (req, res) => {
      const p = principal(req),
        c = await pool.connect();
      let invoice;
      try {
        invoice = await tenantInvoice(c, String(req.params.id), p);
      } finally {
        c.release();
      }
      const anomaly = await serviceRequest(
          "anomaly",
          "/v1/anomaly/score",
          req.correlationId,
          {
            method: "POST",
            body: JSON.stringify({
              invoice: invoice.normalized_data,
              ...req.body,
              correlation_id: req.correlationId,
            }),
          },
        ),
        ruleScore = Number(invoice.validation_result?.rule_score ?? 0),
        anomalyScore = Number(anomaly.anomaly_score),
        reconciliationScore = Number(
          invoice.reconciliation_result?.reconciliation_score ?? 0,
        ),
        confidence = Number(invoice.normalized_data.extraction_confidence ?? 0),
        dataQuality = (1 - confidence) * 100,
        uncertainty = (1 - confidence) * 100,
        score = +(
          0.35 * ruleScore +
          0.3 * anomalyScore +
          0.2 * reconciliationScore +
          0.1 * dataQuality +
          0.05 * uncertainty
        ).toFixed(3),
        level = score >= 60 ? "high" : score >= 30 ? "medium" : "low",
        risk = {
          score,
          level,
          components: {
            rule_score: ruleScore,
            anomaly_score: anomalyScore,
            reconciliation_score: reconciliationScore,
            data_quality_score: dataQuality,
            uncertainty_score: uncertainty,
          },
          requires_human_review: true,
          formula_version: "risk-aggregator@2.0.0",
        };
      const reviewId = await transaction(async (db) => {
        const current = await tenantInvoice(db, String(req.params.id), p);
        await db.query(
          "UPDATE invoices SET anomaly_result=$1,risk_result=$2,status='NEEDS_REVIEW',updated_at=now() WHERE id=$3",
          [JSON.stringify(anomaly), JSON.stringify(risk), current.id],
        );
        await db.query(
          "INSERT INTO model_predictions(id,tenant_id,invoice_id,result,created_by,source_version,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            p.tenantId,
            current.id,
            JSON.stringify(anomaly),
            p.user.id,
            anomaly.model_version,
            req.correlationId,
          ],
        );
        await db.query(
          "INSERT INTO risk_assessments(id,tenant_id,invoice_id,result,created_by,correlation_id) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            p.tenantId,
            current.id,
            JSON.stringify(risk),
            p.user.id,
            req.correlationId,
          ],
        );
        const task = await ensureReview(db, current, p, req.correlationId);
        await appendAudit(
          db,
          p,
          "invoice.scored",
          "invoice",
          current.id,
          {
            risk_score: score,
            risk_level: level,
            model_version: anomaly.model_version,
          },
          req.correlationId,
        );
        return task.id;
      });
      res.json({ invoice_id: invoice.id, anomaly, risk, review_id: reviewId });
    }),
  );
  app.get(
    "/api/v1/invoices/:id/evidence",
    asyncHandler(async (req, res) => {
      const c = await pool.connect();
      try {
        const i = await tenantInvoice(c, String(req.params.id), principal(req)),
          alerts = [
            i.validation_result,
            i.reconciliation_result,
            i.anomaly_result,
          ]
            .filter(Boolean)
            .flatMap((x: Row) => x.alerts ?? []);
        res.json({
          invoice_id: i.id,
          original_document: i.document,
          normalized_data: i.normalized_data,
          alerts,
          risk: i.risk_result,
          decision_is_human: true,
          legal_disclaimer:
            "Kết quả là cảnh báo hỗ trợ, không phải kết luận pháp lý/kế toán/thuế.",
        });
      } finally {
        c.release();
      }
    }),
  );
  app.get(
    "/api/v1/reviews",
    requireRoles("accountant_lead", "auditor", "system_admin"),
    asyncHandler(async (req, res) => {
      const p = principal(req),
        params: any[] = [p.tenantId],
        status = req.query.status
          ? String(req.query.status).toUpperCase()
          : undefined,
        where = status ? " AND status=$2" : "";
      if (status) params.push(status);
      const r = await pool.query(
        `SELECT * FROM review_tasks WHERE tenant_id=$1${where} ORDER BY created_at DESC LIMIT 200`,
        params,
      );
      res.json({
        items: r.rows.map((x) => ({
          id: x.id,
          invoice_id: x.invoice_id,
          status: x.status,
          assigned_role: x.assigned_role,
          created_at: new Date(x.created_at).toISOString(),
        })),
      });
    }),
  );
  app.post(
    "/api/v1/reviews/:id/decisions",
    requireRoles("accountant_lead", "auditor", "system_admin"),
    asyncHandler(async (req, res) => {
      const p = principal(req),
        input = z
          .object({
            decision: z.enum(["ACCEPTED", "REJECTED", "ESCALATED"]),
            comment: z.string().min(3).max(2000),
          })
          .parse(req.body),
        output = await transaction(async (c) => {
          const task = (
            await c.query(
              "SELECT * FROM review_tasks WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
              [req.params.id, p.tenantId],
            )
          ).rows[0];
          if (!task)
            throw new HttpError(404, "Review task not found", "NOT_FOUND");
          if (task.status !== "PENDING")
            throw new HttpError(409, "Review task already decided", "CONFLICT");
          const invoice = await tenantInvoice(c, task.invoice_id, p),
            id = randomUUID(),
            invoiceStatus = {
              ACCEPTED: "HUMAN_APPROVED",
              REJECTED: "REJECTED",
              ESCALATED: "ESCALATED",
            }[input.decision];
          await c.query(
            "INSERT INTO review_decisions(id,review_id,tenant_id,decision,comment,created_by,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              id,
              task.id,
              p.tenantId,
              input.decision,
              input.comment,
              p.user.id,
              req.correlationId,
            ],
          );
          await c.query("UPDATE review_tasks SET status=$1 WHERE id=$2", [
            input.decision,
            task.id,
          ]);
          await c.query(
            "UPDATE invoices SET status=$1,updated_at=now() WHERE id=$2",
            [invoiceStatus, invoice.id],
          );
          await appendAudit(
            c,
            p,
            "review.decided",
            "review_task",
            task.id,
            {
              invoice_id: invoice.id,
              decision: input.decision,
              comment: input.comment,
            },
            req.correlationId,
          );
          return {
            id,
            review_id: task.id,
            invoice_id: invoice.id,
            decision: input.decision,
            invoice_status: invoiceStatus,
            decided_by: p.user.id,
          };
        });
      res.status(201).json(output);
    }),
  );
  app.get(
    "/api/v1/legal/search",
    asyncHandler(async (req, res) => {
      const q = String(req.query.q ?? "");
      if (q.length < 2)
        throw new HttpError(
          422,
          "q must contain at least 2 characters",
          "VALIDATION_ERROR",
        );
      const params = new URLSearchParams({
        q,
        limit: String(req.query.limit ?? 10),
      });
      if (req.query.effective_on)
        params.set("effective_on", String(req.query.effective_on));
      if (req.query.grounded_only)
        params.set("grounded_only", String(req.query.grounded_only));
      if (req.query.domain) params.set("domain", String(req.query.domain));
      res.json(
        await serviceRequest(
          "legal",
          `/v1/legal/search?${params}`,
          req.correlationId,
        ),
      );
    }),
  );
  app.get(
    "/api/v1/legal/documents",
    asyncHandler(async (req, res) =>
      res.json(
        await serviceRequest("legal", "/v1/legal/documents", req.correlationId),
      ),
    ),
  );
  app.get(
    "/api/v1/legal/documents/:id/pdf",
    asyncHandler(async (req, res) => {
      const pdf = await serviceBinaryRequest(
        "legal",
        `/v1/legal/documents/${encodeURIComponent(String(req.params.id))}/pdf`,
        req.correlationId,
      );
      res.set({
        "Content-Type": pdf.contentType,
        "Content-Disposition": pdf.disposition,
        "Content-Length": String(pdf.body.length),
        "Cache-Control": "private, max-age=3600",
        "X-Content-SHA256": pdf.sha256,
        "Cross-Origin-Resource-Policy": "cross-origin",
      });
      res.send(pdf.body);
    }),
  );
  app.get(
    "/api/v1/legal/documents/:id",
    asyncHandler(async (req, res) =>
      res.json(
        await serviceRequest(
          "legal",
          `/v1/legal/documents/${encodeURIComponent(String(req.params.id))}`,
          req.correlationId,
        ),
      ),
    ),
  );
  app.get(
    "/api/v1/legal/corpus/status",
    asyncHandler(async (req, res) =>
      res.json(
        await serviceRequest(
          "legal",
          "/v1/legal/corpus/status",
          req.correlationId,
        ),
      ),
    ),
  );
  app.get(
    "/api/v1/audit/events",
    requireRoles("auditor", "system_admin"),
    asyncHandler(async (req, res) => {
      const p = principal(req),
        limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100))),
        r = await pool.query(
          "SELECT * FROM audit_events WHERE tenant_id=$1 ORDER BY sequence DESC LIMIT $2",
          [p.tenantId, limit],
        );
      res.json({
        items: r.rows.map((x) => ({
          ...x,
          created_at: new Date(x.created_at).toISOString(),
        })),
      });
    }),
  );
  app.get(
    "/api/v1/audit/verify",
    requireRoles("auditor", "system_admin"),
    asyncHandler(async (req, res) => {
      const p = principal(req),
        events = (
          await pool.query(
            "SELECT * FROM audit_events WHERE tenant_id=$1 ORDER BY sequence ASC",
            [p.tenantId],
          )
        ).rows;
      let previous = "0".repeat(64);
      const failures = [];
      let hashVerifiedEvents = 0;
      let legacyStructuralEvents = 0;
      for (const e of events) {
        const expected = createHash("sha256")
          .update(
            stableStringify({
              sequence: e.sequence,
              tenant: e.tenant_id,
              actor: e.actor_id,
              action: e.action,
              resource: e.resource_id,
              payload: e.payload,
              previous_hash: previous,
            }),
          )
          .digest("hex");
        // Python v1 serialized floating-point payloads before JSONB storage;
        // JSONB may normalize 10.0 to 10, so that original byte stream cannot
        // always be reconstructed. Its links remain verifiable during upgrade.
        const legacy = String(e.source_version).startsWith("audit-chain@1.");
        if (legacy) legacyStructuralEvents += 1;
        else hashVerifiedEvents += 1;
        if (
          e.previous_hash !== previous ||
          (!legacy && e.event_hash !== expected)
        )
          failures.push({ event_id: e.id, sequence: e.sequence });
        previous = e.event_hash;
      }
      res.json({
        valid: !failures.length,
        event_count: events.length,
        failures,
        algorithm: "SHA-256",
        scope: "tenant",
        hash_verified_events: hashVerifiedEvents,
        legacy_structural_events: legacyStructuralEvents,
      });
    }),
  );
  app.use(errorHandler);
  return app;
}
