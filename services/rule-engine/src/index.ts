import express from "express";
import {
  asyncHandler,
  correlationMiddleware,
  errorHandler,
  healthRouter,
  internalOnly,
} from "@aicount/backend-common";
import { validateRules } from "./service.js";
const app = express();
app.use(
  correlationMiddleware,
  express.json({ limit: "2mb" }),
  healthRouter("rule-engine"),
);
app.post(
  "/v1/rules/validate",
  internalOnly,
  asyncHandler(async (req, res) => {
    res.json(validateRules(req.body));
  }),
);
app.use(errorHandler);
app.listen(Number(process.env.PORT ?? 8000), "0.0.0.0", () =>
  console.log(JSON.stringify({ service: "rule-engine", event: "started" })),
);
