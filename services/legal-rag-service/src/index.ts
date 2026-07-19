import express from "express";
import {
  asyncHandler,
  correlationMiddleware,
  errorHandler,
  healthRouter,
  HttpError,
  internalOnly,
} from "@aicount/backend-common";
import {
  corpusStatus,
  findLegal,
  listLegalDocuments,
  resolveLegalPdf,
  searchLegal,
  verifyCorpusIndex,
} from "./service.js";
const corpus = verifyCorpusIndex(),
  { manifest, chunks } = corpus,
  app = express();
app.use(
  correlationMiddleware,
  express.json(),
  healthRouter("legal-rag-service"),
);
app.get(
  "/v1/legal/search",
  internalOnly,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "");
    if (q.length < 2)
      throw new HttpError(
        422,
        "q must contain at least 2 characters",
        "VALIDATION_ERROR",
      );
    const effectiveOn = req.query.effective_on
      ? String(req.query.effective_on)
      : undefined;
    const effectiveDate = effectiveOn
      ? new Date(`${effectiveOn}T00:00:00Z`)
      : undefined;
    if (
      effectiveOn &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn) ||
        !effectiveDate ||
        Number.isNaN(effectiveDate.getTime()) ||
        effectiveDate.toISOString().slice(0, 10) !== effectiveOn)
    )
      throw new HttpError(
        422,
        "effective_on must use YYYY-MM-DD",
        "VALIDATION_ERROR",
      );
    res.json(
      searchLegal(
        q,
        effectiveOn,
        Math.min(50, Math.max(1, Number(req.query.limit ?? 10))),
        manifest,
        chunks,
        {
          groundedOnly: String(req.query.grounded_only ?? "false") === "true",
          domain: req.query.domain ? String(req.query.domain) : undefined,
        },
      ),
    );
  }),
);
app.get(
  "/v1/legal/documents",
  internalOnly,
  asyncHandler(async (_req, res) =>
    res.json(listLegalDocuments(manifest, chunks)),
  ),
);
app.get(
  "/v1/legal/documents/:id/pdf",
  internalOnly,
  asyncHandler(async (req, res) => {
    const pdf = resolveLegalPdf(String(req.params.id), manifest);
    if (pdf === undefined)
      throw new HttpError(404, "Legal document not found", "NOT_FOUND");
    if (pdf === null)
      throw new HttpError(503, "Legal PDF is unavailable", "PDF_UNAVAILABLE");
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdf.document.file}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-SHA256": pdf.sha256,
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    res.sendFile(pdf.path);
  }),
);
app.get(
  "/v1/legal/documents/:id",
  internalOnly,
  asyncHandler(async (req, res) => {
    const d = findLegal(String(req.params.id), manifest, chunks);
    if (!d) throw new HttpError(404, "Legal document not found", "NOT_FOUND");
    res.json(d);
  }),
);
app.get(
  "/v1/legal/corpus/status",
  internalOnly,
  asyncHandler(async (_req, res) =>
    res.json(corpusStatus(manifest, chunks, true)),
  ),
);
app.use(errorHandler);
app.listen(Number(process.env.PORT ?? 8000), "0.0.0.0", () =>
  console.log(
    JSON.stringify({ service: "legal-rag-service", event: "started" }),
  ),
);
