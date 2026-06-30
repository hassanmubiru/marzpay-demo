import { afterAll, beforeAll, describe, it, expect } from "vitest";
import fc from "fast-check";

import type { StreetContext } from "streetjs";

import { SuccessController } from "../src/controllers/success.controller.js";
import {
  initSchema,
  insertPending,
  closeStore,
  type NewPayment,
} from "../src/db/payments.js";

// Feature: streetjs-marzpay-demo, Property 16: Success page always renders the
// stored record's fields.
//
// For any stored Payment_Record requested by its reference, the Success_Page
// responds with HTTP status 200 and renders the stored reference, the amount
// and currency formatted as "{amount} {currency}" (amount, a single space,
// then the currency code), and the stored status.
//
// Validates: Requirements 7.1

/**
 * The SuccessController HTML-escapes every substituted value, so we generate
 * field values free of HTML-special characters (`< > & " '`). With no special
 * characters the escaped output is byte-identical to the input, letting us
 * assert that the raw stored values appear verbatim in the rendered body.
 */
const SAFE_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

/** A non-blank string of HTML-safe characters. */
const safeText = (minLength: number, maxLength: number) =>
  fc
    .stringOf(fc.constantFrom(...SAFE_CHARS.split("")), {
      minLength,
      maxLength,
    })
    // A reference/currency/status must survive the controller's blank guard
    // and remain non-empty so it is unambiguously present in the output.
    .filter((s) => s.trim() !== "");

/** Generator for arbitrary stored payment records. */
const arbitraryRecord = fc.record({
  reference: safeText(1, 24),
  // Integer amounts round-trip exactly through SQLite REAL → Number → String,
  // keeping the expected "{amount} {currency}" formatting deterministic.
  amount: fc.integer({ min: 0, max: 100_000_000 }),
  currency: safeText(2, 6),
  status: safeText(1, 16),
});

/**
 * Build a minimal StreetContext exposing only what SuccessController.show
 * consumes: `query.reference` for input and `html(body, status)` for output.
 */
function makeContext(reference: string) {
  const captured: { body: string; status: number } = { body: "", status: 0 };
  const ctx = {
    query: { reference },
    html(body: string, status?: number): void {
      captured.body = body;
      captured.status = status ?? 200;
    },
  } as unknown as StreetContext;
  return { ctx, captured };
}

// One shared in-memory store for the whole property: creating a SQLite pool
// spawns a worker thread, so we initialize it once and keep each run's record
// unique via a monotonic prefix on the reference (the lookup key).
beforeAll(async () => {
  await initSchema({ filePath: ":memory:" });
});

afterAll(async () => {
  await closeStore();
});

describe("Property 16: Success page always renders the stored record's fields", () => {
  it("renders reference, '{amount} {currency}', and status with HTTP 200", async () => {
    const controller = new SuccessController();
    let counter = 0;

    await fc.assert(
      fc.asyncProperty(arbitraryRecord, async (record) => {
        // Guarantee a unique reference per run so the generated record is
        // stored verbatim (no ON CONFLICT no-op against a prior run's row).
        const reference = `${counter++}-${record.reference}`;

        const newPayment: NewPayment = {
          reference,
          amount: record.amount,
          currency: record.currency,
          status: record.status,
          createdAt: new Date().toISOString(),
        };
        const write = await insertPending(newPayment);
        expect(write.ok).toBe(true);

        const { ctx, captured } = makeContext(reference);
        await controller.show(ctx);

        // HTTP 200 for a stored record requested by its reference.
        expect(captured.status).toBe(200);

        const body = captured.body;
        // Stored reference is rendered.
        expect(body).toContain(reference);
        // Amount/currency formatted as "{amount} {currency}".
        expect(body).toContain(`${record.amount} ${record.currency}`);
        // Stored status is rendered.
        expect(body).toContain(record.status);
      }),
      { numRuns: 100 },
    );
  });
});
