import pg from "pg";
const { Pool } = pg;
export const pool = new Pool({
  connectionString: (
    process.env.DATABASE_URL ??
    "postgresql://aicount:change_me@localhost:5432/aicount_guard"
  ).replace("postgresql+psycopg://", "postgresql://"),
  max: 20,
});
export type DbClient = pg.PoolClient;
export async function transaction<T>(
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
