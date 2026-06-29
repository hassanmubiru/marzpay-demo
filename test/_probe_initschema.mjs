// Temporary verification probe for task 3.1 (initSchema + configurable handle).
import { initSchema, getPool, closeStore, rowToRecord } from "../dist/db/payments.js";

await initSchema({ filePath: ":memory:" });
const pool = getPool();

// Confirm the schema exists with the six columns + constraints.
const cols = await pool.query(`PRAGMA table_info(payments)`);
console.log("COLUMNS:", cols.rows.map((c) => `${c.name}:${c.type}:nn=${c.notnull}:pk=${c.pk}`).join(", "));

const idx = await pool.query(`PRAGMA index_list(payments)`);
console.log("UNIQUE_INDEXES:", JSON.stringify(idx.rows));

// Confirm in-memory coherence across queries (single shared connection).
await pool.query(
  `INSERT INTO payments (reference, amount, currency, status, created_at) VALUES (?, ?, ?, ?, ?)`,
  ["ref-A", 5000, "UGX", "pending", new Date().toISOString()],
);
const sel = await pool.query(`SELECT * FROM payments WHERE reference = ?`, ["ref-A"]);
console.log("ROW_MAPPED:", JSON.stringify(rowToRecord(sel.rows[0])));

// initSchema again is safe (IF NOT EXISTS) — reconfigure to a fresh memory DB.
await initSchema({ filePath: ":memory:" });
const fresh = await getPool().query(`SELECT COUNT(*) AS n FROM payments`);
console.log("FRESH_COUNT:", fresh.rows[0].n);

await closeStore();
console.log("OK");
