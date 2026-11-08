/**
 * Order-pipeline schema completion (additive, idempotent).
 *
 * Several order-pipeline modules (courier dispatch, returns, SMS logging,
 * courier API logging, fraud check) were written against columns that were
 * never created in the database, so their writes were silently dropped by
 * the data layer. This script creates exactly those columns — new nullable
 * columns only, no drops, no renames, no data rewrites — and seeds the two
 * fraud-settings rows the services read.
 *
 * Run:  npx tsx --env-file=.env.local scripts/order-pipeline-ddl.ts
 * Safe to re-run: every statement is IF NOT EXISTS / ON CONFLICT DO NOTHING.
 */
import { prisma } from "@/lib/prisma";

const STATEMENTS: Array<{ table: string; sql: string }> = [
  // shipments — courier booking identity + lifecycle bookkeeping
  { table: "shipments", sql: `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS consignment_id VARCHAR(255)` },
  { table: "shipments", sql: `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS label_url TEXT` },
  { table: "shipments", sql: `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS updated_by UUID` },
  { table: "shipments", sql: `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS provider_status VARCHAR(50)` },
  { table: "shipments", sql: `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS failure_reason TEXT` },
  { table: "shipments", sql: `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS label_generated_at TIMESTAMPTZ` },
  { table: "shipments", sql: `CREATE INDEX IF NOT EXISTS idx_shipments_consignment_id ON shipments (consignment_id)` },

  // returns — refund state, exchange data, lifecycle timestamps
  { table: "returns", sql: `ALTER TABLE returns ADD COLUMN IF NOT EXISTS refund_status VARCHAR(30)` },
  { table: "returns", sql: `ALTER TABLE returns ADD COLUMN IF NOT EXISTS refund_method VARCHAR(50)` },
  { table: "returns", sql: `ALTER TABLE returns ADD COLUMN IF NOT EXISTS exchange_requested BOOLEAN DEFAULT false` },
  { table: "returns", sql: `ALTER TABLE returns ADD COLUMN IF NOT EXISTS exchange_variant_id UUID` },
  { table: "returns", sql: `ALTER TABLE returns ADD COLUMN IF NOT EXISTS photo_urls JSONB` },
  { table: "returns", sql: `ALTER TABLE returns ADD COLUMN IF NOT EXISTS shipment_id UUID` },
  { table: "returns", sql: `ALTER TABLE returns ADD COLUMN IF NOT EXISTS rejection_reason TEXT` },
  { table: "returns", sql: `ALTER TABLE returns ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ` },
  { table: "returns", sql: `ALTER TABLE returns ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ` },
  { table: "returns", sql: `ALTER TABLE returns ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ` },
  { table: "returns", sql: `ALTER TABLE returns ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ` },
  { table: "returns", sql: `ALTER TABLE returns ADD COLUMN IF NOT EXISTS inventory_synced_at TIMESTAMPTZ` },
  { table: "returns", sql: `ALTER TABLE returns ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ` },
  { table: "returns", sql: `ALTER TABLE returns ADD COLUMN IF NOT EXISTS inspected_at TIMESTAMPTZ` },

  // return_items — the descriptive fields the create flows already supply
  { table: "return_items", sql: `ALTER TABLE return_items ADD COLUMN IF NOT EXISTS sku VARCHAR(100)` },
  { table: "return_items", sql: `ALTER TABLE return_items ADD COLUMN IF NOT EXISTS product_name VARCHAR(255)` },
  { table: "return_items", sql: `ALTER TABLE return_items ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(12,2) DEFAULT 0` },

  // orders — SMS delivery flags + external fraud-check result
  { table: "orders", sql: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_sms_sent BOOLEAN NOT NULL DEFAULT false` },
  { table: "orders", sql: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS completion_sms_sent BOOLEAN NOT NULL DEFAULT false` },
  { table: "orders", sql: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS fraud_check_status VARCHAR(30)` },
  { table: "orders", sql: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS fraud_check_result JSONB` },
  { table: "orders", sql: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS fraud_checked_at TIMESTAMPTZ` },

  // sms_logs — the fields the SMS service records per message
  { table: "sms_logs", sql: `ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS phone VARCHAR(50)` },
  { table: "sms_logs", sql: `ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS order_id UUID` },
  { table: "sms_logs", sql: `ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS type VARCHAR(50)` },
  { table: "sms_logs", sql: `ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS provider VARCHAR(50)` },
  { table: "sms_logs", sql: `ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS request_id VARCHAR(100)` },
  { table: "sms_logs", sql: `ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS error_message TEXT` },
  { table: "sms_logs", sql: `ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ` },

  // courier_api_logs — the fields the courier logger records per call
  { table: "courier_api_logs", sql: `ALTER TABLE courier_api_logs ADD COLUMN IF NOT EXISTS courier_code VARCHAR(50)` },
  { table: "courier_api_logs", sql: `ALTER TABLE courier_api_logs ADD COLUMN IF NOT EXISTS method VARCHAR(20)` },
  { table: "courier_api_logs", sql: `ALTER TABLE courier_api_logs ADD COLUMN IF NOT EXISTS success BOOLEAN` },
  { table: "courier_api_logs", sql: `ALTER TABLE courier_api_logs ADD COLUMN IF NOT EXISTS response_time_ms INT` },
  { table: "courier_api_logs", sql: `ALTER TABLE courier_api_logs ADD COLUMN IF NOT EXISTS request_id VARCHAR(100)` },
  { table: "courier_api_logs", sql: `ALTER TABLE courier_api_logs ADD COLUMN IF NOT EXISTS error_message TEXT` },
  { table: "courier_api_logs", sql: `ALTER TABLE courier_api_logs ADD COLUMN IF NOT EXISTS payload JSONB` },
  { table: "courier_api_logs", sql: `ALTER TABLE courier_api_logs ADD COLUMN IF NOT EXISTS response_data JSONB` },

  // shipment_events — structured event shape the shipping service writes
  { table: "shipment_events", sql: `ALTER TABLE shipment_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(100)` },
  { table: "shipment_events", sql: `ALTER TABLE shipment_events ADD COLUMN IF NOT EXISTS payload JSONB` },
  { table: "shipment_events", sql: `ALTER TABLE shipment_events ADD COLUMN IF NOT EXISTS triggered_by UUID` },
  { table: "shipment_events", sql: `ALTER TABLE shipment_events ADD COLUMN IF NOT EXISTS source VARCHAR(50)` },

  // shipment_tracking_events — provider tracking shape
  { table: "shipment_tracking_events", sql: `ALTER TABLE shipment_tracking_events ADD COLUMN IF NOT EXISTS event_time TIMESTAMPTZ` },
  { table: "shipment_tracking_events", sql: `ALTER TABLE shipment_tracking_events ADD COLUMN IF NOT EXISTS status_description TEXT` },
  { table: "shipment_tracking_events", sql: `ALTER TABLE shipment_tracking_events ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(255)` },
  { table: "shipment_tracking_events", sql: `ALTER TABLE shipment_tracking_events ADD COLUMN IF NOT EXISTS provider_raw JSONB` },

  // shipment_labels — label kind/payload/print bookkeeping
  { table: "shipment_labels", sql: `ALTER TABLE shipment_labels ADD COLUMN IF NOT EXISTS label_type VARCHAR(50)` },
  { table: "shipment_labels", sql: `ALTER TABLE shipment_labels ADD COLUMN IF NOT EXISTS label_data TEXT` },
  { table: "shipment_labels", sql: `ALTER TABLE shipment_labels ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ` },
];

const TOUCHED_TABLES = [
  "shipments", "returns", "return_items", "orders", "sms_logs",
  "courier_api_logs", "shipment_events", "shipment_tracking_events",
  "shipment_labels", "settings",
];

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TOUCHED_TABLES) {
    const r = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    out[t] = (r as any)[0].n;
  }
  return out;
}

async function main() {
  const before = await counts();
  console.log("Row counts BEFORE:", JSON.stringify(before));

  for (const { sql } of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
  }
  console.log(`Applied ${STATEMENTS.length} additive DDL statements.`);

  // Seed the fraud settings rows the services read (never overwrite an
  // existing row — admin edits must survive a re-run).
  await prisma.$executeRawUnsafe(
    `INSERT INTO settings (key, value, category, description)
     VALUES ('cod_fraud_settings',
       '{"enabled":true,"cod_high_value_threshold":3000,"otp_required_for_high_value":true,"otp_required_for_first_order":true,"max_cod_risk_score":60,"otp_expiry_minutes":10,"otp_max_attempts":5,"otp_resend_cooldown_seconds":60,"duplicate_order_window_minutes":15}'::jsonb,
       'fraud',
       'COD fraud shield: risk thresholds and OTP rules')
     ON CONFLICT (key) DO NOTHING`
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO settings (key, value, category, description)
     VALUES ('fraud_check_settings',
       '{"provider":"bdcourier","enabled":false,"api_key":"","success_ratio_warn_below":50,"timeout_ms":8000}'::jsonb,
       'fraud',
       'External fraud check by phone (BDCourier). Add the store API key and set enabled=true to activate.')
     ON CONFLICT (key) DO NOTHING`
  );
  console.log("Settings seeds ensured (cod_fraud_settings, fraud_check_settings).");

  const after = await counts();
  console.log("Row counts AFTER:", JSON.stringify(after));
  for (const t of TOUCHED_TABLES) {
    if (before[t] !== after[t]) {
      console.log(`  count change ${t}: ${before[t]} -> ${after[t]}`);
    }
  }

  const cols = await prisma.$queryRawUnsafe(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema='public'
       AND ((table_name='shipments' AND column_name IN ('consignment_id','label_url','updated_by','provider_status','failure_reason','label_generated_at'))
         OR (table_name='returns' AND column_name IN ('refund_status','refund_method','approved_at','received_at','completed_at','inventory_synced_at','inspected_at','rejection_reason','photo_urls','shipment_id','exchange_requested','exchange_variant_id','picked_up_at','rejected_at'))
         OR (table_name='return_items' AND column_name IN ('sku','product_name','refund_amount'))
         OR (table_name='orders' AND column_name IN ('confirmation_sms_sent','completion_sms_sent','fraud_check_status','fraud_check_result','fraud_checked_at'))
         OR (table_name='sms_logs' AND column_name IN ('phone','order_id','type','provider','request_id','error_message','updated_at'))
         OR (table_name='courier_api_logs' AND column_name IN ('courier_code','method','success','response_time_ms','request_id','error_message','payload','response_data'))
         OR (table_name='shipment_events' AND column_name IN ('event_type','payload','triggered_by','source'))
         OR (table_name='shipment_tracking_events' AND column_name IN ('event_time','status_description','tracking_number','provider_raw'))
         OR (table_name='shipment_labels' AND column_name IN ('label_type','label_data','printed_at')))
     ORDER BY table_name, column_name`
  );
  console.log(`Verified ${(cols as any[]).length} new columns present.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("DDL failed:", e?.message || e);
  await prisma.$disconnect();
  process.exit(1);
});
