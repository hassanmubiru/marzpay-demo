// Temporary verification probe for task 3.2 (insertPending/markCompleted/findByReference).
import {
  initSchema,
  insertPending,
  markCompleted,
  findByReference,
  closeStore,
} from "../dist/db/payments.js";

await initSchema({ filePath: ":memory:" });

const ref = "ref-32";
const now = new Date().toISOString();

// insertPending happy path
console.log("INSERT1:", JSON.stringify(await insertPending({ reference: ref, amount: 5000, currency: "UGX", status: "pending", createdAt: now })));
// idempotent re-insert (no duplicate, existing row intact)
console.log("INSERT2:", JSON.stringify(await insertPending({ reference: ref, amount: 9999, currency: "USD", status: "other", createdAt: now })));

let found = await findByReference(ref);
console.log("AFTER_INSERTS:", JSON.stringify(found));

// markCompleted updates the single row
console.log("COMPLETE:", JSON.stringify(await markCompleted(ref, { amount: 5000, currency: "UGX", status: "completed" })));
// idempotent re-complete
console.log("COMPLETE2:", JSON.stringify(await markCompleted(ref, { amount: 5000, currency: "UGX", status: "completed" })));

found = await findByReference(ref);
console.log("AFTER_COMPLETE:", JSON.stringify(found));

// unknown reference
console.log("UNKNOWN:", JSON.stringify(await findByReference("does-not-exist")));

// confirm exactly one row
import { getPool } from "../dist/db/payments.js";
const count = await getPool().query("SELECT COUNT(*) AS n FROM payments WHERE reference = ?", [ref]);
console.log("ROW_COUNT:", count.rows[0].n);

await closeStore();
console.log("OK");
