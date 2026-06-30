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

// Feature: streetjs-marzpay-demo, Property 18: Success page reports unknown
// references as not found.
//
// For any reference that matches no stored Payment_Record, the Success_Page
// responds with HTTP status 404, surfaces a "payment not found" message, and
// does not display "Payment Successful".
//
// Validates: Requirements 7.4

/**
 * HTML-safe characters (free of `< > & " '`). The controller HTML-escapes
 * every substituted value, so keeping references to these characters means
 * the stored value would appear verbatim — but here we only ever query
 * references that are guaranteed absent, so nothing is rendered as a field.
 */
const SAFE_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

/** A non-blank string of HTML-safe characters. */
const safeText = (minLength: number, maxLength: number) =>
  fc
    .stringOf(fc.constantFrom(...SAFE_CHARS.split("")), {
      minLength,
      maxLength,
    })
    // Must survive the controller's blank guard so the lookup (not the 400
    // missing-reference path) is exercised.
    .filter((s) => s.trim() !== "");

/**
 * Namespace partitioning guarantees absence: every record that is actually
 * seeded into the store lives under the PRESENT prefix, while every reference
 * we query lives under the disjoint ABSENT prefix. Because the prefixes never
 * overlap, an ABSENT-prefixed reference can never match a stored record.
 */
const PRESENT_PREFIX = "present::";
const ABSENT_PREFIX = "absent::";

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

// One shared in-memory store for the whole property. We seed a handful of
// PRESENT-prefixed records up front so the table is genuinely non-empty; the
// property then only ever queries ABSENT-prefixed references, which are
// disjoint from everything stored and therefore guaranteed missing.
beforeAll(async () => {
  await initSchema({ filePath: ":memory:" });

  for (let i = 0; i < 5; i++) {
    const seeded: NewPayment = {
      reference: `${PRESENT_PREFIX}seed-${i}`,
      amount: 5000,
      currency: "UGX",
      // Seed a completed-looking status so a buggy controller that ignored the
      // lookup result could surface "Payment Successful" — our assertion that
      // it never appears would then catch that.
      status: "completed",
      createdAt: new Date().toISOString(),
    };
    const write = await insertPending(seeded);
    expect(write.ok).toBe(true);
  }
});

afterAll(async () => {
  await closeStore();
});

describe("Property 18: Success page reports unknown references as not found", () => {
  it("responds 404 with a 'payment not found' message and no success text", async () => {
    const controller = new SuccessController();

    await fc.assert(
      fc.asyncProperty(safeText(1, 32), async (suffix) => {
        // Query a reference guaranteed absent by the namespace partition: it
        // carries the ABSENT prefix, disjoint from every seeded PRESENT key.
        const reference = `${ABSENT_PREFIX}${suffix}`;

        const { ctx, captured } = makeContext(reference);
        await controller.show(ctx);

        // Req 7.4 — unknown reference → HTTP 404.
        expect(captured.status).toBe(404);
        // Surfaces a "payment not found" message.
        expect(captured.body).toContain("payment not found");
        // Never displays the success wording.
        expect(captured.body).not.toContain("Payment Successful");
      }),
      { numRuns: 100 },
    );
  });
});
