import type { Alert } from "@aicount/contracts";
import { invoiceDataSchema } from "@aicount/contracts";
import { numberValue } from "@aicount/backend-common";
import { z } from "zod";
const doc = z.object({
  reference: z.string(),
  total_amount: z.coerce.number().default(0),
  quantity: z.coerce.number().nullable().optional(),
});
const schema = z.object({
  invoice: invoiceDataSchema,
  purchase_order: doc.nullable().optional(),
  goods_receipt: doc.nullable().optional(),
  payment: doc.nullable().optional(),
  amount_tolerance: z.coerce.number().min(0).default(1),
  correlation_id: z.string(),
});
export function reconcileInvoice(raw: unknown) {
  const p = schema.parse(raw);
  const alerts: Alert[] = [];
  const missing = ["purchase_order", "goods_receipt"].filter(
    (name) => !p[name as "purchase_order" | "goods_receipt"],
  );
  if (missing.length)
    alerts.push({
      code: "RECONCILIATION_MISSING_DOCUMENT",
      severity: "medium",
      message: "Thiếu chứng từ đối chiếu; cần bổ sung hoặc xác nhận ngoại lệ.",
      observed: missing,
      expected: ["purchase_order", "goods_receipt"],
      evidence: missing.map((field) => ({
        field,
        source: "reconciliation_input",
      })),
      rule_version: "three-way-match@2.0.0",
      requires_human_review: true,
    });
  for (const name of ["purchase_order", "payment"] as const) {
    const d = p[name];
    if (
      d &&
      Math.abs(p.invoice.total_amount - numberValue(d.total_amount)) >
        p.amount_tolerance
    )
      alerts.push({
        code: "THREE_WAY_MATCH_VARIANCE",
        severity: "high",
        message: `Giá trị hóa đơn chênh lệch với ${name}; chưa phải kết luận vi phạm.`,
        observed: p.invoice.total_amount,
        expected: d.total_amount,
        evidence: [
          { field: "total_amount", source: "normalized_invoice" },
          { field: "total_amount", source: `${name}:${d.reference}` },
        ],
        rule_version: "three-way-match@2.0.0",
        requires_human_review: true,
      });
  }
  return {
    status: alerts.length ? "needs_review" : "matched",
    alerts,
    reconciliation_score: Math.min(
      100,
      alerts.reduce((s, a) => s + (a.severity === "high" ? 35 : 15), 0),
    ),
    correlation_id: p.correlation_id,
  };
}
