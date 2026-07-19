import express from "express";
import {
  asyncHandler,
  correlationMiddleware,
  errorHandler,
  healthRouter,
  internalOnly,
} from "@aicount/backend-common";
import { scoreAnomaly } from "./service.js";
const app = express();
app.use(
  correlationMiddleware,
  express.json({ limit: "2mb" }),
  healthRouter("anomaly-service"),
);
app.post(
  "/v1/anomaly/score",
  internalOnly,
  asyncHandler(async (req, res) => res.json(scoreAnomaly(req.body))),
);
app.use(errorHandler);
app.listen(Number(process.env.PORT ?? 8000), "0.0.0.0", () =>
  console.log(JSON.stringify({ service: "anomaly-service", event: "started" })),
);
