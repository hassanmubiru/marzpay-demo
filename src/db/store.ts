/**
 * Persistence facade — selects the Payment_Store backend per call.
 *
 * - When `SUPABASE_URL` and a Supabase key are present (production / Vercel),
 *   the durable append-only Supabase store is used.
 * - Otherwise (local dev, tests) the built-in SQLite store is used, preserving
 *   the exact behaviour the spec tests assert.
 *
 * Selection is evaluated at call time (not import time) so it reflects the
 * environment AFTER `dotenv` has loaded `.env` during bootstrap. Both backends
 * expose the same surface, so controllers depend only on this module.
 */

import * as sqlite from "./payments.js";
import * as supabase from "./supabase-store.js";
import type {
  PaymentStoreOptions,
  NewPayment,
  WriteResult,
  LookupResult,
} from "./payments.js";

export type {
  PaymentRecord,
  NewPayment,
  WriteResult,
  LookupResult,
  PaymentStoreOptions,
} from "./payments.js";

/** True when Supabase connection settings are configured (evaluated live). */
export function usingSupabase(): boolean {
  return Boolean(
    process.env.SUPABASE_URL &&
      (process.env.SUPABASE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
}

/** Initialize the active store. SQLite accepts options; Supabase ignores them. */
export async function initSchema(
  options: PaymentStoreOptions = {},
): Promise<void> {
  if (usingSupabase()) {
    await supabase.initSchema();
    return;
  }
  await sqlite.initSchema(options);
}

/** Idempotently persist a pending payment (delegates to the active backend). */
export async function insertPending(
  payment: NewPayment,
): Promise<WriteResult> {
  return usingSupabase()
    ? supabase.insertPending(payment)
    : sqlite.insertPending(payment);
}

/** Record a payment as completed with confirmed fields (active backend). */
export async function markCompleted(
  reference: string,
  fields: { amount: number; currency: string; status: string },
): Promise<WriteResult> {
  return usingSupabase()
    ? supabase.markCompleted(reference, fields)
    : sqlite.markCompleted(reference, fields);
}

/** Look up the current payment for a reference (active backend). */
export async function findByReference(
  reference: string,
): Promise<LookupResult> {
  return usingSupabase()
    ? supabase.findByReference(reference)
    : sqlite.findByReference(reference);
}
