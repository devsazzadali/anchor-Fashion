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

// REG-65: the realtime channel surface is a no-op stub (the Supabase-style
// API the app's notification/chat hooks call). The stub never invokes the
// `on` callback and its subscribe only ever reports "SUBSCRIBED", so these
// annotations describe the call shapes the two in-repo consumers use
// (postgres_changes event name, filter object, payload callback) without
// changing what any of them does at runtime.
type DbRealtimeChannel = {
  on: (
    _event: string,
    _filter: Record<string, unknown>,
    _callback?: (payload: Record<string, unknown>) => void
  ) => { subscribe: () => { unsubscribe: () => void } };
  subscribe: (cb?: (status: string) => void) => { unsubscribe: () => void };
  unsubscribe: () => void;
};

export function createDbClient() {
  return {
    from: (table: string) => new DbQueryBuilder(table),
    rpc: callRpc,
    storage: dbStorage,
    auth: dbAuth,
    channel: (name: string): DbRealtimeChannel => ({
      on: (_event, _filter, _callback?) => ({
        subscribe: () => ({ unsubscribe: () => {} }),
      }),
      subscribe: (cb?) => {
        if (typeof cb === "function") cb("SUBSCRIBED");
        return { unsubscribe: () => {} };
      },
      unsubscribe: () => {},
    }),
    // Callers pass the subscription object (.on(...).subscribe()), not
    // the channel itself — see the support chat page and ticket thread.
    removeChannel: (_channel: { unsubscribe: () => void }) => {},
    getChannels: () => [],
  };
}

export function createAdminDbClient() {
  return createDbClient();
}

/** Shared singleton for modules that do not need their own client. */
export const db = createAdminDbClient();
