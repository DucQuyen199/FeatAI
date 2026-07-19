import fs from "node:fs";
import type { Alert, InvoiceData, LegalCitation } from "@aicount/contracts";
import { invoiceDataSchema } from "@aicount/contracts";
import { HttpError, numberValue } from "@aicount/backend-common";
import YAML from "yaml";
import { z } from "zod";

const requestSchema = z.object({
  invoice: invoiceDataSchema,
  duplicate: z.boolean().default(false),
  correlation_id: z.string(),
  legal_rate_supported: z.boolean().nullable().optional(),
});
type Rule = {
  id: string;
  version: string;
  status: string;
  description: string;
  severity: Alert["severity"];
  tolerance_vnd?: number;
  required_fields?: string[];
  failure_code: string;
  requires_human_review?: boolean;
  legal_basis?: {
    document_id: string;
    locator: string;
    review_status?: LegalCitation["review_status"];
  }[];
};
type RuleConfig = {
  ruleset: {
    id: string;
    version: string;
    status: string;
    legal_snapshot: string;
  };
  rules: Rule[];
};

export function loadRules(
  path = process.env.RULES_PATH ??
    "/app/config/rules/invoice_rules.example.yaml",
): RuleConfig {
  return YAML.parse(fs.readFileSync(path, "utf8")) as RuleConfig;
}

function citations(rule: Rule): LegalCitation[] {
  return (rule.legal_basis ?? []).map((item) => ({
    document_id: item.document_id,
    locator: item.locator,
    review_status:
      item.review_status ??
      (rule.status === "approved" ? "reviewed" : "pending"),
  }));
}

function buildDecision(
  config: RuleConfig,
  invoice: InvoiceData,
  alerts: Alert[],
  passed: string[],
) {
  const pendingCitations = alerts
    .flatMap((alert) => alert.legal_citations ?? [])
    .filter((citation) => citation.review_status !== "reviewed").length;
  const severeAlerts = alerts.filter((alert) =>
    ["high", "critical"].includes(alert.severity),
  );
  const extractionReliable = invoice.extraction_confidence >= 0.8;
  const productionEligible = config.ruleset.status === "approved";
  const legalEvidenceComplete = pendingCitations === 0;

  let reasonCode = "TECHNICAL_CHECKS_PASSED";
  let status = "PASS_TECHNICAL_CHECKS";
  let label = "Đạt các kiểm tra kỹ thuật đã cấu hình";
  let autoAction = "CONTINUE_WORKFLOW";

  if (!productionEligible) {
    reasonCode = "RULESET_NOT_APPROVED";
    status = "REVIEW_REQUIRED";
    label = "Cần duyệt: bộ quy tắc pháp lý chưa được phê duyệt";
    autoAction = "HOLD_FOR_REVIEW";
  } else if (!extractionReliable) {
    reasonCode = "LOW_EXTRACTION_CONFIDENCE";
    status = "REVIEW_REQUIRED";
    label = "Cần duyệt: độ tin cậy trích xuất thấp";
    autoAction = "HOLD_FOR_REVIEW";
  } else if (severeAlerts.length) {
    reasonCode = "HIGH_SEVERITY_FINDINGS";
    status = "REVIEW_REQUIRED";
    label = "Cần duyệt: có sai lệch mức cao";
    autoAction = "HOLD_FOR_REVIEW";
  } else if (alerts.length || !legalEvidenceComplete) {
    reasonCode = "FINDINGS_OR_EVIDENCE_GAPS";
    status = "REVIEW_REQUIRED";
    label = "Cần duyệt: còn cảnh báo hoặc thiếu căn cứ đã duyệt";
    autoAction = "HOLD_FOR_REVIEW";
  }

  return {
    status,
    label,
    reason_code: reasonCode,
    auto_action: autoAction,
    is_legal_conclusion: false,
    confidence_score: Math.round(
      Math.min(
        invoice.extraction_confidence * 100,
        productionEligible ? 100 : 60,
        legalEvidenceComplete ? 100 : 70,
      ),
    ),
    evidence_summary: {
      evaluated_rules: config.rules.length,
      passed_rules: passed.length,
      findings: alerts.length,
      high_or_critical_findings: severeAlerts.length,
      pending_legal_citations: pendingCitations,
      extraction_reliable: extractionReliable,
      ruleset_approved: productionEligible,
    },
    reasons: alerts.map((alert) => ({
      code: alert.code,
      severity: alert.severity,
      message: alert.message,
    })),
  };
}

