/**
 * Payment_Store — the built-in-SQLite-backed persistence layer for the
 * `payments` table.
 *
 * This module is the ONLY place that touches the StreetJS built-in SQLite
 * database (`SqlitePool` from `streetjs`). It exposes schema initialization,
 * a configurable database handle (so tests can run against an in-memory DB),
 * and — added in task 3.2 — idempotent insert, completion update, and lookup.
 *
 * Design reconciliation: the design document sketches synchronous signatures
 * (e.g. `initSchema(): void`), but the real, published StreetJS SQLite surface
 * (`SqlitePool`) is asynchronous (`query`/`transaction`/`close` all return
 * Promises). We therefore implement the store against the genuine async API.
 *
 * SQLite note: an in-memory database (`':memory:'`) is scoped to a single
 * connection. Because `SqlitePool` spreads work across multiple worker
 * threads (each owning its own connection), an in-memory store would not be
 * shared across workers. To keep in-memory test databases coherent we pin the
 * pool to a single worker whenever the file path is `':memory:'`.
 *
 * _Requirements: 6.1_
 */

import { SqlitePool } from "streetjs";

/**
 * A stored row in the `payments` table.
 *
 * Note the column/field name mapping: the SQLite column is `created_at`
 * (snake_case, ISO 8601 UTC text) while the TypeScript field is `createdAt`.
 */
export interface PaymentRecord {
  /** Autoincrement primary key assigned by the database. */
  id: number;
  /** Demo-assigned Reference; NOT NULL and UNIQUE across all records. */
  reference: string;
  /** Payment amount (e.g. 5000). */
  amount: number;
  /** ISO 4217-style currency code (e.g. "UGX"). */
  currency: string;
  /** Lifecycle status: "pending" before confirmation, a completed value after. */
  status: string;
  /** Record creation timestamp as an ISO 8601 UTC string. */
  createdAt: string;
}

/** A payment to be inserted; the database assigns the `id`. */
export type NewPayment = Omit<PaymentRecord, "id">;

/**
 * Result of a write (insert/update). Carries a human-readable `error` when the
 * write fails, so the calling handler can surface a database-write-failed
 * indication without a partial row being persisted.
 */
export type WriteResult = { ok: true } | { ok: false; error: string };

/** Result of a lookup by reference. */
export type LookupResult =
  | { found: true; payment: PaymentRecord }
  | { found: false };

/** Options controlling which database the Payment_Store is backed by. */
export interface PaymentStoreOptions {
  /**
   * Path to the SQLite database file. Use `':memory:'` for an ephemeral,
   * in-memory database (handy for tests). Defaults to {@link DEFAULT_DB_PATH}.
   */
  filePath?: string;
  /**
   * Maximum worker threads for the pool. Ignored (forced to 1) for in-memory
   * databases so a single shared connection is used. Defaults to the
   * `SqlitePool` default for file-backed databases.
   */
  maxWorkers?: number;
}

/** Sentinel for an in-memory SQLite database. */
const MEMORY_PATH = ":memory:";

/** Default on-disk database file used when no path is configured. */
export const DEFAULT_DB_PATH = process.env.PAYMENTS_DB_PATH ?? "payments.db";

/** DDL for the `payments` table (matches the design's data model). */
const CREATE_PAYMENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS payments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    reference  TEXT    NOT NULL UNIQUE,
    amount     REAL    NOT NULL,
    currency   TEXT    NOT NULL,
    status     TEXT    NOT NULL,
    created_at TEXT    NOT NULL
  )
