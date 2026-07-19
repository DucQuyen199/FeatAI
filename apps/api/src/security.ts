import type { NextFunction, Request, RequestHandler, Response } from "express";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { HttpError, asyncHandler } from "@aicount/backend-common";
import type { Principal } from "@aicount/contracts";
import { pool } from "./database.js";
const secret = () =>
  process.env.JWT_SECRET ?? "dev-only-secret-change-before-production-1234";
export const hashPassword = (value: string) => argon2.hash(value);
export const verifyPassword = (hash: string, value: string) =>
  argon2.verify(hash, value);
export function signToken(
  user: { id: string; tenant_id: string },
  roles: string[],
) {
  return jwt.sign(
    { sub: user.id, tenant_id: user.tenant_id, roles },
    secret(),
    {
      algorithm: "HS256",
      expiresIn: Number(process.env.ACCESS_TOKEN_MINUTES ?? 30) * 60,
    },
  );
}
export async function rolesFor(userId: string) {
  const r = await pool.query(
    "SELECT roles.name FROM roles JOIN user_roles ON user_roles.role_id=roles.id WHERE user_roles.user_id=$1",
    [userId],
  );
  return r.rows.map((x) => String(x.name));
}
export const authenticate: RequestHandler = asyncHandler(
  async (req, _res, next) => {
    const token = req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) throw new HttpError(401, "Not authenticated", "UNAUTHORIZED");
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, secret(), {
        algorithms: ["HS256"],
      }) as jwt.JwtPayload;
    } catch {
      throw new HttpError(
        401,
        "Invalid or expired access token",
        "UNAUTHORIZED",
      );
    }
    const result = await pool.query(
      `SELECT users.id,users.tenant_id,users.email,users.full_name,
              users.is_active,tenants.name AS tenant_name
       FROM users JOIN tenants ON tenants.id=users.tenant_id
       WHERE users.id=$1`,
      [payload.sub],
    );
    const user = result.rows[0];
    if (!user || !user.is_active || user.tenant_id !== payload.tenant_id)
      throw new HttpError(401, "User is unavailable", "UNAUTHORIZED");
    const roles = await rolesFor(user.id);
    req.principal = { user, roles, tenantId: user.tenant_id } as Principal;
    next();
  },
);
export function requireRoles(...allowed: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.principal || !req.principal.roles.some((r) => allowed.includes(r)))
      return next(new HttpError(403, "Insufficient role", "FORBIDDEN"));
    next();
  };
}
