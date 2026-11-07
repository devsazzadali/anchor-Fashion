/**
 * Native data-layer client (lib/db).
 *
 * Single entry point for database access across the app:
 *   const db = createDbClient();
 *   const { data, error } = await db.from("orders").select("*").eq("id", id);
 *
 * - `from(table)` → fluent Prisma-backed query builder (lib/db/query)
 * - `rpc(fn, args)` → PostgreSQL function calls (lib/db/rpc)
 * - `storage` → local uploads storage (lib/db/storage)
 * - `auth` → Neon Auth session/profile surface (lib/db/auth)
 *
 * There is no behavioural difference between the standard and admin
 * clients today (authorization is enforced by the auth layer and route
 * guards, not by the data client); both factories are kept so call sites
 * can express intent.
 */
import { DbQueryBuilder } from "./query";
import { callRpc } from "./rpc";
import { dbStorage } from "./storage";
import { dbAuth } from "./auth";

export function createDbClient() {
  return {
    from: (table: string) => new DbQueryBuilder(table),
    rpc: callRpc,
    storage: dbStorage,
    auth: dbAuth,
    channel: (name: string) => ({
      on: (_event: any, _filter: any, _callback?: any) => ({
        subscribe: () => ({ unsubscribe: () => {} }),
      }),
      subscribe: (cb?: any) => {
        if (typeof cb === "function") cb("SUBSCRIBED");
        return { unsubscribe: () => {} };
      },
      unsubscribe: () => {},
    }),
    removeChannel: (_channel: any) => {},
    getChannels: () => [],
  };
}

export function createAdminDbClient() {
  return createDbClient();
}

/** Shared singleton for modules that do not need their own client. */
export const db = createAdminDbClient();