`;

/**
 * The active database handle. Configured by {@link initSchema} (or
 * {@link setPool}) and consumed by the data-access functions added in task 3.2.
 */
let pool: SqlitePool | null = null;

/** Build a {@link SqlitePool} from the resolved store options. */
function createPool(options: PaymentStoreOptions): SqlitePool {
  const filePath = options.filePath ?? DEFAULT_DB_PATH;
  // An in-memory DB lives in a single connection; pin to one worker so every
  // query observes the same database. File-backed DBs may use the default.
  const maxWorkers =
    filePath === MEMORY_PATH ? 1 : options.maxWorkers;
  return new SqlitePool(
    maxWorkers === undefined ? { filePath } : { filePath, maxWorkers },
  );
}

/**
 * Initialize the Payment_Store: configure the database handle and create the
 * `payments` table if it does not already exist.
 *
 * Safe to call against an existing schema (uses `CREATE TABLE IF NOT EXISTS`).
 * When `options.filePath` is provided, a fresh pool is created for it; this is
 * how tests select an in-memory database. The previously configured pool, if
 * any, is closed first to avoid leaking worker threads.
 *
 * @param options Optional database configuration (file path / worker count).
 * _Requirements: 6.1_
 */
export async function initSchema(
  options: PaymentStoreOptions = {},
): Promise<void> {
  // Replace any prior handle so repeated initialization (e.g. across tests)
  // does not leak worker threads.
  if (pool) {
    await pool.close();
    pool = null;
  }
  pool = createPool(options);
  await pool.query(CREATE_PAYMENTS_TABLE);
}

/**
 * Inject an externally created pool as the active handle. Primarily a testing
 * seam for sharing a single in-memory database across a test's setup and
 * assertions. Does not create the schema; call {@link initSchema} for that or
 * ensure the table already exists.
 */
export function setPool(next: SqlitePool): void {
  pool = next;
}

/**
 * Return the active database handle.
 *
 * @throws Error if the store has not been initialized via {@link initSchema}.
 */
export function getPool(): SqlitePool {
  if (!pool) {
    throw new Error(
      "Payment_Store is not initialized: call initSchema() before use",
    );
  }
  return pool;
}

/**
 * Close the active database handle and clear it. Useful for test teardown and
 * graceful shutdown. A no-op when no pool is configured.
 */
export async function closeStore(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

/**
 * Map a raw SQLite row (all values are text, per the driver's text affinity)
 * into a typed {@link PaymentRecord}, translating `created_at` → `createdAt`
 * and coercing numeric columns. Shared by the lookup/CRUD functions (task 3.2).
 */
export function rowToRecord(row: Record<string, string | null>): PaymentRecord {
  return {
    id: Number(row.id),
    reference: row.reference ?? "",
    amount: Number(row.amount),
    currency: row.currency ?? "",
    status: row.status ?? "",
    createdAt: row.created_at ?? "",
  };
}

/* -------------------------------------------------------------------------- */
/* Data access (task 3.2)                                                     */
/* -------------------------------------------------------------------------- */

/** SELECT used by {@link findByReference} and post-write read-backs. */
const SELECT_BY_REFERENCE = `SELECT * FROM payments WHERE reference = ?`;

/**
 * Idempotently insert a pending {@link NewPayment} keyed by its reference.
 *
 * The insert runs inside a serialised transaction and uses
 * `INSERT ... ON CONFLICT(reference) DO NOTHING`, so re-inserting a reference
 * that already exists is a no-op: the existing row is left intact and no
 * duplicate is created (Req 6.3). On any write failure the transaction is
 * rolled back automatically — leaving no partial row — and a
 * `{ ok: false, error }` result is returned so the caller can surface a
 * database-write-failed indication (Req 6.4).
 *
 * @param payment The pending payment to persist (database assigns `id`).
 * _Requirements: 6.2, 6.3, 6.4_
 */
export async function insertPending(payment: NewPayment): Promise<WriteResult> {
  try {
    const store = getPool();
    await store.transaction(async (query) => {
      await query(
        `INSERT INTO payments (reference, amount, currency, status, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(reference) DO NOTHING`,
        [
          payment.reference,
          payment.amount,
          payment.currency,
          payment.status,
          payment.createdAt,
        ],
      );
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Mark an existing payment completed with the confirmed amount, currency, and
 * status read from `transactions.get` (Req 6.2).
 *
 * The update runs inside a serialised transaction as a conditional
 * `UPDATE ... WHERE reference = ?`, so it only ever touches the single row for
 * that reference and is idempotent: applying the same completion repeatedly
 * yields the same row with no duplicates (Req 6.3). On a write failure the
 * transaction is rolled back, leaving no partial row, and a
 * `{ ok: false, error }` result is returned (Req 6.4).
 *
 * @param reference The Reference identifying the payment to complete.
 * @param fields    The confirmed amount, currency, and status to store.
 * _Requirements: 6.2, 6.3, 6.4_
 */
export async function markCompleted(
  reference: string,
  fields: { amount: number; currency: string; status: string },
): Promise<WriteResult> {
  try {
    const store = getPool();
    await store.transaction(async (query) => {
      await query(
        `UPDATE payments
            SET amount = ?, currency = ?, status = ?
          WHERE reference = ?`,
        [fields.amount, fields.currency, fields.status, reference],
      );
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Look up the single stored {@link PaymentRecord} for a reference.
 *
 * @param reference The Reference to search for.
 * @returns `{ found: true, payment }` when a matching record exists (Req 6.5),
 *          otherwise `{ found: false }` (Req 6.6).
 * _Requirements: 6.5, 6.6_
 */
export async function findByReference(
  reference: string,
): Promise<LookupResult> {
  const result = await getPool().query(SELECT_BY_REFERENCE, [reference]);
  const row = result.rows[0];
  if (!row) {
    return { found: false };
  }
  return { found: true, payment: rowToRecord(row) };
}

/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
