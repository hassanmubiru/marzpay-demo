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
let pool = null;
/** Build a {@link SqlitePool} from the resolved store options. */
function createPool(options) {
    const filePath = options.filePath ?? DEFAULT_DB_PATH;
    // An in-memory DB lives in a single connection; pin to one worker so every
    // query observes the same database. File-backed DBs may use the default.
    const maxWorkers = filePath === MEMORY_PATH ? 1 : options.maxWorkers;
    return new SqlitePool(maxWorkers === undefined ? { filePath } : { filePath, maxWorkers });
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
export async function initSchema(options = {}) {
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
export function setPool(next) {
    pool = next;
}
/**
 * Return the active database handle.
 *
 * @throws Error if the store has not been initialized via {@link initSchema}.
 */
export function getPool() {
    if (!pool) {
        throw new Error("Payment_Store is not initialized: call initSchema() before use");
    }
    return pool;
}
/**
 * Close the active database handle and clear it. Useful for test teardown and
 * graceful shutdown. A no-op when no pool is configured.
 */
export async function closeStore() {
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
export function rowToRecord(row) {
    return {
        id: Number(row.id),
        reference: row.reference ?? "",
        amount: Number(row.amount),
        currency: row.currency ?? "",
        status: row.status ?? "",
        createdAt: row.created_at ?? "",
    };
}
//# sourceMappingURL=payments.js.map