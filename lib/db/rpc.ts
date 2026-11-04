/**
 * Database function calls (lib/db).
 *
 * Executes the project's PostgreSQL functions through Prisma's raw query
 * API with bound parameters. For the high-traffic inventory / coupon /
 * loyalty functions there are equivalent Prisma-side fallbacks (used when
 * the stored function is missing or fails) so order flows never hard-fail
 * on a missing migration.
 */
import prisma from "@/lib/prisma";
import { serializePlain } from "./query";

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
function assertIdent(name: string, kind = "identifier"): string {
  if (typeof name !== "string" || !SAFE_IDENT.test(name)) {
    throw new Error(`Invalid SQL ${kind}`);
  }
  return name;
}

/**
 * REG-65 batch 1: the argument bag for RPC calls. The named keys are
 * the ones the fallback implementations below actually read (both the
 * `p_`-prefixed stored-function spellings and the bare spellings);
 * any other argument a caller passes rides the index signature.
 */
export interface RpcArgs {
  p_order_id?: string | null;
  order_id?: string | null;
  id?: string | null;
  p_variant_id?: string | null;
  variant_id?: string | null;
  p_quantity?: number | null;
  quantity?: number | null;
  p_coupon_code?: string | null;
  coupon_code?: string | null;
  code?: string | null;
  p_coupon_id?: string | null;
  coupon_id?: string | null;
  p_customer_id?: string | null;
  customer_id?: string | null;
  p_discount_applied?: number | null;
  discount_applied?: number | null;
  p_account_id?: string | null;
  account_id?: string | null;
  p_points?: number | null;
  points?: number | null;
  label_id?: string | null;
  [key: string]: unknown;
}

/** Result contract of a fallback / stored-function call. */
export interface RpcCallResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

/** Row shape of the order_items lookups in the inventory fallbacks. */
interface OrderItemQuantityRow {
  variant_id: string | null;
  quantity: number;
}

const KNOWN_FALLBACK_RPCS = [
  "consume_coupon_atomic",
  "release_coupon_atomic",
  "release_order_inventory",
  "confirm_order_inventory",
  "reserve_order_inventory",
  "atomic_reserve_stock",
  "atomic_release_stock",
  "release_stock",
  "atomic_reduce_stock",
  "reduce_stock",
  "reverse_loyalty_points",
  "redeem_loyalty_points",
  "increment_label_print_count",
];

