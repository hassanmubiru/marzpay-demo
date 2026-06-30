import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";

import {
  initSchema,
  insertPending,
  markCompleted,
  getPool,
  closeStore,
  rowToRecord,
} from "../src/db/payments.js";

// Feature: streetjs-marzpay-demo, Property 12: Completed payments persist the
// confirmed transaction fields.
//
// For any confirmed completion, the Payment_Store stores exactly one
// Payment_Record whose reference equals the confirmed reference, whose amount,
// currency, and status equal the values read from `transactions.get(reference)`,
// and whose `created_at` is a valid ISO 8601 UTC timestamp.
//
// Validates: Requirements 6.2

/**
 * A valid ISO 8601 UTC timestamp: full date + time with a `Z` (Zulu/UTC)
 * designator, optional fractional seconds, and a value that parses to a real
 * instant. This matches `new Date().toISOString()` output.
 */
function isIso8601Utc(value: string): boolean {
  const ISO_UTC =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
  if (!ISO_UTC.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

// Monotonic counter guaranteeing a distinct reference per generated case, so a
// shared in-memory DB never trips the UNIQUE(reference) constraint across runs
// while we still assert "exactly one record for the reference".
let caseCounter = 0;

describe("Property 12: Completed payments persist the confirmed transaction fields", () => {
  beforeAll(async () => {
    // Single shared in-memory SQLite DB (the store pins :memory: to one worker
    // so every query observes the same database).
    await initSchema({ filePath: ":memory:" });
  });

  afterAll(async () => {
    await closeStore();
  });

  it("stores exactly one record carrying the confirmed amount/currency/status and a valid ISO 8601 UTC created_at", async () => {
    await fc.assert(
      fc.asyncProperty(
        // A base reference fragment; combined with a unique counter below.
        fc.string({ minLength: 1, maxLength: 32 }),
        // Confirmed transaction fields read from `transactions.get`.
        fc.double({ min: 0, max: 1e12, noNaN: true, noDefaultInfinity: true }),
        fc.string({ maxLength: 8 }),
        fc.string({ maxLength: 16 }),
        async (refBase, amount, currency, status) => {
          const reference = `${refBase}-${caseCounter++}`;
          // A realistic creation timestamp, recorded at pending-insert time.
          const createdAt = new Date().toISOString();

          // Seed the pending record, then apply the confirmed completion.
          const inserted = await insertPending({
            reference,
            amount: 5000,
            currency: "UGX",
            status: "pending",
            createdAt,
          });
          expect(inserted.ok).toBe(true);

          const completed = await markCompleted(reference, {
            amount,
            currency,
            status,
          });
          expect(completed.ok).toBe(true);

          // Exactly one record exists for this reference.
          const result = await getPool().query(
            `SELECT * FROM payments WHERE reference = ?`,
            [reference],
          );
          expect(result.rows.length).toBe(1);

          const record = rowToRecord(result.rows[0]);

          // Reference and confirmed fields match the values from completion.
          expect(record.reference).toBe(reference);
          expect(record.amount).toBe(amount);
          expect(record.currency).toBe(currency);
          expect(record.status).toBe(status);

          // created_at is a valid ISO 8601 UTC timestamp.
          expect(isIso8601Utc(record.createdAt)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
