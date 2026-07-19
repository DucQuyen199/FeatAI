import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { pool, transaction } from "./database.js";
const here = path.dirname(fileURLToPath(import.meta.url));
function schemaPath() {
  for (const p of [
    path.resolve(here, "../src/schema.sql"),
    path.resolve(process.cwd(), "apps/api/src/schema.sql"),
  ])
    if (fs.existsSync(p)) return p;
  throw new Error("schema.sql not found");
}
export async function migrateAndBootstrap() {
  await pool.query(fs.readFileSync(schemaPath(), "utf8"));
  await transaction(async (c) => {
    const roles = [
      "accountant",
      "accountant_lead",
      "auditor",
      "system_admin",
      "ai_admin",
    ];
    for (const name of roles)
      await c.query(
        "INSERT INTO roles(id,name) VALUES($1,$2) ON CONFLICT(name) DO NOTHING",
        [randomUUID(), name],
      );
    const email = (
        process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@aicount.example.com"
      ).toLowerCase(),
      found = await c.query("SELECT id FROM users WHERE email=$1", [email]);
    if (!found.rowCount) {
      const tenantId = randomUUID(),
        userId = randomUUID();
      await c.query("INSERT INTO tenants(id,name) VALUES($1,$2)", [
        tenantId,
        "AICount Guard Demo",
      ]);
      await c.query(
        "INSERT INTO users(id,tenant_id,email,full_name,password_hash) VALUES($1,$2,$3,$4,$5)",
        [
          userId,
          tenantId,
          email,
          "Bootstrap Administrator",
          await argon2.hash(
            process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "ChangeMe123!",
          ),
        ],
      );
      for (const role of [
        "system_admin",
        "accountant_lead",
        "auditor",
        "ai_admin",
      ])
        await c.query(
          "INSERT INTO user_roles(id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE name=$3",
          [randomUUID(), userId, role],
        );
    }
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  migrateAndBootstrap()
    .then(() => pool.end())
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
