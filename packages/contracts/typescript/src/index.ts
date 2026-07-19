import { z } from "zod";

export const invoiceLineSchema = z.object({
  description: z.string().default(""),
  quantity: z.coerce.number().default(0),
  unit_price: z.coerce.number().default(0),
  amount_before_tax: z.coerce.number().default(0),
  tax_rate: z.coerce.number().nullable().optional(),
  tax_amount: z.coerce.number().default(0),
});

export const invoiceDataSchema = z.object({
  invoice_type: z.string().default("VAT_INVOICE"),
  invoice_number: z.string().nullable().optional(),
  invoice_symbol: z.string().nullable().optional(),
  invoice_date: z.iso.date().nullable().optional(),
  seller_name: z.string().nullable().optional(),
  seller_tax_code: z.string().nullable().optional(),
  buyer_name: z.string().nullable().optional(),
  buyer_tax_code: z.string().nullable().optional(),
  currency: z.string().default("VND"),
  subtotal: z.coerce.number().default(0),
  tax_amount: z.coerce.number().default(0),
  fees: z.coerce.number().default(0),
  discounts: z.coerce.number().default(0),
  total_amount: z.coerce.number().default(0),
  lines: z.array(invoiceLineSchema).default([]),
  extraction_confidence: z.coerce.number().min(0).max(1).default(0),
  raw_fields: z.record(z.string(), z.unknown()).default({}),
});

export type InvoiceData = z.infer<typeof invoiceDataSchema>;
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

export interface EvidenceItem {
  field: string;
  source: string;
  value?: unknown;
  confidence?: number;
}

export interface LegalCitation {
  document_id: string;
  locator: string;
  title?: string;
  effective_from?: string;
  review_status: "pending" | "reviewed";
}

export interface Alert {
  code: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  observed?: unknown;
  expected?: unknown;
  evidence: EvidenceItem[];
  rule_version?: string;
  legal_citations?: LegalCitation[];
  requires_human_review: boolean;
}

export interface Principal {
  user: {
    id: string;
    tenant_id: string;
    tenant_name?: string;
    email: string;
    full_name: string;
  };
  roles: string[];
  tenantId: string;
}

export interface StructuredError {
  code: string;
  message: string;
  correlation_id: string;
  details?: unknown;
}
