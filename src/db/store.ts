/**
 * Persistence facade — selects the Payment_Store backend at startup.
 *
 * - When `SUPABASE_URL` and a Supabase key are present (production / Vercel),
 *   the durable append-only Supabase store is used.
 * - Otherwise (local dev, tests) the built-in SQLite store is used, preserving
 *   the exact behaviour the spec tests assert.
 *
 * Both backends expose the same surface, so controllers depend only on this
 * module and never need to know which store is active.
 */

import * as sqlite from "./payments.js";
import * as supabase from "./supabase-store.js";
import type { PaymentStoreOptions } from "./payments.js";

export type {
  PaymentRecord,
  NewPayment,
  WriteResult,
  LookupResult,
  PaymentStoreOptions,
} from "./payments.js";

/** True when Supabase connection settings are configured in the environment. */
export const usingSupabase: boolean = Boolean(
  process.env.SUPABASE_URL &&
    (process.env.SUPABASE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY),
);

/** Initialize the active store. SQLite accepts options; Supabase ignores them. */
export async function initSchema(
  options: PaymentStoreOptions = {},
): Promise<void> {
  if (usingSupabase) {
    await supabase.initSchema();
    return;
  }
  await sqlite.initSchema(options);
}

/** Idempotently persist a pending payment (delegates to the active backend). */
export const insertPending = usingSupabase
  ? supabase.insertPending
  : sqlite.insertPending;

/** Record a payment as completed with confirmed fields (active backend). */
export const markCompleted = usingSupabase
  ? supabase.markCompleted
  : sqlite.markCompleted;

/** Look up the current payment for a reference (active backend). */
export const findByReference = usingSupabase
  ? supabase.findByReference
  : sqlite.findByReference;
