import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Router } from "express";
import type { StructuredError } from "@aicount/contracts";
import { ZodError, type ZodType } from "zod";

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      principal?: import("@aicount/contracts").Principal;
    }
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_ERROR",
    public details?: unknown,
  ) {
    super(message);
  }
}

export const asyncHandler =
  (
    handler: (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) =>
    void handler(req, res, next).catch(next);

export const correlationMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.header("x-correlation-id");
  req.correlationId =
    incoming && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : randomUUID();
  res.set({
    "x-correlation-id": req.correlationId,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  next();
};

export const internalOnly: RequestHandler = (req, _res, next) => {
  const key = process.env.INTERNAL_API_KEY;
  if (!key || req.header("x-internal-key") !== key)
    return next(
      new HttpError(401, "Invalid internal service credential", "UNAUTHORIZED"),
    );
  next();
};

export function validate<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

export const errorHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const correlationId = req.correlationId || randomUUID();
  if (error instanceof ZodError) {
    const body: StructuredError = {
      code: "VALIDATION_ERROR",
      message: "Request data is invalid",
      correlation_id: correlationId,
      details: { errors: error.issues },
    };
    res.status(422).json(body);
    return;
  }
  const known = error instanceof HttpError;
  const status = known ? error.status : 500;
  if (!known)
    console.error(
      JSON.stringify({
        level: "error",
        correlation_id: correlationId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  const body: StructuredError = {
    code: known ? error.code : "INTERNAL_ERROR",
    message: known ? error.message : "Unexpected server error",
    correlation_id: correlationId,
    ...(known && error.details !== undefined ? { details: error.details } : {}),
  };
  res.status(status).json(body);
};

export function healthRouter(service: string, version = "2.0.0"): Router {
  const router = Router();
  router.get("/health", (_req, res) =>
    res.json({
      status: "ok",
      service,
      version,
      timestamp: new Date().toISOString(),
    }),
  );
  return router;
}

export function numberValue(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const result = Number(value.replace(/,/g, ""));
    return Number.isFinite(result) ? result : 0;
  }
  return 0;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
