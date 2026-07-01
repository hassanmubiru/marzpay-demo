/**
 * Supabase-backed Payment_Store (append-only model).
 *
 * Why append-only: `@streetjs/plugin-supabase` exposes only `select` and
 * `insert` (no `update`/`upsert`/`delete`). So instead of updating a single
 * `payments` row in place, every state change is recorded as a new row in a
 * `payment_events` table, and the "current" payment is derived by reducing all
 * events for a reference (latest/most-complete wins). This is the durable store
 * used on serverless deployments (Vercel), where the in-process WASM SQLite is
 * not persistent.
 *
 * It implements the same surface as the SQLite Payment_Store
 * (`initSchema`/`insertPending`/`markCompleted`/`findByReference` + types) so
 * the env-switching facade in `store.ts` can pick either backend transparently.
 *
 * The schema itself is created out-of-band by the SQL migration in
 * `supabase/schema.sql` (PostgREST cannot run DDL), so `initSchema` here only
 * validates configuration / constructs the client.
 */

import { SupabaseClient } from "@streetjs/plugin-supabase";

import type {
  NewPayment,
  PaymentRecord,
  WriteResult,
  LookupResult,
} from "./payments.js";

/** The append-only events table backing the derived payment state. */
const EVENTS_TABLE = "payment_events";

/** Lazily-constructed Supabase client (built from env on first use). */
let client: SupabaseClient | null = null;

/** A raw PostgREST row from the events table (numbers arrive as JSON numbers). */
export interface EventRow {
  id?: number;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

/**
 * Pure reduction of a reference's append-only events into the current payment.
 * Exported for testing. Status comes from the most recent event; amount and
 * currency come from the most recent event that carries a *valid* value, so a
 * zero-amount completion never clobbers the amount set at checkout (and any
 * record previously completed with amount 0 self-heals on read). Returns
 * `{ found: false }` for an empty event list.
 */
export function derivePayment(
  reference: string,
  events: EventRow[],
): LookupResult {
  if (events.length === 0) {
    return { found: false };
  }
  const sorted = [...events].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
  );
  const earliest = sorted[0]!;
  const latest = sorted[sorted.length - 1]!;
  const amountSource =
    [...sorted].reverse().find((e) => Number(e.amount) > 0) ?? latest;
  const currencySource =
    [...sorted]
      .reverse()
      .find((e) => typeof e.currency === "string" && e.currency.trim() !== "") ??
    latest;

  return {
    found: true,
    payment: {
      id: latest.id ?? 0,
      reference,
      amount: amountSource.amount,
      currency: currencySource.currency,
      status: latest.status,
      createdAt: earliest.created_at,
    },
  };
}

/** Read and validate the Supabase connection settings from the environment. */
function readConfig(): { url: string; apiKey: string } {
  const url = process.env.SUPABASE_URL;
  const apiKey = process.env.SUPABASE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !apiKey) {
    throw new Error(
      "Supabase store requires SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  return { url, apiKey };
}

/** Return the shared Supabase client, constructing it on first use. */
function getClient(): SupabaseClient {
  if (!client) {
    const { url, apiKey } = readConfig();
    client = new SupabaseClient({ url, apiKey, stateKey: "supabase" });
  }
  return client;
}

/**
 * Initialize the Supabase store. The table is created by the SQL migration, so
 * this only validates that connection settings are present and primes the
 * client. Signature mirrors the SQLite `initSchema` (options are ignored here).
 */
export async function initSchema(): Promise<void> {
  getClient();
}

/** Append a `pending` event for a new payment (Req 6.2). Idempotency note below. */
export async function insertPending(payment: NewPayment): Promise<WriteResult> {
  try {
    // Idempotency: re-inserting the same reference appends another pending
    // event, but the derived payment is unchanged (still pending). The SQLite
    // store enforces a single physical row; the append-only store enforces a
    // single *logical* payment via the reduce in findByReference.
    const existing = await readEvents(payment.reference);
    if (existing.some((e) => e.status === payment.status)) {
      return { ok: true };
    }
    await getClient().insert(EVENTS_TABLE, {
      reference: payment.reference,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      created_at: payment.createdAt,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Append a completed event carrying the confirmed transaction fields (Req 6.2). */
export async function markCompleted(
  reference: string,
  fields: { amount: number; currency: string; status: string },
): Promise<WriteResult> {
  try {
    // Idempotent by reference: if a completed event with this status already
    // exists, do nothing (no duplicate completion).
    const existing = await readEvents(reference);
    if (existing.some((e) => e.status === fields.status)) {
      return { ok: true };
    }
    await getClient().insert(EVENTS_TABLE, {
      reference,
      amount: fields.amount,
      currency: fields.currency,
      status: fields.status,
      created_at: new Date().toISOString(),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Derive the current payment for a reference by reducing its events: the
 * earliest event supplies the creation time; the most-recent event supplies the
 * effective amount/currency/status.
 */
export async function findByReference(
  reference: string,
): Promise<LookupResult> {
  const events = await readEvents(reference);
  return derivePayment(reference, events);
}

/** Fetch all events for a reference via the plugin's PostgREST select. */
async function readEvents(reference: string): Promise<EventRow[]> {
  const rows = (await getClient().select(EVENTS_TABLE, {
    columns: "id,reference,amount,currency,status,created_at",
    filters: { reference: `eq.${reference}` },
  })) as EventRow[] | null;
  return Array.isArray(rows) ? rows : [];
}

/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
