import { createApp } from "./app.js";
import { migrateAndBootstrap } from "./migrate.js";
await migrateAndBootstrap();
const port = Number(process.env.PORT ?? 8000);
createApp().listen(port, "0.0.0.0", () =>
  console.log(
    JSON.stringify({
      service: "api-gateway",
      event: "started",
      port,
      runtime: "typescript-express",
    }),
  ),
);
