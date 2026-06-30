import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";

import {
  initSchema,
  insertPending,
  findByReference,
  closeStore,
  type NewPayment,
} from "../src/db/payments.js";

// Feature: streetjs-marzpay-demo, Property 14: Lookup round-trip returns the
// stored record.
//
// For any Payment_Record persisted under a reference, findByReference(reference)
// returns `found: true` with a record equal to the one stored.
//
// Validates: Requirements 6.5

// Monotonic counter guaranteeing a distinct reference per generated case, so a
// shared in-memory DB never trips the UNIQUE(reference) constraint across runs.
// (insertPending uses ON CONFLICT DO NOTHING, so a colliding reference would be
// silently skipped and the round-trip would read a different, earlier row.)
let caseCounter = 0;

describe("Property 14: Lookup round-trip returns the stored record", () => {
  beforeAll(async () => {
    // Single shared in-memory SQLite DB (the store pins :memory: to one worker
    // so every query observes the same database).
    await initSchema({ filePath: ":memory:" });
  });

  afterAll(async () => {
    await closeStore();
  });

  it("returns found: true with a record equal to the one stored", async () => {
    await fc.assert(
      fc.asyncProperty(
        // A base reference fragment; combined with a unique counter below.
        fc.string({ minLength: 1, maxLength: 32 }),
        // amount is stored in a REAL column; JS doubles round-trip exactly.
        // Exclude NaN/Infinity (column is NOT NULL REAL) and -0 (which would
        // break Object.is equality after the text round-trip).
        fc
          .double({ min: 0, max: 1e12, noNaN: true, noDefaultInfinity: true })
          .filter((n) => !Object.is(n, -0)),
        fc.string({ maxLength: 8 }),
        fc.string({ maxLength: 16 }),
        async (refBase, amount, currency, status) => {
          const reference = `${refBase}-${caseCounter++}`;
          const stored: NewPayment = {
            reference,
            amount,
            currency,
            status,
            createdAt: new Date().toISOString(),
          };

          const inserted = await insertPending(stored);
          expect(inserted.ok).toBe(true);

          const result = await findByReference(reference);

          // Lookup reports the record as found.
          expect(result.found).toBe(true);
          if (!result.found) {
            return; // narrows the type; the assertion above already failed
          }

          // The looked-up record equals the one stored (every field the caller
          // provided survives the round-trip; the DB additionally assigns id).
          const { id, ...persisted } = result.payment;
          expect(typeof id).toBe("number");
          expect(persisted).toEqual(stored);
        },
      ),
      { numRuns: 100 },
    );
  });
});