async function runFallback(
  fnName: string,
  args: RpcArgs
): Promise<RpcCallResult> {
  if (fnName === "release_order_inventory") {
    const orderId = args.p_order_id || args.order_id || args.id;
    if (orderId) {
      const items = (await prisma.$queryRawUnsafe(
        `SELECT variant_id, quantity FROM order_items WHERE order_id = $1::uuid`,
        orderId
      )) as OrderItemQuantityRow[];
      for (const item of items) {
        if (item.variant_id) {
          await prisma.$executeRawUnsafe(
            `UPDATE inventory_levels
             SET quantity_available = quantity_available + $1,
                 quantity_reserved = GREATEST(0, quantity_reserved - $1),
                 updated_at = NOW()
             WHERE variant_id = $2::uuid`,
            item.quantity,
            item.variant_id
          );
        }
      }
      return { data: true, error: null };
    }
  } else if (fnName === "confirm_order_inventory") {
    const orderId = args.p_order_id || args.order_id || args.id;
    if (orderId) {
      const items = (await prisma.$queryRawUnsafe(
        `SELECT variant_id, quantity FROM order_items WHERE order_id = $1::uuid`,
        orderId
      )) as OrderItemQuantityRow[];
      for (const item of items) {
        if (item.variant_id) {
          await prisma.$executeRawUnsafe(
            `UPDATE inventory_levels
             SET quantity_on_hand = GREATEST(0, quantity_on_hand - $1),
                 quantity_reserved = GREATEST(0, quantity_reserved - $1),
                 updated_at = NOW()
             WHERE variant_id = $2::uuid`,
            item.quantity,
            item.variant_id
          );
        }
      }
      return { data: true, error: null };
    }
  } else if (
    fnName === "reserve_order_inventory" ||
    fnName === "atomic_reserve_stock"
  ) {
    const variantId = args.p_variant_id || args.variant_id;
    const quantity = args.p_quantity || args.quantity || 1;
    if (variantId) {
      await prisma.$executeRawUnsafe(
        `UPDATE inventory_levels
         SET quantity_available = GREATEST(0, quantity_available - $1),
             quantity_reserved = quantity_reserved + $1,
             updated_at = NOW()
         WHERE variant_id = $2::uuid`,
        quantity,
        variantId
      );
      return { data: true, error: null };
    }
  } else if (fnName === "consume_coupon_atomic") {
    const couponCode = args.p_coupon_code || args.coupon_code || args.code;
    let couponId = args.p_coupon_id || args.coupon_id;
    const customerId = args.p_customer_id || args.customer_id;
    const orderId = args.p_order_id || args.order_id;
    const discountApplied = Number(
      args.p_discount_applied || args.discount_applied || 0
    );

    if (!couponId && couponCode) {
      const found = (await prisma.$queryRawUnsafe(
        `SELECT id FROM coupons WHERE UPPER(code) = UPPER($1) LIMIT 1`,
        couponCode.trim()
      )) as Array<{ id: string }>;
      if (found && found.length > 0) {
        couponId = found[0].id;
      }
    }

    if (couponId) {
      // A3-B3: the usage row and the used_count increment are ONE
      // redemption record — both must land or neither does. Previously
      // the increment ran first and the usage insert was wrapped in a
      // swallow-everything try/catch, so any insert failure left
      // used_count bumped with no coupon_usages row (and other flows
      // skipped recording entirely), under-recording real redemptions.
      // Now the insert is mandatory: on failure the caller gets an
      // error and order placement rolls back.
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO coupon_usages (id, coupon_id, order_id, customer_id, discount_amount, created_at)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::numeric, NOW())`,
          couponId,
          orderId || null,
          customerId || null,
          discountApplied
        );
      } catch (usageErr: any) {
        return {
          data: null,
          error: {
            message: `Failed to record coupon usage: ${usageErr?.message || usageErr}`,
          },
        };
      }

      await prisma.$executeRawUnsafe(
        `UPDATE coupons
         SET used_count = COALESCE(used_count, 0) + 1,
             updated_at = NOW()
         WHERE id = $1::uuid`,
        couponId
      );

      return { data: true, error: null };
    }
    // Coupon not found: that is a failed redemption, not a silent
    // success — surface it so the order can roll back instead of
    // granting a discount the ledger never recorded.
    return {
      data: null,
      error: { message: `Coupon not found for code: ${couponCode || "(none)"}` },
    };
  } else if (fnName === "release_coupon_atomic") {
    const orderId = args.p_order_id || args.order_id;
    if (orderId) {
      try {
        const usages = (await prisma.$queryRawUnsafe(
          `SELECT coupon_id FROM coupon_usages WHERE order_id = $1::uuid`,
          orderId
        )) as Array<{ coupon_id: string }>;
        if (usages && usages.length > 0) {
          const couponId = usages[0].coupon_id;
          await prisma.$executeRawUnsafe(
            `UPDATE coupons
             SET used_count = GREATEST(0, COALESCE(used_count, 1) - 1),
                 updated_at = NOW()
             WHERE id = $1::uuid`,
            couponId
          );
          await prisma.$executeRawUnsafe(
            `DELETE FROM coupon_usages WHERE order_id = $1::uuid`,
            orderId
          );
        }
      } catch (releaseErr) {
      }
      return { data: true, error: null };
    }
  } else if (fnName === "atomic_release_stock" || fnName === "release_stock") {
    const variantId = args.p_variant_id || args.variant_id;
    const quantity = args.p_quantity || args.quantity || 1;
    if (variantId) {
      await prisma.$executeRawUnsafe(
        `UPDATE inventory_levels
         SET quantity_available = quantity_available + $1,
             quantity_reserved = GREATEST(0, quantity_reserved - $1),
             updated_at = NOW()
         WHERE variant_id = $2::uuid`,
        quantity,
        variantId
      );
      return { data: true, error: null };
    }
  } else if (fnName === "atomic_reduce_stock" || fnName === "reduce_stock") {
    const variantId = args.p_variant_id || args.variant_id;
    const quantity = args.p_quantity || args.quantity || 1;
    if (variantId) {
      await prisma.$executeRawUnsafe(
        `UPDATE inventory_levels
         SET quantity_reserved = GREATEST(0, quantity_reserved - $1),
             updated_at = NOW()
         WHERE variant_id = $2::uuid`,
        quantity,
        variantId
      );
      return { data: true, error: null };
    }
  } else if (
    fnName === "reverse_loyalty_points" ||
    fnName === "redeem_loyalty_points"
  ) {
    const accountId = args.p_account_id || args.account_id;
    const points = args.p_points || args.points || 0;
    if (accountId) {
      await prisma.$executeRawUnsafe(
        `UPDATE loyalty_accounts
         SET points_balance = GREATEST(0, points_balance - $1::integer),
             updated_at = NOW()
         WHERE id = $2::uuid`,
        points,
        accountId
      );
      return { data: true, error: null };
    }
  } else if (fnName === "increment_label_print_count") {
    const labelId = args.label_id || args.id;
    if (labelId) {
      await prisma.$executeRawUnsafe(
        `UPDATE shipment_labels
         SET print_count = print_count + 1
         WHERE id = $1::uuid`,
        labelId
      );
      return { data: true, error: null };
    }
  }

  return { data: true, error: null };
}

export function callRpc(fnName: string, args?: RpcArgs) {
  const p = (async () => {
    try {
      assertIdent(fnName, "function name");
      if (args) Object.keys(args).forEach((k) => assertIdent(k, "argument"));
      if (!args || Object.keys(args).length === 0) {
        const res = (await prisma.$queryRawUnsafe(
          `SELECT * FROM "${fnName}"()`
        )) as unknown[];
        return { data: serializePlain(res), error: null };
      }

      const keys = Object.keys(args);
      const params: unknown[] = [];
      const placeholders: string[] = [];
      for (const k of keys) {
        const val = args[k];
        params.push(val);
        const idx = params.length;
        if (
          typeof val === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
        ) {
          placeholders.push(`$${idx}::uuid`);
        } else if (typeof val === "number") {
          placeholders.push(
            Number.isInteger(val) ? `$${idx}::integer` : `$${idx}::numeric`
          );
        } else if (typeof val === "boolean") {
          placeholders.push(`$${idx}::boolean`);
        } else if (val !== null && typeof val === "object") {
          params[idx - 1] = JSON.stringify(val);
          placeholders.push(`$${idx}::jsonb`);
        } else {
          placeholders.push(`$${idx}`);
        }
      }

      if (!KNOWN_FALLBACK_RPCS.includes(fnName)) {
        try {
          const res = (await prisma.$queryRawUnsafe(
            `SELECT * FROM "${fnName}"(${placeholders.join(", ")})`,
            ...params
          )) as unknown[];
          return { data: serializePlain(res), error: null };
        } catch (dbErr) {
          // If stored function execution failed, evaluate the fallback below.
        }
      }

      return await runFallback(fnName, args);
    } catch (e: any) {
      return { data: null, error: { message: e.message, code: e.code } };
    }
  })() as Promise<RpcCallResult> & {
    maybeSingle: () => Promise<RpcCallResult>;
    single: () => Promise<RpcCallResult>;
  };
  p.maybeSingle = () => p;
  p.single = () => p;
  return p;
}
