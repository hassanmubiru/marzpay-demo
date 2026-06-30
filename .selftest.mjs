import "dotenv/config";
import {
  initSchema,
  insertPending,
  markCompleted,
  findByReference,
  usingSupabase,
} from "./dist/db/store.js";

const ref = `selftest-${Date.now()}`;
console.log("backend:", usingSupabase() ? "supabase" : "sqlite", "ref:", ref);

await initSchema();

console.log("insertPending:", await insertPending({
  reference: ref, amount: 5000, currency: "UGX", status: "pending",
  createdAt: new Date().toISOString(),
}));

let look = await findByReference(ref);
console.log("after pending:", look.found ? look.payment.status : "NOT FOUND");

console.log("markCompleted:", await markCompleted(ref, {
  amount: 5000, currency: "UGX", status: "completed",
}));

look = await findByReference(ref);
console.log("after complete:", look.found
  ? `${look.payment.status} ${look.payment.amount} ${look.payment.currency}`
  : "NOT FOUND");
