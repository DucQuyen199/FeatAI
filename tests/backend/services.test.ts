import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  accountFileCategory,
  parseXml,
} from "../../services/document-service/src/service.js";
import {
  loadRules,
  validateRules,
} from "../../services/rule-engine/src/service.js";
import { scoreAnomaly } from "../../services/anomaly-service/src/service.js";
import {
  corpusStatus,
  listLegalDocuments,
  loadChunks,
  loadManifest,
  resolveLegalPdf,
  searchLegal,
  type LegalChunk,
  verifyCorpusIndex,
} from "../../services/legal-rag-service/src/service.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("TypeScript microservices", () => {
  it("classifies personal account files consistently across clients", () => {
    expect(accountFileCategory("application/pdf", "policy.pdf")).toBe(
      "document",
    );
    expect(accountFileCategory("text/csv", "ledger.csv")).toBe("spreadsheet");
    expect(accountFileCategory("application/xml", "invoice.xml")).toBe(
      "invoice",
    );
    expect(accountFileCategory("image/png", "receipt.png")).toBe("image");
  });

  it("extracts and normalizes a Vietnamese e-invoice XML", () => {
    const invoice = parseXml(
      Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
      <HDon><DLHDon><TTChung><SHDon>0000123</SHDon><KHHDon>1C26TAA</KHHDon><NLap>2026-07-19</NLap></TTChung>
      <NDHDon><NBan><Ten>Công ty Bán</Ten><MST>0101234567</MST></NBan><DSHHDVu><HHDVu><THHDVu>Dịch vụ</THHDVu><SLuong>2</SLuong><DGia>500</DGia><ThTien>1000</ThTien><TThue>100</TThue></HHDVu></DSHHDVu>
      <TToan><TgTCThue>1000</TgTCThue><TgTThue>100</TgTThue><TgTTTBSo>1100</TgTTTBSo><DVTTe>VND</DVTTe></TToan></NDHDon></DLHDon></HDon>`),
    );

    expect(invoice.invoice_number).toBe("0000123");
    expect(invoice.seller_tax_code).toBe("0101234567");
    expect(invoice.total_amount).toBe(1100);
    expect(invoice.lines[0]?.amount_before_tax).toBe(1000);
    expect(invoice.extraction_confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("detects arithmetic mismatch and blocks a draft ruleset from production", () => {
    process.env.RULE_ALLOW_DRAFT = "true";
    const config = loadRules(
      path.join(root, "config/rules/invoice_rules.example.yaml"),
    );
    const result = validateRules(
      {
        invoice: {
          invoice_number: "1",
          invoice_date: "2026-07-19",
          seller_tax_code: "0101234567",
          subtotal: 1000,
          tax_amount: 100,
          total_amount: 1500,
          lines: [
            {
              description: "Dịch vụ",
              amount_before_tax: 1000,
              tax_amount: 100,
            },
          ],
          extraction_confidence: 1,
        },
        correlation_id: "test",
      },
      config,
    ) as {
      alerts: { code: string; legal_citations?: { review_status: string }[] }[];
      ruleset_status: string;
      production_eligible: boolean;
      decision: {
        status: string;
        reason_code: string;
        is_legal_conclusion: boolean;
      };
    };

    expect(result.alerts.map((item) => item.code)).toContain(
      "ARITHMETIC_MISMATCH",
    );
    expect(result.ruleset_status).toBe("draft");
    expect(result.production_eligible).toBe(false);
    expect(result.decision.status).toBe("REVIEW_REQUIRED");
    expect(result.decision.reason_code).toBe("RULESET_NOT_APPROVED");
    expect(result.decision.is_legal_conclusion).toBe(false);
    expect(result.alerts.map((item) => item.code)).toContain(
      "TAX_RATE_ANOMALY",
    );
    expect(
      result.alerts
        .flatMap((item) => item.legal_citations ?? [])
        .every((citation) => citation.review_status === "pending"),
    ).toBe(true);
  });

  it("forces human review when extraction confidence is low", () => {
    const result = scoreAnomaly({
      invoice: { extraction_confidence: 0.2 },
      correlation_id: "test",
    });

    expect(result.requires_human_review).toBe(true);
    expect(result.alerts[0]?.code).toBe("MODEL_LOW_CONFIDENCE");
  });

  it("marks a not-yet-effective legal document as insufficient evidence", () => {
    const manifest = loadManifest(path.join(root, "legal/manifest.json"));
    const result = searchLegal("AI rủi ro cao", "2026-07-19", 50, manifest);
    const future = result.results.find(
      (item) => item.document_id === "VN-AI-33-2026-QDTTG",
    );

    expect(future?.effective_on_query_date).toBe(false);
    expect(future?.evidence_status).toBe("INSUFFICIENT_LEGAL_EVIDENCE");
  });

  it("returns only checksum-bound PDF text as grounded legal evidence", () => {
    const manifest = loadManifest(path.join(root, "legal/manifest.json"));
    const document = manifest.documents.find(
      (item) => item.id === "VN-AI-134-2025-QH15",
    )!;
    const text =
      "Điều 25. Hệ thống trí tuệ nhân tạo phải có biện pháp quản trị rủi ro và giám sát con người.";
    const chunk: LegalChunk = {
      chunk_id: `${document.id}::p0009::01`,
      document_id: document.id,
      number: document.number,
      title: document.title,
      effective_from: document.effective,
      status_at_snapshot: document.status,
      article: "Điều 25. Quản trị rủi ro",
      page_start: 9,
      page_end: 9,
      locator: "Trang 9 · Điều 25. Quản trị rủi ro",
      text,
      chunk_sha256: crypto.createHash("sha256").update(text).digest("hex"),
      extraction_method: "easyocr_vi_en",
      ocr_confidence: 0.91,
      source_page_url: document.page_url,
      source_pdf_url: document.pdf_url,
      source_sha256: document.sha256,
      snapshot_date: manifest.snapshot_date,
      review_status: "machine_extracted_pending_legal_review",
    };

    const result = searchLegal(
      "quan tri rui ro tri tue nhan tao",
      "2026-07-20",
      10,
      manifest,
      [chunk],
      { groundedOnly: true },
    );
    const grounded = result.results.find(
      (item) => item.document_id === document.id,
    );

    expect(grounded?.evidence_status).toBe("VERIFIED_PDF_TEXT");
    expect(grounded?.locator).toContain("Trang 9");
    expect(grounded?.chunk_sha256).toBe(chunk.chunk_sha256);
    expect(result.results.every((item) => item.chunk_id)).toBe(true);
    expect(result.assessment.status).toBe("EVIDENCE_FOUND");
    expect(result.assessment.can_auto_decide).toBe(false);
    expect(corpusStatus(manifest, [chunk]).checksum_enforced).toBe(true);
  });

  it("loads the generated corpus only when source and chunk hashes match", () => {
    const manifest = loadManifest(path.join(root, "legal/manifest.json"));
    const chunks = loadChunks(
      path.join(root, "legal/processed/legal_chunks.jsonl"),
      manifest,
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => chunk.locator.startsWith("Trang "))).toBe(
      true,
    );
    expect(corpusStatus(manifest, chunks).documents_indexed).toBeGreaterThan(0);
    expect(
      verifyCorpusIndex(
        path.join(root, "legal/manifest.json"),
        path.join(root, "legal/processed/legal_chunks.jsonl"),
        path.join(root, "legal/processed/corpus_index.json"),
      ).index.manifest_sha256,
    ).toMatch(/^[a-f0-9]{64}$/);
  });

  it("lists every legal document and resolves a checksum-bound PDF preview", () => {
    const manifest = loadManifest(path.join(root, "legal/manifest.json"));
    const chunks = loadChunks(
      path.join(root, "legal/processed/legal_chunks.jsonl"),
      manifest,
    );
    const catalog = listLegalDocuments(manifest, chunks);
    const first = catalog.items[0]!;
    const pdf = resolveLegalPdf(
      first.id,
      manifest,
      path.join(root, "legal/raw"),
    );

    expect(catalog.total).toBe(manifest.documents.length);
    expect(
      catalog.items.every((item) => item.preview_url.endsWith("/pdf")),
    ).toBe(true);
    expect(pdf && pdf.sha256).toBe(first.sha256);
    expect(pdf && pdf.size).toBe(first.size_bytes);
  });

  it("retrieves the new tax and electronic-signature sources from PDF text", () => {
    const manifest = loadManifest(path.join(root, "legal/manifest.json"));
    const chunks = loadChunks(
      path.join(root, "legal/processed/legal_chunks.jsonl"),
      manifest,
    );
    const corporateTax = searchLegal(
      "chi phí được trừ và chứng từ thanh toán",
      "2026-07-20",
      10,
      manifest,
      chunks,
      { groundedOnly: true, domain: "corporate_income_tax" },
    );
    const electronicSignature = searchLegal(
      "chữ ký điện tử và dịch vụ tin cậy",
      "2026-07-20",
      10,
      manifest,
      chunks,
      { groundedOnly: true, domain: "electronic_transactions" },
    );

    expect(corporateTax.assessment.status).toBe("EVIDENCE_FOUND");
    expect(
      corporateTax.results.some((item) =>
        ["VN-CIT-67-2025-QH15", "VN-CIT-320-2025-NDCP"].includes(
          item.document_id,
        ),
      ),
    ).toBe(true);
    expect(
      electronicSignature.results.some(
        (item) => item.document_id === "VN-ETR-23-2025-NDCP",
      ),
    ).toBe(true);
    expect(
      [...corporateTax.results, ...electronicSignature.results].every(
        (item) => item.locator && item.decision_eligible === false,
      ),
    ).toBe(true);
  });

  it("fails closed when extracted legal text is modified", () => {
    const manifest = loadManifest(path.join(root, "legal/manifest.json"));
    const source = path.join(root, "legal/processed/legal_chunks.jsonl");
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "aicount-legal-tamper-"),
    );
    const tampered = path.join(temporaryDirectory, "legal_chunks.jsonl");
    try {
      const lines = fs.readFileSync(source, "utf8").trimEnd().split(/\r?\n/);
      const first = JSON.parse(lines[0]!);
      first.text = `${first.text} nội dung bị thay đổi`;
      lines[0] = JSON.stringify(first);
      fs.writeFileSync(tampered, `${lines.join("\n")}\n`, "utf8");

      expect(() => loadChunks(tampered, manifest)).toThrow(
        /content hash mismatch/,
      );
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
