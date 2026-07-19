import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type Doc = Record<string, any>;
export type Manifest = { snapshot_date: string; documents: Doc[] };
export type LegalChunk = {
  chunk_id: string;
  document_id: string;
  number: string;
  title: string;
  effective_from: string;
  status_at_snapshot: string;
  article: string;
  page_start: number;
  page_end: number;
  locator: string;
  text: string;
  chunk_sha256: string;
  extraction_method: string;
  ocr_confidence: number | null;
  source_page_url: string;
  source_pdf_url: string;
  source_sha256: string;
  snapshot_date: string;
  review_status: string;
};
export type CorpusIndex = {
  snapshot_date: string;
  manifest_sha256: string;
  documents_in_manifest: number;
  documents_indexed: number;
  documents_excluded: string[];
  chunks: number;
};

function fileSha256(path: string) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path))
    .digest("hex");
}

const verifiedPdfCache = new Map<
  string,
  { mtimeMs: number; size: number; sha256: string }
>();

export function resolveLegalPdf(
  id: string,
  manifest = loadManifest(),
  pdfRoot = process.env.LEGAL_PDF_ROOT ?? "/app/legal/raw",
) {
  const document = manifest.documents.find((item) => item.id === id);
  if (!document) return undefined;
  const root = path.resolve(pdfRoot);
  const candidate = path.resolve(root, path.basename(String(document.file)));
  if (path.dirname(candidate) !== root || !fs.existsSync(candidate))
    return null;

  const stat = fs.statSync(candidate);
  const cached = verifiedPdfCache.get(candidate);
  const sha256 =
    cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size
      ? cached.sha256
      : fileSha256(candidate);
  if (sha256 !== document.sha256 || stat.size !== Number(document.size_bytes)) {
    throw new Error(`Legal PDF checksum mismatch: ${document.id}`);
  }
  verifiedPdfCache.set(candidate, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    sha256,
  });
  return { document, path: candidate, size: stat.size, sha256 };
}

export function loadManifest(
  path = process.env.LEGAL_MANIFEST_PATH ?? "/app/legal/manifest.json",
): Manifest {
  return JSON.parse(fs.readFileSync(path, "utf8")) as Manifest;
}

export function loadChunks(
  path = process.env.LEGAL_CHUNKS_PATH ??
    "/app/legal/processed/legal_chunks.jsonl",
  manifest = loadManifest(),
): LegalChunk[] {
  const documents = new Map(
    manifest.documents.map((document) => [document.id, document]),
  );
  const chunkIds = new Set<string>();
  const chunks = fs
    .readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      const chunk = JSON.parse(line) as LegalChunk;
      const document = documents.get(chunk.document_id);
      const actualChunkHash = crypto
        .createHash("sha256")
        .update(chunk.text, "utf8")
        .digest("hex");
      if (!document || document.sha256 !== chunk.source_sha256) {
        throw new Error(
          `Legal chunk source hash mismatch at line ${index + 1}: ${chunk.chunk_id}`,
        );
      }
      if (actualChunkHash !== chunk.chunk_sha256) {
        throw new Error(
          `Legal chunk content hash mismatch at line ${index + 1}: ${chunk.chunk_id}`,
        );
      }
      if (chunk.snapshot_date !== manifest.snapshot_date) {
        throw new Error(
          `Legal chunk snapshot mismatch at line ${index + 1}: ${chunk.chunk_id}`,
        );
      }
      if (chunkIds.has(chunk.chunk_id)) {
        throw new Error(`Duplicate legal chunk id: ${chunk.chunk_id}`);
      }
      chunkIds.add(chunk.chunk_id);
      if (!chunk.locator || !chunk.page_start || !chunk.text.trim()) {
        throw new Error(
          `Legal chunk lacks evidence locator at line ${index + 1}: ${chunk.chunk_id}`,
        );
      }
      return chunk;
    });
  return chunks;
}

