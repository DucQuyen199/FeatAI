import fs from "node:fs";

const api = process.env.SMOKE_API_URL ?? "http://localhost:8000";
const email =
  process.env.SMOKE_ADMIN_EMAIL ??
  process.env.BOOTSTRAP_ADMIN_EMAIL ??
  "admin@aicount.example.com";
const password =
  process.env.SMOKE_ADMIN_PASSWORD ??
  process.env.BOOTSTRAP_ADMIN_PASSWORD ??
  "ChangeMe123!";

async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, {
    ...options,
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      `${options.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`,
    );
  return body;
}

async function waitForApi() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const health = await request("/health");
      if (health.status === "ok") return health;
    } catch {
      // Compose services may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Express API did not become healthy within 60 seconds");
}

const health = await waitForApi();
const login = await request("/api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const auth = { authorization: `Bearer ${login.access_token}` };
const form = new FormData();
form.append(
  "file",
  new Blob(
    [new Uint8Array(fs.readFileSync("tests/fixtures/sample_invoice.xml"))],
    { type: "application/xml" },
  ),
  "sample_invoice.xml",
);

const invoice = await request("/api/v1/invoices", {
  method: "POST",
  headers: auth,
  body: form,
});
await request(`/api/v1/invoices/${invoice.id}/extract`, {
  method: "POST",
  headers: auth,
});
const validation = await request(`/api/v1/invoices/${invoice.id}/validate`, {
  method: "POST",
  headers: auth,
});
const reconciliation = await request(
  `/api/v1/invoices/${invoice.id}/reconcile`,
  { method: "POST", headers: auth },
);
const scoring = await request(`/api/v1/invoices/${invoice.id}/score`, {
  method: "POST",
  headers: { ...auth, "content-type": "application/json" },
  body: JSON.stringify({
    historical_mean: 1_000_000,
    historical_stddev: 100_000,
  }),
});
const evidence = await request(`/api/v1/invoices/${invoice.id}/evidence`, {
  headers: auth,
});
const legal = await request(
  `/api/v1/legal/search?q=${encodeURIComponent("hóa đơn điện tử")}&effective_on=2026-07-20&grounded_only=true`,
  { headers: auth },
);
const legalCorpus = await request("/api/v1/legal/corpus/status", {
  headers: auth,
});
const decision = await request(
  `/api/v1/reviews/${validation.review_id}/decisions`,
  {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      decision: "ACCEPTED",
      comment: "Automated smoke test: verified against the original document.",
    }),
  },
);
const audit = await request("/api/v1/audit/verify", { headers: auth });

if (!validation.review_id || !scoring.review_id)
  throw new Error("Human-review workflow was not created");
if (
  validation.decision?.status !== "REVIEW_REQUIRED" ||
  validation.decision?.is_legal_conclusion !== false
)
  throw new Error("Rule engine did not return a fail-safe decision summary");
if (!Array.isArray(evidence.alerts) || !Array.isArray(legal.results))
  throw new Error("Evidence or legal retrieval contract is invalid");
if (
  !legal.results.length ||
  legal.assessment?.status !== "EVIDENCE_FOUND" ||
  legal.assessment?.can_auto_decide !== false ||
  legal.results.some(
    (result) =>
      result.evidence_status !== "VERIFIED_PDF_TEXT" || !result.locator,
  ) ||
  !legalCorpus.checksum_enforced ||
  !legalCorpus.manifest_index_verified
)
  throw new Error("Legal retrieval returned ungrounded PDF evidence");
if (!audit.valid)
  throw new Error(`Audit chain failed: ${JSON.stringify(audit)}`);

console.log(
  JSON.stringify({
    runtime: health.service,
    invoice_id: invoice.id,
    upload_status: invoice.status,
    validation_status: validation.status,
    rule_decision_status: validation.decision.status,
    reconciliation_status: reconciliation.status,
    risk_level: scoring.risk.level,
    decision_status: decision.invoice_status,
    evidence_alerts: evidence.alerts.length,
    legal_results: legal.results.length,
    legal_documents_indexed: legalCorpus.documents_indexed,
    legal_checksum_enforced: legalCorpus.checksum_enforced,
    legal_manifest_index_verified: legalCorpus.manifest_index_verified,
    audit_events: audit.event_count,
    audit_valid: audit.valid,
  }),
);
