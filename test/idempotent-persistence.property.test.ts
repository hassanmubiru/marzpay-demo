// Feature: streetjs-marzpay-demo, Property 13: Persistence is idempotent by
// reference. For any reference processed 1..k times through repeated
// insertPending / markCompleted operations against the Payment_Store, exactly
// one Payment_Record remains for that reference and no duplicate is ever
// created (Req 6.3).
//
// Validates: Requirements 6.3

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";

import {
  initSchema,
  closeStore,
  getPool,
  insertPending,
  markCompleted,
  findByReference,
} from "../src/db/payments.js";

/**
 * One operation applied to the store for a given reference. Every run begins
 * with an `insertPending` (guaranteeing a row exists) and then replays an
 * arbitrary sequence of further inserts/completions for the same reference.
 */
type Op =
  | { kind: "insert"; amount: number; currency: string; status: string }
  | { kind: "complete"; amount: number; currency: string; status: string };

const amountArb = fc.double({
  min: 0,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});
const currencyArb = fc.constantFrom("UGX", "KES", "USD", "EUR");
const statusArb = fc.constantFrom(
  "pending",
  "completed",
  "successful",
  "failed",
);

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant("insert" as const),
    amount: amountArb,
    currency: currencyArb,
    status: statusArb,
  }),
  fc.record({
    kind: fc.constant("complete" as const),
    amount: amountArb,
    currency: currencyArb,
    status: statusArb,
  }),
);

/** A non-empty reference string. */
const referenceArb = fc.string({ minLength: 1, maxLength: 64 });

/** Count the rows currently stored for a given reference. */
async function countForReference(reference: string): Promise<number> {
  const result = await getPool().query(
    `SELECT COUNT(*) AS n FROM payments WHERE reference = ?`,
    [reference],
  );
  return Number(result.rows[0]?.n ?? 0);
}

describe("Property 13: Persistence is idempotent by reference", () => {
  // A single in-memory database, pinned to one worker for coherence, shared
  // across all generated cases. Each case clears the table first so the
  // per-reference assertions are not contaminated by earlier runs.
  beforeAll(async () => {
    await initSchema({ filePath: ":memory:" });
  });

  afterAll(async () => {
    await closeStore();
  });

  it("retains exactly one record for a reference processed 1..k times", async () => {
    await fc.assert(
      fc.asyncProperty(
        referenceArb,
        fc.array(opArb, { minLength: 1, maxLength: 8 }),
        async (reference, ops) => {
          // Clean slate for this case.
          await getPool().query(`DELETE FROM payments`);

          // Always create the row once so a record exists to be idempotent
          // about, then replay the arbitrary op sequence for the SAME ref.
          const insert = await insertPending({
            reference,
            amount: 5000,
            currency: "UGX",
            status: "pending",
            createdAt: new Date().toISOString(),
          });
          expect(insert.ok).toBe(true);

          for (const op of ops) {
            if (op.kind === "insert") {
              await insertPending({
                reference,
                amount: op.amount,
                currency: op.currency,
                status: op.status,
                createdAt: new Date().toISOString(),
              });
            } else {
              await markCompleted(reference, {
                amount: op.amount,
                currency: op.currency,
                status: op.status,
              });
            }
          }

          // Exactly one row remains for the reference: no duplicates were
          // ever created regardless of how many times it was processed.
          const count = await countForReference(reference);
          expect(count).toBe(1);

          // And that single row is retrievable by reference.
          const lookup = await findByReference(reference);
          expect(lookup.found).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
