import express from "express";
import {
  asyncHandler,
  correlationMiddleware,
  errorHandler,
  healthRouter,
  internalOnly,
} from "@aicount/backend-common";
import { reconcileInvoice } from "./service.js";
const app = express();
app.use(
  correlationMiddleware,
  express.json({ limit: "2mb" }),
  healthRouter("reconciliation-service"),
);
app.post(
  "/v1/reconciliation/run",
  internalOnly,
  asyncHandler(async (req, res) => res.json(reconcileInvoice(req.body))),
);
app.use(errorHandler);
app.listen(Number(process.env.PORT ?? 8000), "0.0.0.0", () =>
  console.log(
    JSON.stringify({ service: "reconciliation-service", event: "started" }),
  ),
);
