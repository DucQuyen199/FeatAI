import { createHash, randomUUID } from "node:crypto";
import { stableStringify } from "@aicount/backend-common";
import type { Principal } from "@aicount/contracts";
import type { DbClient } from "./database.js";
export async function appendAudit(
  c: DbClient,
  p: Principal,
  action: string,
  resourceType: string,
  resourceId: string,
  payload: unknown,
  correlationId: string,
) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [p.tenantId]);
  const prev = (
      await c.query(
        "SELECT sequence,event_hash FROM audit_events WHERE tenant_id=$1 ORDER BY sequence DESC LIMIT 1",
        [p.tenantId],
      )
    ).rows[0],
    sequence = prev ? Number(prev.sequence) + 1 : 1,
    previous_hash = prev?.event_hash ?? "0".repeat(64),
    canonical = stableStringify({
      sequence,
      tenant: p.tenantId,
      actor: p.user.id,
      action,
      resource: resourceId,
      payload,
      previous_hash,
    }),
    event_hash = createHash("sha256").update(canonical).digest("hex"),
    id = randomUUID();
  await c.query(
    "INSERT INTO audit_events(id,sequence,tenant_id,actor_id,action,resource_type,resource_id,payload,previous_hash,event_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      id,
      sequence,
      p.tenantId,
      p.user.id,
      action,
      resourceType,
      resourceId,
      JSON.stringify(payload),
      previous_hash,
      event_hash,
      correlationId,
    ],
  );
  return { id, sequence, previous_hash, event_hash };
}