export function verifyCorpusIndex(
  manifestPath = process.env.LEGAL_MANIFEST_PATH ?? "/app/legal/manifest.json",
  chunksPath = process.env.LEGAL_CHUNKS_PATH ??
    "/app/legal/processed/legal_chunks.jsonl",
  indexPath = process.env.LEGAL_INDEX_PATH ??
    "/app/legal/processed/corpus_index.json",
) {
  const manifest = loadManifest(manifestPath);
  const chunks = loadChunks(chunksPath, manifest);
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as CorpusIndex;
  const indexedDocuments = new Set(chunks.map((chunk) => chunk.document_id));
  const expectedExcluded = manifest.documents
    .filter((document) => !indexedDocuments.has(document.id))
    .map((document) => String(document.id))
    .sort();
  if (index.manifest_sha256 !== fileSha256(manifestPath))
    throw new Error("Legal corpus index does not match manifest SHA-256");
  if (
    index.snapshot_date !== manifest.snapshot_date ||
    index.documents_in_manifest !== manifest.documents.length ||
    index.documents_indexed !== indexedDocuments.size ||
    index.chunks !== chunks.length ||
    JSON.stringify([...index.documents_excluded].sort()) !==
      JSON.stringify(expectedExcluded)
  )
    throw new Error(
      "Legal corpus index counters do not match loaded artifacts",
    );
  return { manifest, chunks, index };
}

function norm(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/đ/g, "d");
}

function queryTerms(query: string) {
  const stopWords = new Set([
    "cua",
    "cho",
    "theo",
    "va",
    "la",
    "ve",
    "cac",
    "mot",
    "nhung",
    "quy",
    "dinh",
  ]);
  return [
    ...new Set(
      norm(query)
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 1 && !stopWords.has(term)),
    ),
  ];
}

function isEffective(document: Doc, target: string) {
  return (
    document.effective <= target &&
    !["repealed", "expired", "promulgated_not_yet_effective"].includes(
      document.status,
    )
  );
}

function legalToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.LEGAL_TIME_ZONE ?? "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function metadataScore(document: Doc, phrase: string, terms: string[]) {
  const haystack = norm(
    ["id", "title", "number", "domain", "use"]
      .map((key) => document[key] ?? "")
      .join(" "),
  );
  return (
    (phrase.length > 2 && haystack.includes(phrase) ? 8 : 0) +
    terms.filter((term) => haystack.includes(term)).length * 2
  );
}

function chunkScore(chunk: LegalChunk, phrase: string, terms: string[]) {
  const text = norm(`${chunk.article} ${chunk.text}`);
  return (
    (phrase.length > 2 && text.includes(phrase) ? 12 : 0) +
    terms.reduce((score, term) => score + (text.includes(term) ? 3 : 0), 0)
  );
}