function finding(
  rule: Rule,
  message: string,
  observed: unknown,
  expected: unknown,
  fields: string[],
): Alert {
  return {
    code: rule.failure_code,
    severity: rule.severity,
    message,
    observed,
    expected,
    evidence: fields.map((field) => ({ field, source: "normalized_invoice" })),
    rule_version: `${rule.id}@${rule.version}`,
    legal_citations: citations(rule),
    requires_human_review: rule.requires_human_review ?? true,
  };
}

export function validateRules(
  raw: unknown,
  config = loadRules(),
): Record<string, unknown> {
  const payload = requestSchema.parse(raw);
  const allowDraft =
    (process.env.RULE_ALLOW_DRAFT ?? "false").toLowerCase() === "true";
  if (config.ruleset.status !== "approved" && !allowDraft)
    throw new HttpError(
      409,
      "Rule set is not legally approved for production",
      "CONFLICT",
    );
  const invoice: InvoiceData = payload.invoice;
  const alerts: Alert[] = [];
  const passed: string[] = [];
  for (const rule of config.rules) {
    const tolerance = rule.tolerance_vnd ?? 1;
    let alert: Alert | undefined;
    if (rule.id === "INV_REQUIRED_FIELDS") {
      const missing = (rule.required_fields ?? []).filter(
        (name) => !invoice[name as keyof InvoiceData],
      );
      if (missing.length)
        alert = finding(
          rule,
          "Thiếu trường nhận dạng bắt buộc; cần người dùng xác nhận.",
          missing,
          "non-empty",
          missing,
        );
    } else if (
      rule.id === "INV_SUBTOTAL_EQUALS_LINE_SUM" &&
      invoice.lines.length
    ) {
      const expected = invoice.lines.reduce(
        (sum, line) => sum + numberValue(line.amount_before_tax),
        0,
      );
      if (Math.abs(invoice.subtotal - expected) > tolerance)
        alert = finding(
          rule,
          "Tổng trước thuế không khớp tổng các dòng hàng.",
          invoice.subtotal,
          expected,
          ["subtotal", "lines.amount_before_tax"],
        );
    } else if (rule.id === "INV_TAX_EQUALS_LINE_TAX" && invoice.lines.length) {
      const expected = invoice.lines.reduce(
        (sum, line) => sum + numberValue(line.tax_amount),
        0,
      );
      if (Math.abs(invoice.tax_amount - expected) > tolerance)
        alert = finding(
          rule,
          "Tiền thuế không khớp tổng thuế các dòng hàng.",
          invoice.tax_amount,
          expected,
          ["tax_amount", "lines.tax_amount"],
        );
    } else if (rule.id === "INV_TOTAL_ARITHMETIC") {
      const expected =
        invoice.subtotal +
        invoice.tax_amount +
        invoice.fees -
        invoice.discounts;
      if (Math.abs(invoice.total_amount - expected) > tolerance)
        alert = finding(
          rule,
          "Tổng thanh toán không khớp phép tính hóa đơn.",
          invoice.total_amount,
          expected,
          ["total_amount", "subtotal", "tax_amount", "fees", "discounts"],
        );
    } else if (rule.id === "INV_DUPLICATE_IDENTITY" && payload.duplicate) {
      alert = finding(
        rule,
        "Phát hiện khóa hóa đơn trùng; cảnh báo này không phải kết luận gian lận.",
        true,
        false,
        ["seller_tax_code", "invoice_symbol", "invoice_number"],
      );
    } else if (
      rule.id === "VAT_RATE_REFERENCE_REQUIRED" &&
      payload.legal_rate_supported !== true
    ) {
      alert = finding(
        rule,
        payload.legal_rate_supported === false
          ? "INSUFFICIENT_LEGAL_EVIDENCE: chưa đủ căn cứ đã duyệt cho thuế suất."
          : "LEGAL_EVIDENCE_NOT_EVALUATED: chưa đối chiếu thuế suất theo hàng hóa, ngày hiệu lực và ngoại lệ.",
        payload.legal_rate_supported === false
          ? "unsupported"
          : "not_evaluated",
        "reviewed legal basis",
        ["invoice_date", "lines.tax_rate"],
      );
    }
    if (alert) alerts.push(alert);
    else passed.push(rule.id);
  }
  const weights = { low: 10, medium: 25, high: 40, critical: 60 };
  return {
    ruleset: `${config.ruleset.id}@${config.ruleset.version}`,
    ruleset_status: config.ruleset.status,
    legal_snapshot: config.ruleset.legal_snapshot,
    production_eligible: config.ruleset.status === "approved",
    passed_rules: passed,
    alerts,
    decision: buildDecision(config, invoice, alerts, passed),
    rule_score: Math.min(
      100,
      alerts.reduce((sum, item) => sum + weights[item.severity], 0),
    ),
    correlation_id: payload.correlation_id,
  };
}
