import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { InvoiceData, InvoiceLine } from "@aicount/contracts";
import { invoiceDataSchema } from "@aicount/contracts";
import { HttpError, numberValue } from "@aicount/backend-common";
import { XMLParser } from "fast-xml-parser";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const allowedExt = new Set([".xml", ".pdf", ".png", ".jpg", ".jpeg", ".webp"]),
  allowedTypes = new Set([
    "application/xml",
    "text/xml",
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);
const accountFileExtensions = new Set([
  ".xml",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".csv",
  ".txt",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".zip",
]);
const accountFileTypes = new Set([
  ...allowedTypes,
  "text/plain",
  "text/csv",
  "application/csv",
  "application/zip",
  "application/x-zip-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);
function collect(
  node: unknown,
  out: Record<string, string[]> = {},
): Record<string, string[]> {
  if (Array.isArray(node)) {
    node.forEach((x) => collect(x, out));
    return out;
  }
  if (node && typeof node === "object")
    for (const [key, value] of Object.entries(node)) {
      if (
        value !== null &&
        ["string", "number", "boolean"].includes(typeof value)
      )
        (out[key.toLowerCase()] ??= []).push(String(value));
      else collect(value, out);
    }
  return out;
}
function first(v: Record<string, string[]>, ...keys: string[]) {
  for (const key of keys) {
    const x = v[key.toLowerCase()]?.[0];
    if (x) return x;
  }
  return undefined;
}
function dateValue(v?: string) {
  if (!v) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}
function nodesByKey(
  node: unknown,
  keys: Set<string>,
  out: unknown[] = [],
): unknown[] {
  if (Array.isArray(node)) node.forEach((x) => nodesByKey(x, keys, out));
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node)) {
      if (keys.has(k.toLowerCase()))
        (Array.isArray(v) ? v : [v]).forEach((x) => out.push(x));
      nodesByKey(v, keys, out);
    }
  return out;
}
export function parseXml(content: Buffer): InvoiceData {
  let root: unknown;
  try {
    root = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
      trimValues: true,
    }).parse(content.toString("utf8"));
  } catch (error) {
    throw new HttpError(
      422,
      `Invalid XML: ${error instanceof Error ? error.message : String(error)}`,
      "VALIDATION_ERROR",
    );
  }
  const values = collect(root),
    lines: InvoiceLine[] = nodesByKey(
      root,
      new Set(["hhdvu", "lineitem", "invoiceitem", "item"]),
    ).map((node) => {
      const v = collect(node);
      return {
        description: first(v, "THHDVu", "description", "itemname") ?? "",
        quantity: numberValue(first(v, "SLuong", "quantity")),
        unit_price: numberValue(first(v, "DGia", "unitprice")),
        amount_before_tax: numberValue(
          first(v, "ThTien", "amountbeforetax", "linetotal"),
        ),
        tax_rate: first(v, "TSuat", "taxrate")
          ? numberValue(first(v, "TSuat", "taxrate"))
          : null,
        tax_amount: numberValue(first(v, "TThue", "taxamount")),
      };
    });
  const required = [
    first(values, "SHDon", "invoicenumber"),
    first(values, "NLap", "invoicedate"),
    first(values, "MST", "sellertaxcode"),
    first(values, "TgTCThue", "subtotal"),
    first(values, "TgTThue", "taxamount"),
    first(values, "TgTTTBSo", "totalamount", "tgttoan"),
  ];
  return invoiceDataSchema.parse({
    invoice_type: first(values, "KHMSHDon", "invoicetype") ?? "VAT_INVOICE",
    invoice_number: first(values, "SHDon", "invoicenumber"),
    invoice_symbol: first(values, "KHHDon", "invoicesymbol"),
    invoice_date: dateValue(first(values, "NLap", "invoicedate")),
    seller_name: first(values, "NBan", "sellername", "ten"),
    seller_tax_code: first(values, "MST", "sellertaxcode"),
    buyer_name: first(values, "NMua", "buyername", "HVTNMHang"),
    buyer_tax_code: first(values, "MSTNMua", "buyertaxcode"),
    currency: first(values, "DVTTe", "currency") ?? "VND",
    subtotal: numberValue(first(values, "TgTCThue", "subtotal")),
    tax_amount: numberValue(first(values, "TgTThue", "taxamount")),
    total_amount: numberValue(
      first(values, "TgTTTBSo", "totalamount", "tgttoan"),
    ),
    lines,
    extraction_confidence: +(
      required.filter(Boolean).length / required.length
    ).toFixed(3),
    raw_fields: Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v[0]]),
    ),
  });
}
function textValue(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]?.trim();
}
export async function parsePdf(content: Buffer): Promise<InvoiceData> {
  try {
    const pdf = await getDocument({
      data: new Uint8Array(content),
      useWorkerFetch: false,
      useSystemFonts: true,
    }).promise;
    const parts: string[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
      const page = await pdf.getPage(i),
        data = await page.getTextContent();
      parts.push(
        data.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
    }
    const text = parts.join("\n");
    if (text.trim().length < 40)
      return invoiceDataSchema.parse({
        extraction_confidence: 0,
        raw_fields: { needs_ocr: true },
      });
    const invoice_number = textValue(
        text,
        /(?:số|invoice\s*no\.?)\s*[:#]?\s*([A-Z0-9/-]+)/i,
      ),
      seller_tax_code = textValue(
        text,
        /(?:mã\s*số\s*thuế|tax\s*code)\s*:\s*([0-9-]{10,14})/i,
      ),
      total = textValue(
        text,
        /(?:tổng\s*(?:cộng|thanh\s*toán)|total)[^\d]*([\d.,]+)/i,
      );
    return invoiceDataSchema.parse({
      invoice_number,
      seller_tax_code,
      total_amount: numberValue(total),
      extraction_confidence: +(
        ([invoice_number, seller_tax_code, total].filter(Boolean).length / 3) *
        0.8
      ).toFixed(3),
      raw_fields: { text_length: text.length, needs_ocr: false },
    });
  } catch (error) {
    throw new HttpError(
      422,
      `Unreadable PDF: ${error instanceof Error ? error.message : String(error)}`,
      "VALIDATION_ERROR",
    );
  }
}
export function validateUpload(file: Express.Multer.File) {
  const ext = path.extname(path.basename(file.originalname)).toLowerCase(),
    max = Number(process.env.MAX_UPLOAD_BYTES ?? 20 * 1024 * 1024);
  if (!allowedExt.has(ext) || !allowedTypes.has(file.mimetype))
    throw new HttpError(
      415,
      "Only XML, PDF, PNG, JPEG and WebP are accepted",
      "UNSUPPORTED_MEDIA_TYPE",
    );
  if (!file.buffer.length || file.buffer.length > max)
    throw new HttpError(
      413,
      "File is empty or exceeds configured upload limit",
      "UPLOAD_TOO_LARGE",
    );
  if (
    file.buffer
      .subarray(0, 8192)
      .toString()
      .toLowerCase()
      .includes("<script") ||
    file.buffer.subarray(0, 2).toString() === "MZ"
  )
    throw new HttpError(
      422,
      "File failed content safety checks",
      "VALIDATION_ERROR",
    );
  return path.basename(file.originalname);
}
function s3() {
  return new S3Client({
    endpoint: process.env.MINIO_ENDPOINT ?? "http://minio:9000",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? "",
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? "",
    },
  });
}
async function ensureBucket(client: S3Client, bucket: string) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}
export function accountFileCategory(contentType: string, filename: string) {
  const ext = path.extname(filename).toLowerCase();
  if (contentType.startsWith("image/")) return "image";
  if ([".csv", ".xls", ".xlsx"].includes(ext)) return "spreadsheet";
  if ([".doc", ".docx", ".txt", ".pdf"].includes(ext)) return "document";
  if (ext === ".xml") return "invoice";
  if (ext === ".zip") return "archive";
  return "other";
}
function validateAccountFile(file: Express.Multer.File) {
  const safe = path.basename(file.originalname).replace(/[\\/:*?"<>|]/g, "_");
  const ext = path.extname(safe).toLowerCase();
  const max = Number(process.env.ACCOUNT_FILE_MAX_BYTES ?? 25 * 1024 * 1024);
  if (!accountFileExtensions.has(ext) || !accountFileTypes.has(file.mimetype))
    throw new HttpError(
      415,
      "Unsupported account file type",
      "UNSUPPORTED_MEDIA_TYPE",
    );
  if (!file.buffer.length || file.buffer.length > max)
    throw new HttpError(
      413,
      "File is empty or exceeds the account file limit",
      "UPLOAD_TOO_LARGE",
    );
  if (file.buffer.subarray(0, 2).toString() === "MZ")
    throw new HttpError(
      422,
      "Executable files are not accepted",
      "VALIDATION_ERROR",
    );
  return safe.slice(0, 500);
}
function assertAccountStorageKey(
  storageKey: string,
  tenantId: string,
  userId: string,
) {
  if (!storageKey.startsWith(`${tenantId}/accounts/${userId}/`))
    throw new HttpError(
      403,
      "File does not belong to this account",
      "FORBIDDEN",
    );
}
export async function storeAccountFile(
  file: Express.Multer.File,
  tenantId: string,
  userId: string,
) {
  const filename = validateAccountFile(file);
  const id = randomUUID();
  const storageKey = `${tenantId}/accounts/${userId}/${id}/${filename}`;
  const bucket = process.env.MINIO_BUCKET ?? "aicount-documents";
  const client = s3();
  await ensureBucket(client, bucket);
  const sha256 = createHash("sha256").update(file.buffer).digest("hex");
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: file.buffer,
      ContentType: file.mimetype,
      Metadata: { sha256, owner: userId },
      ...(process.env.S3_SSE_ENABLED === "true"
        ? { ServerSideEncryption: "AES256" as const }
        : {}),
    }),
  );
  return {
    id,
    filename,
    storage_key: storageKey,
    sha256,
    content_type: file.mimetype,
    size_bytes: file.size,
    category: accountFileCategory(file.mimetype, filename),
  };
}
export async function readAccountFile(
  storageKey: string,
  tenantId: string,
  userId: string,
) {
  assertAccountStorageKey(storageKey, tenantId, userId);
  const response = await s3().send(
    new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET ?? "aicount-documents",
      Key: storageKey,
    }),
  );
  return {
    body: Buffer.from(await response.Body!.transformToByteArray()),
    contentType: response.ContentType ?? "application/octet-stream",
  };
}
export async function removeAccountFile(
  storageKey: string,
  tenantId: string,
  userId: string,
) {
  assertAccountStorageKey(storageKey, tenantId, userId);
  await s3().send(
    new DeleteObjectCommand({
      Bucket: process.env.MINIO_BUCKET ?? "aicount-documents",
      Key: storageKey,
    }),
  );
}
export async function extractDocument(
  file: Express.Multer.File,
  tenantId: string,
  correlationId: string,
) {
  const safe = validateUpload(file),
    documentId = randomUUID(),
    storageKey = `${tenantId}/${documentId}/${safe}`,
    bucket = process.env.MINIO_BUCKET ?? "aicount-documents",
    client = s3();
  await ensureBucket(client, bucket);
  const sha256 = createHash("sha256").update(file.buffer).digest("hex");
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: file.buffer,
      ContentType: file.mimetype,
      Metadata: { sha256 },
      ...(process.env.S3_SSE_ENABLED === "true"
        ? { ServerSideEncryption: "AES256" }
        : {}),
    }),
  );
  const ext = path.extname(safe).toLowerCase();
  let invoice: InvoiceData, parserVersion: string;
  if (ext === ".xml") {
    invoice = parseXml(file.buffer);
    parserVersion = "vn-xml-parser@2.0.0";
  } else if (ext === ".pdf") {
    invoice = await parsePdf(file.buffer);
    parserVersion = "pdf-text-parser@2.0.0";
  } else {
    invoice = invoiceDataSchema.parse({
      extraction_confidence: 0,
      raw_fields: { needs_ocr: true },
    });
    parserVersion = "image-ocr-pending@2.0.0";
  }
  return {
    document_id: documentId,
    filename: safe,
    content_type: file.mimetype,
    size_bytes: file.buffer.length,
    sha256,
    storage_key: storageKey,
    parser_version: parserVersion,
    correlation_id: correlationId,
    invoice,
  };
}