function excerpt(text: string, phrase: string, terms: string[]) {
  const normalized = norm(text);
  let matchAt = phrase.length > 2 ? normalized.indexOf(phrase) : -1;
  if (matchAt < 0) {
    matchAt =
      terms
        .map((term) => normalized.indexOf(term))
        .filter((position) => position >= 0)
        .sort((a, b) => a - b)[0] ?? 0;
  }
  const start = Math.max(0, matchAt - 180);
  const end = Math.min(text.length, Math.max(matchAt + 520, start + 420));
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

function extractionQuality(chunk: LegalChunk | undefined) {
  if (!chunk) return "UNAVAILABLE";
  if (chunk.extraction_method === "pymupdf_text") return "NATIVE_TEXT";
  if ((chunk.ocr_confidence ?? 0) >= 0.8) return "OCR_HIGH";
  if ((chunk.ocr_confidence ?? 0) >= 0.65) return "OCR_MEDIUM";
  return "OCR_LOW";
}

export function searchLegal(
  query: string,
  effectiveOn: string | undefined,
  limit: number,
  manifest = loadManifest(),
  chunks: LegalChunk[] = [],
  options: { groundedOnly?: boolean; domain?: string } = {},
) {
  const target = effectiveOn ?? legalToday();
  const phrase = norm(query.trim());
  const terms = queryTerms(query);
  const bestChunkByDocument = new Map<
    string,
    { chunk: LegalChunk; score: number }
  >();

  for (const chunk of chunks) {
    const score = chunkScore(chunk, phrase, terms);
    if (!score) continue;
    const current = bestChunkByDocument.get(chunk.document_id);
    if (!current || score > current.score) {
      bestChunkByDocument.set(chunk.document_id, { chunk, score });
    }
  }

  const ranked = manifest.documents
    .map((document) => {
      const metadata = metadataScore(document, phrase, terms);
      const grounded = bestChunkByDocument.get(document.id);
      return {
        document,
        chunk: grounded?.chunk,
        score: metadata + (grounded?.score ?? 0),
      };
    })
    .filter(
      (result) =>
        result.score > 0 &&
        (!options.groundedOnly || Boolean(result.chunk)) &&
        (!options.domain || result.document.domain === options.domain),
    )
    .sort(
      (a, b) =>
        Number(Boolean(b.chunk)) - Number(Boolean(a.chunk)) ||
        b.score - a.score ||
        String(b.document.effective).localeCompare(
          String(a.document.effective),
        ),
    )
    .slice(0, limit);
  const effectiveGrounded = ranked.filter(
    ({ document, chunk }) => Boolean(chunk) && isEffective(document, target),
  );
  const futureOrInactive = ranked.filter(
    ({ document, chunk }) => Boolean(chunk) && !isEffective(document, target),
  );
  const assessment = effectiveGrounded.length
    ? {
        status: "EVIDENCE_FOUND",
        label: "Đã tìm thấy căn cứ PDF đang hiệu lực",
        can_auto_decide: false,
        effective_sources: effectiveGrounded.length,
        inactive_or_future_sources: futureOrInactive.length,
        message:
          "Có căn cứ để chuyên viên đối chiếu tình tiết. Kết quả tra cứu không tự xác nhận hóa đơn hợp lệ hoặc có vi phạm.",
      }
    : futureOrInactive.length
      ? {
          status: "NO_EFFECTIVE_EVIDENCE",
          label: "Chưa có căn cứ đang hiệu lực trong kết quả",
          can_auto_decide: false,
          effective_sources: 0,
          inactive_or_future_sources: futureOrInactive.length,
          message:
            "Chỉ tìm thấy văn bản chưa hiệu lực hoặc không còn áp dụng tại ngày đối chiếu.",
        }
      : {
          status: "NO_GROUNDED_EVIDENCE",
          label: "Chưa đủ căn cứ PDF để kết luận",
          can_auto_decide: false,
          effective_sources: 0,
          inactive_or_future_sources: 0,
          message:
            "Không tìm thấy đoạn văn bản có định vị trang phù hợp; cần bổ sung dữ kiện hoặc chuyển chuyên viên.",
        };

  return {
    query,
    effective_on: target,
    legal_snapshot: manifest.snapshot_date,
    assessment,
    corpus_status: {
      mode: "verified_pdf_retrieval",
      indexed_documents: new Set(chunks.map((chunk) => chunk.document_id)).size,
      indexed_chunks: chunks.length,
      checksum_enforced: true,
    },
    results: ranked.map(({ document, chunk, score }) => {
      const effective = isEffective(document, target);
      const grounded = Boolean(chunk);
      return {
        document_id: document.id,
        chunk_id: chunk?.chunk_id ?? null,
        title: document.title,
        number: document.number,
        domain: document.domain,
        priority: document.priority,
        issued_date: document.issued,
        effective_from: document.effective,
        manifest_status: document.status,
        effective_on_query_date: effective,
        source_url: document.page_url,
        source_pdf_url: document.pdf_url,
        source_pdf_is_direct: document.pdf_url_is_direct !== false,
        source_pdf_page_url:
          document.pdf_url_is_direct === false
            ? document.page_url
            : chunk
              ? `${document.pdf_url}#page=${chunk.page_start}`
              : document.pdf_url,
        sha256: document.sha256,
        chunk_sha256: chunk?.chunk_sha256 ?? null,
        extraction_method: chunk?.extraction_method ?? null,
        ocr_confidence: chunk?.ocr_confidence ?? null,
        review_required: document.review_required,
        review_status:
          chunk?.review_status ?? "source_pdf_requires_ocr_or_reindex",
        legal_review_required: document.review_required,
        decision_eligible:
          effective && grounded && chunk?.review_status === "legally_reviewed",
        extraction_quality: extractionQuality(chunk),
        amendment_context_required: document.status === "effective_as_amended",
        retrieval_score: score,
        page_start: chunk?.page_start ?? null,
        page_end: chunk?.page_end ?? null,
        locator: chunk?.locator ?? null,
        snippet: chunk ? excerpt(chunk.text, phrase, terms) : null,
        evidence_status: !effective
          ? "INSUFFICIENT_LEGAL_EVIDENCE"
          : grounded
            ? "VERIFIED_PDF_TEXT"
            : "OCR_OR_INDEX_REQUIRED",
      };
    }),
  };
}

export function findLegal(
  id: string,
  manifest = loadManifest(),
  chunks: LegalChunk[] = [],
) {
  const document = manifest.documents.find((item) => item.id === id);
  if (!document) return undefined;
  const documentChunks = chunks.filter((chunk) => chunk.document_id === id);
  return {
    ...document,
    legal_snapshot: manifest.snapshot_date,
    full_text_available: documentChunks.length > 0,
    indexed_chunks: documentChunks.length,
    extraction_methods: [
      ...new Set(documentChunks.map((c) => c.extraction_method)),
    ],
    evidence_status: documentChunks.length
      ? "VERIFIED_PDF_TEXT"
      : "OCR_OR_INDEX_REQUIRED",
  };
}

export function listLegalDocuments(
  manifest = loadManifest(),
  chunks: LegalChunk[] = [],
) {
  const chunksByDocument = new Map<string, number>();
  for (const chunk of chunks) {
    chunksByDocument.set(
      chunk.document_id,
      (chunksByDocument.get(chunk.document_id) ?? 0) + 1,
    );
  }
  return {
    legal_snapshot: manifest.snapshot_date,
    total: manifest.documents.length,
    items: manifest.documents
      .map((document) => ({
        id: document.id,
        title: document.title,
        number: document.number,
        domain: document.domain,
        priority: document.priority,
        status: document.status,
        issued_date: document.issued,
        effective_from: document.effective,
        use: document.use,
        source_authority: document.source_authority,
        source_url: document.page_url,
        source_pdf_url: document.pdf_url,
        sha256: document.sha256,
        size_bytes: document.size_bytes,
        indexed_chunks: chunksByDocument.get(document.id) ?? 0,
        preview_url: `/api/v1/legal/documents/${encodeURIComponent(document.id)}/pdf`,
        review_required: document.review_required,
      }))
      .sort(
        (a, b) =>
          String(a.domain).localeCompare(String(b.domain), "vi") ||
          String(b.effective_from).localeCompare(String(a.effective_from)),
      ),
  };
}

export function corpusStatus(
  manifest: Manifest,
  chunks: LegalChunk[],
  indexVerified = false,
) {
  const indexedIds = new Set(chunks.map((chunk) => chunk.document_id));
  return {
    mode: "verified_pdf_retrieval",
    snapshot_date: manifest.snapshot_date,
    checksum_enforced: true,
    manifest_index_verified: indexVerified,
    documents_in_manifest: manifest.documents.length,
    documents_indexed: indexedIds.size,
    chunks_indexed: chunks.length,
    chunks_pending_legal_review: chunks.filter(
      (chunk) => chunk.review_status !== "legally_reviewed",
    ).length,
    documents_requiring_ocr_or_reindex: manifest.documents
      .filter((document) => !indexedIds.has(document.id))
      .map((document) => document.id),
  };
}
