import type { Alert } from "@aicount/contracts";
import { invoiceDataSchema } from "@aicount/contracts";
import { z } from "zod";
const schema = z.object({
  invoice: invoiceDataSchema,
  historical_mean: z.coerce.number().min(0).nullable().optional(),
  historical_stddev: z.coerce.number().positive().nullable().optional(),
  correlation_id: z.string(),
});
export function scoreAnomaly(raw: unknown) {
  const p = schema.parse(raw),
    confidencePenalty = Math.max(0, 1 - p.invoice.extraction_confidence);
  const zScore =
    p.historical_mean != null && p.historical_stddev
      ? Math.abs(p.invoice.total_amount - p.historical_mean) /
        p.historical_stddev
      : null;
  const factors = {
    extraction_uncertainty: +(confidencePenalty * 45).toFixed(3),
    amount_z_score: zScore === null ? 0 : +Math.min(40, zScore * 8).toFixed(3),
    round_amount:
      p.invoice.total_amount && p.invoice.total_amount % 1_000_000 === 0
        ? 8
        : 0,
  };
  const alerts: Alert[] = [];
  if (p.invoice.extraction_confidence < 0.75)
    alerts.push({
      code: "MODEL_LOW_CONFIDENCE",
      severity: "high",
      message:
        "Độ tin cậy trích xuất thấp; bắt buộc người dùng kiểm tra dữ liệu gốc.",
      observed: p.invoice.extraction_confidence,
      expected: ">= 0.75",
      evidence: [
        {
          field: "extraction_confidence",
          source: "document-service",
          value: p.invoice.extraction_confidence,
        },
      ],
      rule_version: "explainable-baseline@2.0.0",
      requires_human_review: true,
    });
  if (zScore !== null && zScore >= 3)
    alerts.push({
      code: "AMOUNT_ANOMALY",
      severity: "medium",
      message:
        "Giá trị hóa đơn khác biệt đáng kể so với lịch sử được cung cấp.",
      observed: +zScore.toFixed(3),
      expected: "z-score < 3",
      evidence: [{ field: "total_amount", source: "normalized_invoice" }],
      rule_version: "explainable-baseline@2.0.0",
      requires_human_review: true,
    });
  return {
    model_version: "explainable-baseline@2.0.0",
    model_type: "deterministic explainable baseline",
    anomaly_score: +Math.min(
      100,
      Object.values(factors).reduce((a, b) => a + b, 0),
    ).toFixed(3),
    factors,
    alerts,
    requires_human_review: alerts.length > 0,
    correlation_id: p.correlation_id,
  };
}
