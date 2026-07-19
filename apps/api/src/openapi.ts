const route = (summary: string) => ({
  summary,
  responses: {
    "200": { description: "Successful response" },
    "401": { description: "Unauthorized" },
    "422": { description: "Validation error" },
  },
});
export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "AICount Guard API",
    version: "2.0.0",
    description:
      "Express.js/TypeScript human-approved invoice risk review gateway.",
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/health": { get: route("Health") },
    "/api/v1/auth/login": { post: { ...route("Login"), security: [] } },
    "/api/v1/auth/me": { get: route("Current user") },
    "/api/v1/users": { post: route("Create user") },
    "/api/v1/files": {
      get: route("List personal files"),
      post: route("Upload personal file"),
    },
    "/api/v1/files/{file_id}": {
      patch: route("Update personal file metadata"),
      delete: route("Delete personal file"),
    },
    "/api/v1/files/{file_id}/download": {
      get: route("Download personal file"),
    },
    "/api/v1/invoices": {
      get: route("List invoices"),
      post: route("Upload invoice"),
    },
    "/api/v1/invoices/{invoice_id}": { get: route("Invoice detail") },
    "/api/v1/invoices/{invoice_id}/extract": {
      post: route("Extraction result"),
    },
    "/api/v1/invoices/{invoice_id}/fields": { patch: route("Correct field") },
    "/api/v1/invoices/{invoice_id}/validate": { post: route("Validate") },
    "/api/v1/invoices/{invoice_id}/reconcile": { post: route("Reconcile") },
    "/api/v1/invoices/{invoice_id}/score": { post: route("Risk score") },
    "/api/v1/invoices/{invoice_id}/evidence": { get: route("Evidence") },
    "/api/v1/reviews": { get: route("Reviews") },
    "/api/v1/reviews/{review_id}/decisions": { post: route("Human decision") },
    "/api/v1/legal/search": { get: route("Legal search") },
    "/api/v1/legal/documents": { get: route("Legal document list") },
    "/api/v1/legal/documents/{document_id}": { get: route("Legal document") },
    "/api/v1/legal/documents/{document_id}/pdf": {
      get: route("Legal PDF preview"),
    },
    "/api/v1/legal/corpus/status": { get: route("Legal corpus status") },
    "/api/v1/audit/events": { get: route("Audit events") },
    "/api/v1/audit/verify": { get: route("Verify audit chain") },
  },
};
